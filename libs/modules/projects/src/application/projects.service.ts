import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  PermissionDeniedException,
  UnitOfWork,
  InjectDrizzle,
  AuditProducer,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { and, eq } from 'drizzle-orm';
import { capacityPlanTeams, capacityPlans, projectSettings } from '../../../../../db/schema/work';
import { IProjectRepository, PROJECT_REPOSITORY } from '../domain/ports/project.repository';
import {
  IWorkflowStatusRepository,
  WORKFLOW_STATUS_REPOSITORY,
} from '../domain/ports/workflow-status.repository';
import { ILabelRepository, LABEL_REPOSITORY } from '../domain/ports/label.repository';
import {
  IProjectTeamRepository,
  PROJECT_TEAM_REPOSITORY,
} from '../domain/ports/project-team.repository';
import {
  IProjectMemberRepository,
  PROJECT_MEMBER_REPOSITORY,
} from '../domain/ports/project-member.repository';
import {
  IWorkspaceMemberRepository,
  WORKSPACE_MEMBER_REPOSITORY,
  TeamService,
} from '@modules/workspace';
import type {
  Project,
  ProjectWithStats,
  ProjectHealth,
  WorkflowStatus,
  WorkflowTransition,
  ProjectTeamLink,
  ProjectMember,
  CreateProjectRequest,
  UpdateProjectInput,
  CreateWorkflowStatusInput,
  CreateWorkflowTransitionInput,
  UpdateProjectMemberInput,
} from '../domain/project.types';
import { AccessService } from '@modules/access';
import { DEFAULT_WORKFLOW_STATUSES } from '../domain/project.constants';
import type { Label } from '../domain/label.types';
import type { WorkItemType } from '../domain/ports/project.repository';
import { ActivityLogger, type ActivityLog } from '@modules/activity';
import { PROJECT_ACTIVITY_CONFIG } from './project-activity-diff';

/**
 * Per-project T-shirt → points scale + hours/point (SRS §6.2), persisted in
 * `work.project_settings`. The application-layer shape; the HTTP DTO in
 * `project-request.dto.ts` mirrors it for the wire + codegen.
 */
export interface ProjectEstimationSettings {
  xsPoints: number;
  sPoints: number;
  mPoints: number;
  lPoints: number;
  xlPoints: number;
  hoursPerPoint: number;
}

/**
 * Fallback when a project has no `project_settings` row yet. Mirrors the column
 * DEFAULTs in migration 0106 AND the points in `DEFAULT_PRELIMINARY_ESTIMATE_MAP` —
 * a project is usable before a WA sets a scale, and the three must stay in step or
 * "M" means a different number on the settings form, the progress bar and the
 * capacity plan.
 */
const DEFAULT_PROJECT_ESTIMATION_SETTINGS: ProjectEstimationSettings = {
  xsPoints: 1,
  sPoints: 3,
  mPoints: 5,
  lPoints: 8,
  xlPoints: 13,
  hoursPerPoint: 8,
};

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: IProjectRepository,
    @Inject(WORKFLOW_STATUS_REPOSITORY) private readonly statusRepo: IWorkflowStatusRepository,
    @Inject(LABEL_REPOSITORY) private readonly labelRepo: ILabelRepository,
    @Inject(PROJECT_TEAM_REPOSITORY) private readonly projectTeamRepo: IProjectTeamRepository,
    @Inject(PROJECT_MEMBER_REPOSITORY) private readonly projectMemberRepo: IProjectMemberRepository,
    @Inject(WORKSPACE_MEMBER_REPOSITORY)
    private readonly workspaceMemberRepo: IWorkspaceMemberRepository,
    private readonly teamService: TeamService,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditProducer,
    private readonly activity: ActivityLogger,
    private readonly access: AccessService,
    @InjectDrizzle() private readonly db: DrizzleDB,
  ) {}

  // ── Revision History (activity log) ─────────────────────────────────────────

  /** Newest-first revision history for one project (workspace-view gated). */
  async getProjectActivity(
    actor: JwtPayload,
    projectId: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }> {
    await this.getProject(actor.workspaceId, projectId);
    const page = Math.floor(args.offset / args.limit) + 1;
    const res = await this.activity.listFor(projectId, actor.workspaceId, page, args.limit);
    return { items: res.data, total: res.total };
  }

  private projectSubject(p: Project) {
    return {
      workspaceId: p.workspaceId,
      projectId: p.id,
      entityType: 'project' as const,
      entityId: p.id,
    };
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  async listProjects(
    actor: JwtPayload,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<ProjectWithStats>> {
    /**
     * Only the projects this caller may READ.
     *
     * The query filtered on `workspace_id` + `deleted_at IS NULL` and nothing else, and the route
     * carried no `@RequirePermission` — so every project's key, name, description, owner, dates and
     * counts was readable by any authenticated principal, including one with zero role assignments.
     * PRJ-FR-001 says "List chỉ project user được phép truy cập trong workspace hiện tại", and §10 is
     * explicit that workspace membership alone does not confer project visibility.
     *
     * `listReadableProjectIds` is the primitive built for exactly this — its own docblock calls it "the
     * authorization fact behind every CROSS-PROJECT list" and Portfolio already uses it. `null` means
     * UNRESTRICTED (a workspace-wide grant, i.e. Workspace Admin); an empty array is a legitimate
     * "no projects" and must not be confused with it, which is why the sentinel exists.
     */
    const readable = await this.access.listReadableProjectIds(
      actor.workspaceId,
      actor.sub,
      'project:view',
    );
    return this.projectRepo.listByWorkspaceWithStats(actor.workspaceId, args, readable);
  }

  /** Home "Project Health" widget — bounded, attention-sorted per-project rollup. */
  async listProjectHealth(actor: JwtPayload, limit: number): Promise<ProjectHealth[]> {
    return this.projectRepo.listHealthByWorkspace(actor.workspaceId, { limit });
  }

  async createProject(actor: JwtPayload, input: CreateProjectRequest): Promise<Project> {
    const normalizedKey = input.key.toUpperCase().trim();

    const existing = await this.projectRepo.findByKey(actor.workspaceId, normalizedKey);
    if (existing) {
      throw new ConflictException(
        'PROJECT_KEY_TAKEN',
        `Project key "${normalizedKey}" is already taken`,
      );
    }

    // PRJ-FR-002/006: owner is required; default to the authenticated actor
    const resolvedLeadId = input.leadId ?? actor.sub;

    // PRJ-FR-006: validate that the resolved lead is an active workspace member
    const lead = await this.workspaceMemberRepo.findMember(actor.workspaceId, resolvedLeadId);
    if (!lead || lead.status !== 'active') {
      throw new PreconditionFailedException(
        'PROJECT_LEAD_NOT_MEMBER',
        'The project lead must be an active member of this workspace',
      );
    }

    // SRS §9: a project's end date must not precede its start date. ISO date
    // strings (YYYY-MM-DD) compare chronologically as plain strings.
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw new PreconditionFailedException(
        'PROJECT_INVALID_DATE_RANGE',
        'End date must be on or after start date',
      );
    }

    // Validate any teams to link on create belong to this workspace (mirrors the
    // leadId scope check). Dedupe so a repeated id can't violate the unique link.
    const teamIds = [...new Set(input.teamIds ?? [])];
    if (teamIds.length > 0) {
      const workspaceTeams = await this.teamService.listTeams(actor.workspaceId);
      const validTeamIds = new Set(workspaceTeams.map((t) => t.id));
      const missing = teamIds.filter((id) => !validTeamIds.has(id));
      if (missing.length > 0) {
        throw new PreconditionFailedException(
          'PROJECT_TEAM_NOT_FOUND',
          'One or more teams do not belong to this workspace',
        );
      }
    }

    const projectId = uuidv7();

    // PRJ-FR-003: create the project and seed its counter, owner membership,
    // default workflow statuses and team links in ONE transaction. A partial
    // failure here would otherwise leave a project with no statuses or no owner —
    // an unusable state.
    const project = await this.uow.run(async (tx) => {
      const created = await this.projectRepo.create(
        {
          id: projectId,
          workspaceId: actor.workspaceId,
          key: normalizedKey,
          name: input.name,
          description: input.description,
          leadId: resolvedLeadId,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
        },
        tx,
      );

      await this.projectRepo.initCounter(actor.workspaceId, tx);
      // RBAC migration Phase 4: no auto-lead project membership. The lead is a
      // display field; Project access (admin/editor/viewer) is granted
      // separately by Workspace Admin. The WA creator sees the project via
      // workspace:* regardless. SRS: "All normal users remain No Access until
      // Workspace Admin grants Project access."
      for (const s of DEFAULT_WORKFLOW_STATUSES) {
        await this.statusRepo.create(
          {
            id: uuidv7(),
            workspaceId: actor.workspaceId,
            projectId,
            name: s.name,
            category: s.category,
            color: s.color,
            position: s.position,
            isDefault: s.isDefault,
          },
          tx,
        );
      }

      for (const teamId of teamIds) {
        await this.projectTeamRepo.linkTeam(uuidv7(), actor.workspaceId, projectId, teamId, tx);
      }

      await this.audit.emit(
        {
          action: AUDIT_ACTION.PROJECT_CREATED,
          resourceType: AUDIT_RESOURCE.PROJECT,
          resourceId: projectId,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          projectId,
          changes: {
            after: {
              key: normalizedKey,
              name: input.name,
              leadId: resolvedLeadId,
              startDate: input.startDate ?? null,
              teamIds,
            },
          },
        },
        tx,
      );

      return created;
    });

    this.logger.log(
      { projectId, key: normalizedKey, leadId: resolvedLeadId, teamCount: teamIds.length },
      'Project created',
    );
    await this.activity.logSafe([
      this.activity.build(this.projectSubject(project), actor.sub, 'project.created', null),
    ]);
    return project;
  }

  async getProject(workspaceId: string, projectId: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId, workspaceId);
    if (!project || project.deletedAt || project.workspaceId !== workspaceId) {
      throw new NotFoundException('PROJECT_NOT_FOUND', 'Project not found');
    }
    return project;
  }

  async updateProject(
    actor: JwtPayload,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<Project> {
    const project = await this.getProject(actor.workspaceId, projectId);

    // PRJ-FR-010: archived projects are read-only; only a status restore is allowed
    if (project.status === 'archived' && input.status !== 'active') {
      throw new PreconditionFailedException(
        'PROJECT_ARCHIVED',
        'This project is archived and read-only. Only restoring it to active is permitted.',
      );
    }

    // SRS §9: end date must not precede start date, checked against the merged
    // (post-patch) values so changing either side alone is validated too.
    const nextStart = input.startDate !== undefined ? input.startDate : project.startDate;
    const nextEnd = input.endDate !== undefined ? input.endDate : project.endDate;
    if (nextStart && nextEnd && nextEnd < nextStart) {
      throw new PreconditionFailedException(
        'PROJECT_INVALID_DATE_RANGE',
        'End date must be on or after start date',
      );
    }

    // G-6: archive or restore requires the actor to be a project member
    const isStatusChange =
      input.status === 'archived' || (project.status === 'archived' && input.status === 'active');
    if (isStatusChange) {
      const membership = await this.projectMemberRepo.findMember(projectId, actor.sub);
      if (!membership || membership.status !== 'active') {
        throw new PermissionDeniedException(
          'PROJECT_PERMISSION_DENIED',
          'You must be an active project member to archive or restore this project',
        );
      }
    }

    // PRJ-FR-006: if changing leadId, validate new lead is an active workspace member
    if (input.leadId !== undefined && input.leadId !== null) {
      const lead = await this.workspaceMemberRepo.findMember(project.workspaceId, input.leadId);
      if (!lead || lead.status !== 'active') {
        throw new PreconditionFailedException(
          'PROJECT_LEAD_NOT_MEMBER',
          'The project lead must be an active member of this workspace',
        );
      }
    }

    const isArchiving = project.status !== 'archived' && input.status === 'archived';

    const after = await this.uow.run(async (tx) => {
      const updated = await this.projectRepo.update(projectId, input, actor.workspaceId, tx);
      await this.audit.emit(
        {
          action: isArchiving ? AUDIT_ACTION.PROJECT_ARCHIVED : AUDIT_ACTION.PROJECT_UPDATED,
          resourceType: AUDIT_RESOURCE.PROJECT,
          resourceId: projectId,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          projectId,
          changes: { before: project, after: updated },
        },
        tx,
      );
      return updated;
    });

    await this.activity.logSafe(
      this.activity.buildDiff(
        this.projectSubject(after),
        actor.sub,
        project as unknown as Record<string, unknown>,
        input as Record<string, unknown>,
        PROJECT_ACTIVITY_CONFIG,
        'project.updated',
      ),
    );
    return after;
  }

  async deleteProject(workspaceId: string, projectId: string): Promise<void> {
    await this.getProject(workspaceId, projectId);
    await this.projectRepo.softDelete(projectId, workspaceId);
    this.logger.log({ projectId }, 'Project soft-deleted');
  }

  // ── Estimation Settings (SRS §6.2) ────────────────────────────────────────

  /**
   * Read the per-project estimate scale. Falls back to the defaults when no row exists,
   * so the settings form, the progress bars and `forProject()` all agree before a WA
   * has configured anything. Existence is checked first — a bad or cross-workspace id
   * is a 404, not silently the default scale for a project that does not exist.
   */
  async getEstimationSettings(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectEstimationSettings> {
    await this.getProject(workspaceId, projectId);
    const rows = await this.db
      .select()
      .from(projectSettings)
      .where(
        and(eq(projectSettings.projectId, projectId), eq(projectSettings.workspaceId, workspaceId)),
      )
      .limit(1);
    const s = rows[0];
    if (!s) return { ...DEFAULT_PROJECT_ESTIMATION_SETTINGS };
    return {
      xsPoints: s.xsPoints,
      sPoints: s.sPoints,
      mPoints: s.mPoints,
      lPoints: s.lPoints,
      xlPoints: s.xlPoints,
      // numeric(8,2) returns a string; the wire type is a number.
      hoursPerPoint: Number(s.hoursPerPoint),
    };
  }

  /**
   * Partial update of the estimate scale. Merges onto the current values (PATCH, not
   * replace) so a WA editing one size does not reset the others, then upserts the single
   * `project_settings` row in one transaction with the audit event. `workspace:edit` on
   * the route already proved the actor is a Workspace Admin — the BA scope for this
   * setting — so there is no second authorisation check here.
   */
  async updateEstimationSettings(
    actor: JwtPayload,
    projectId: string,
    input: Partial<ProjectEstimationSettings>,
  ): Promise<ProjectEstimationSettings> {
    // Resolves existence + workspace scope (404 on miss/cross-workspace) and carries
    // workspaceId into the upsert row.
    const project = await this.getProject(actor.workspaceId, projectId);
    const before = await this.getEstimationSettings(actor.workspaceId, projectId);
    const after = { ...before, ...input };

    return this.uow.run(async (tx) => {
      await tx
        .insert(projectSettings)
        .values({
          workspaceId: project.workspaceId,
          projectId: project.id,
          xsPoints: after.xsPoints,
          sPoints: after.sPoints,
          mPoints: after.mPoints,
          lPoints: after.lPoints,
          xlPoints: after.xlPoints,
          hoursPerPoint: String(after.hoursPerPoint),
        })
        .onConflictDoUpdate({
          target: projectSettings.projectId,
          set: {
            xsPoints: after.xsPoints,
            sPoints: after.sPoints,
            mPoints: after.mPoints,
            lPoints: after.lPoints,
            xlPoints: after.xlPoints,
            hoursPerPoint: String(after.hoursPerPoint),
            updatedAt: new Date(),
          },
        });
      await this.audit.emit(
        {
          action: AUDIT_ACTION.PROJECT_UPDATED,
          resourceType: AUDIT_RESOURCE.PROJECT,
          resourceId: projectId,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          projectId,
          changes: { before, after },
        },
        tx,
      );
      return after;
    });
  }

  // ── Workflow statuses ─────────────────────────────────────────────────────

  async listStatuses(workspaceId: string, projectId: string): Promise<WorkflowStatus[]> {
    await this.getProject(workspaceId, projectId);
    return this.statusRepo.listByProject(projectId);
  }

  async listTransitions(workspaceId: string, projectId: string): Promise<WorkflowTransition[]> {
    await this.getProject(workspaceId, projectId);
    return this.statusRepo.listTransitions(projectId);
  }

  /** Used by work-items to validate a status transition is permitted. */
  async assertTransitionAllowed(
    projectId: string,
    fromStatusId: string,
    toStatusId: string,
  ): Promise<void> {
    const allowed = await this.statusRepo.canTransition(projectId, fromStatusId, toStatusId);
    if (!allowed) {
      throw new PreconditionFailedException(
        'WORKFLOW_TRANSITION_NOT_ALLOWED',
        'This status transition is not permitted',
      );
    }
  }

  /**
   * Used by work-items to validate that a proposed assignee is an active member
   * of the workspace that owns the project (P1-15 scope validation).
   */
  async assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    const member = await this.workspaceMemberRepo.findMember(workspaceId, userId);
    if (!member || member.status !== 'active') {
      throw new PreconditionFailedException(
        'ASSIGNEE_NOT_WORKSPACE_MEMBER',
        'The assigned user is not an active member of this workspace',
      );
    }
  }

  /**
   * Used by work-items to validate that a label belongs to the project (P1-15
   * scope validation).
   */
  async assertLabelBelongsToProject(projectId: string, labelId: string): Promise<void> {
    const label = await this.labelRepo.findById(labelId);
    if (!label || label.projectId !== projectId) {
      throw new NotFoundException(
        'LABEL_NOT_FOUND',
        'Label not found or does not belong to this project',
      );
    }
  }

  /** Used by work-items to generate the next sequential item key (e.g. "US-42"). */
  // `IN`/`FE` are gone with the initiative/feature work-item types. Portfolio items
  // mint their own `EP-`/`FE-` keys from work.portfolio_items (P5.1).
  private static readonly TYPE_PREFIX: Record<WorkItemType, string> = {
    story: 'US',
    task: 'TA',
    defect: 'DE',
  };

  async generateItemKey(
    workspaceId: string,
    projectId: string,
    type: WorkItemType,
  ): Promise<string> {
    const project = await this.getProject(workspaceId, projectId);
    // PRJ-FR-010: archived projects are read-only; block new work item creation
    if (project.status === 'archived') {
      throw new PreconditionFailedException(
        'PROJECT_ARCHIVED',
        'Cannot create work items in an archived project.',
      );
    }
    const prefix = ProjectsService.TYPE_PREFIX[type];
    // Rally FormattedID: the sequence is per-(workspace, type), so US-42 is unique
    // across the whole workspace (not per project). projectId is still used above
    // only to enforce the archived-project guard.
    const seq = await this.projectRepo.incrementCounter(workspaceId, type);
    // Type-prefix + hyphen convention (e.g. US-42, DE-1); no zero-padding.
    return `${prefix}-${seq}`;
  }

  // ── Workflow status mutations ──────────────────────────────────────────────

  async createStatus(
    workspaceId: string,
    projectId: string,
    input: Omit<CreateWorkflowStatusInput, 'id' | 'workspaceId' | 'projectId'>,
  ): Promise<WorkflowStatus> {
    await this.getProject(workspaceId, projectId);
    const statuses = await this.statusRepo.listByProject(projectId);
    return this.statusRepo.create({
      id: uuidv7(),
      workspaceId,
      projectId,
      name: input.name,
      category: input.category,
      color: input.color,
      position: input.position ?? statuses.length,
      isDefault: input.isDefault ?? false,
    });
  }

  async deleteStatus(workspaceId: string, projectId: string, statusId: string): Promise<void> {
    await this.getProject(workspaceId, projectId);
    const status = await this.statusRepo.findById(statusId);
    if (!status || status.projectId !== projectId) {
      throw new NotFoundException('WORKFLOW_STATUS_NOT_FOUND', 'Workflow status not found');
    }
    await this.statusRepo.delete(statusId);
  }

  async reorderStatuses(
    workspaceId: string,
    projectId: string,
    orderedIds: string[],
  ): Promise<void> {
    await this.getProject(workspaceId, projectId);
    await this.statusRepo.updatePositions(projectId, orderedIds);
  }

  // ── Workflow transition mutations ─────────────────────────────────────────

  async createTransition(
    workspaceId: string,
    projectId: string,
    input: Omit<CreateWorkflowTransitionInput, 'id' | 'workspaceId' | 'projectId'>,
  ): Promise<WorkflowTransition> {
    await this.getProject(workspaceId, projectId);
    // Both endpoints must be statuses of THIS project (mirrors deleteStatus's
    // project-scope check) so a transition can never reference a status from
    // another project/workspace. `fromStatusId` is nullable — null means "from
    // any status" (a global transition), so it is only validated when provided.
    const [from, to] = await Promise.all([
      input.fromStatusId ? this.statusRepo.findById(input.fromStatusId) : Promise.resolve(null),
      this.statusRepo.findById(input.toStatusId),
    ]);
    if (input.fromStatusId && (!from || from.projectId !== projectId)) {
      throw new NotFoundException(
        'WORKFLOW_STATUS_NOT_FOUND',
        'Transition references a status that does not belong to this project',
      );
    }
    if (!to || to.projectId !== projectId) {
      throw new NotFoundException(
        'WORKFLOW_STATUS_NOT_FOUND',
        'Transition references a status that does not belong to this project',
      );
    }
    return this.statusRepo.createTransition({
      id: uuidv7(),
      workspaceId,
      projectId,
      fromStatusId: input.fromStatusId,
      toStatusId: input.toStatusId,
      name: input.name,
    });
  }

  async deleteTransition(
    workspaceId: string,
    projectId: string,
    transitionId: string,
  ): Promise<void> {
    await this.getProject(workspaceId, projectId);
    const transition = await this.statusRepo.findTransitionById(transitionId);
    if (!transition || transition.projectId !== projectId) {
      throw new NotFoundException('WORKFLOW_STATUS_NOT_FOUND', 'Workflow transition not found');
    }
    await this.statusRepo.deleteTransition(transitionId);
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  async listLabels(workspaceId: string, projectId: string): Promise<Label[]> {
    await this.getProject(workspaceId, projectId);
    return this.labelRepo.listByProject(projectId, workspaceId);
  }

  async createLabel(
    workspaceId: string,
    projectId: string,
    name: string,
    color?: string,
  ): Promise<Label> {
    await this.getProject(workspaceId, projectId);
    return this.labelRepo.create({ id: uuidv7(), workspaceId, projectId, name, color });
  }

  async updateLabel(
    workspaceId: string,
    projectId: string,
    labelId: string,
    input: { name?: string; color?: string },
  ): Promise<Label> {
    await this.getProject(workspaceId, projectId);
    const label = await this.labelRepo.findById(labelId);
    if (!label || label.projectId !== projectId || label.workspaceId !== workspaceId) {
      throw new NotFoundException('LABEL_NOT_FOUND', 'Label not found');
    }
    return this.labelRepo.update(labelId, input);
  }

  async deleteLabel(workspaceId: string, projectId: string, labelId: string): Promise<void> {
    await this.getProject(workspaceId, projectId);
    const label = await this.labelRepo.findById(labelId);
    if (!label || label.projectId !== projectId || label.workspaceId !== workspaceId) {
      throw new NotFoundException('LABEL_NOT_FOUND', 'Label not found');
    }
    await this.labelRepo.delete(labelId);
    this.logger.log({ labelId, projectId }, 'Label deleted');
  }

  // ── Project Teams ─────────────────────────────────────────────────────────

  async listProjectTeams(workspaceId: string, projectId: string): Promise<ProjectTeamLink[]> {
    await this.getProject(workspaceId, projectId);
    return this.projectTeamRepo.listByProject(projectId);
  }

  /**
   * Single source of truth for the "team must be linked to this project" rule
   * (SRS P1-MANAGE-ORG). Other modules (work items, iterations) delegate here
   * instead of re-implementing the check, so the rule — and any future
   * extension of it (e.g. status filters, effective-dating) — lives in exactly
   * one place. Throws PROJECT_TEAM_LINK_NOT_FOUND when the team is not actively
   * linked to the project.
   */
  async assertTeamLinkedToProject(
    workspaceId: string,
    projectId: string,
    teamId: string,
  ): Promise<void> {
    const links = await this.listProjectTeams(workspaceId, projectId);
    const linked = links.some((l) => l.teamId === teamId && l.status === 'active');
    if (!linked) {
      throw new PreconditionFailedException(
        'PROJECT_TEAM_LINK_NOT_FOUND',
        'Team is not linked to this project',
      );
    }
  }

  async linkTeam(workspaceId: string, projectId: string, teamId: string): Promise<ProjectTeamLink> {
    await this.getProject(workspaceId, projectId);

    // The team must belong to the same workspace (mirrors the create-project
    // team validation) — prevents linking a team from another workspace/tenant.
    const workspaceTeams = await this.teamService.listTeams(workspaceId);
    if (!workspaceTeams.some((t) => t.id === teamId)) {
      throw new PreconditionFailedException(
        'PROJECT_TEAM_NOT_FOUND',
        'Team does not belong to this workspace',
      );
    }

    const existing = await this.projectTeamRepo.findLink(projectId, teamId);
    if (existing) {
      throw new ConflictException(
        'PROJECT_TEAM_ALREADY_LINKED',
        'Team is already linked to this project',
      );
    }

    const link = await this.projectTeamRepo.linkTeam(uuidv7(), workspaceId, projectId, teamId);
    this.logger.log({ projectId, teamId }, 'Team linked to project');
    return link;
  }

  async unlinkTeam(workspaceId: string, projectId: string, teamId: string): Promise<void> {
    await this.getProject(workspaceId, projectId);

    const existing = await this.projectTeamRepo.findLink(projectId, teamId);
    if (!existing) {
      throw new NotFoundException(
        'PROJECT_TEAM_LINK_NOT_FOUND',
        'Team is not linked to this project',
      );
    }

    /**
     * REFUSED while the team is on one of this project's capacity plans, naming the plans.
     *
     * `project_teams` is a soft status flip, so `fk_capacity_plan_teams_team ON DELETE RESTRICT`
     * never fires and nothing stopped an unlink from leaving the team's plan row and its allocations
     * behind — precisely the state migration 0085 had to clean up. Releases already refuse deletion
     * for a plan that depends on them (`RELEASE_HAS_CAPACITY_PLAN`); this is the same rule for the
     * other reference.
     *
     * `Remove Team` on the plan is the deliberate action, and it re-parks the demand as unassigned
     * (AC-005) rather than losing it — which is why refusing here costs the planner nothing.
     */
    const plans = await this.db
      .select({ planKey: capacityPlans.planKey, name: capacityPlans.name })
      .from(capacityPlanTeams)
      .innerJoin(capacityPlans, eq(capacityPlans.id, capacityPlanTeams.planId))
      .where(
        and(
          eq(capacityPlanTeams.teamId, teamId),
          eq(capacityPlans.projectId, projectId),
          eq(capacityPlans.workspaceId, workspaceId),
        ),
      )
      // `id` breaks the tie: `plan_key` is unique per project, not per workspace, and the
      // ordering ratchet requires the last column to be unique so two runs cannot disagree.
      .orderBy(capacityPlans.planKey, capacityPlans.id)
      .limit(3);
    if (plans.length > 0) {
      const named = plans.map((row) => `${row.planKey} (${row.name})`).join(', ');
      throw new PreconditionFailedException(
        'PROJECT_TEAM_HAS_CAPACITY_PLAN',
        `This team is on ${named} — remove it from the plan before unlinking it from the project`,
      );
    }

    await this.projectTeamRepo.unlinkTeam(projectId, teamId);
    this.logger.log({ projectId, teamId }, 'Team unlinked from project');
  }

  // ── Project Members ───────────────────────────────────────────────────────

  async listProjectMembers(workspaceId: string, projectId: string): Promise<ProjectMember[]> {
    await this.getProject(workspaceId, projectId);
    return this.projectMemberRepo.listByProject(projectId);
  }

  async addProjectMember(
    workspaceId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectMember> {
    await this.getProject(workspaceId, projectId);

    // A project member must first be an active member of the owning workspace —
    // same rule enforced for a project's lead (PRJ-FR-006) and a work item's
    // assignee (P1-15). Prevents adding a user from another workspace/tenant.
    await this.assertWorkspaceMember(workspaceId, userId);

    const existing = await this.projectMemberRepo.findMember(projectId, userId);
    if (existing) {
      throw new ConflictException(
        'PROJECT_MEMBER_ALREADY_EXISTS',
        'User is already a member of this project',
      );
    }

    const member = await this.projectMemberRepo.addMember({
      id: uuidv7(),
      workspaceId,
      projectId,
      userId,
    });
    // RBAC migration Phase 4: invalidate so the new access_level lands on the
    // user's next request, not the 5-min cache TTL.
    await this.access.invalidateUser(workspaceId, userId);
    this.logger.log({ projectId, userId }, 'Project member added');
    return member;
  }

  async updateProjectMember(
    workspaceId: string,
    projectId: string,
    memberId: string,
    input: UpdateProjectMemberInput,
  ): Promise<ProjectMember> {
    await this.getProject(workspaceId, projectId);

    const member = await this.projectMemberRepo.findMemberById(memberId);
    if (!member || member.projectId !== projectId) {
      throw new NotFoundException('PROJECT_MEMBER_NOT_FOUND', 'Project member not found');
    }

    const updated = await this.projectMemberRepo.updateMember(memberId, input);
    await this.access.invalidateUser(workspaceId, member.userId);
    return updated;
  }

  async removeProjectMember(workspaceId: string, projectId: string, userId: string): Promise<void> {
    await this.getProject(workspaceId, projectId);

    const existing = await this.projectMemberRepo.findMember(projectId, userId);
    if (!existing) {
      throw new NotFoundException(
        'PROJECT_MEMBER_NOT_FOUND',
        'User is not a member of this project',
      );
    }

    await this.projectMemberRepo.removeMember(projectId, userId);
    // RBAC migration Phase 4: invalidate so the removal (No Access) lands on the
    // user's next request.
    await this.access.invalidateUser(workspaceId, userId);
    this.logger.log({ projectId, userId }, 'Project member removed');
  }
}
