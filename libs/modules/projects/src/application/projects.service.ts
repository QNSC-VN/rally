import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  PermissionDeniedException,
  UnitOfWork,
  AuditProducer,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult } from '@platform';
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
import { DEFAULT_WORKFLOW_STATUSES } from '../domain/project.constants';
import type { Label } from '../domain/label.types';
import type { WorkItemType } from '../domain/ports/project.repository';

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
  ) {}

  // ── Projects ──────────────────────────────────────────────────────────────

  async listProjects(
    actor: JwtPayload,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<ProjectWithStats>> {
    return this.projectRepo.listByWorkspaceWithStats(actor.workspaceId, args);
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
        },
        tx,
      );

      await this.projectRepo.initCounter(projectId, actor.workspaceId, tx);
      await this.projectMemberRepo.addMember(
        {
          id: uuidv7(),
          workspaceId: actor.workspaceId,
          projectId,
          userId: resolvedLeadId,
        },
        tx,
      );
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

    return this.uow.run(async (tx) => {
      const after = await this.projectRepo.update(projectId, input, actor.workspaceId, tx);
      await this.audit.emit(
        {
          action: isArchiving ? AUDIT_ACTION.PROJECT_ARCHIVED : AUDIT_ACTION.PROJECT_UPDATED,
          resourceType: AUDIT_RESOURCE.PROJECT,
          resourceId: projectId,
          workspaceId: actor.workspaceId,
          actor: { id: actor.sub },
          projectId,
          changes: { before: project, after },
        },
        tx,
      );
      return after;
    });
  }

  async deleteProject(workspaceId: string, projectId: string): Promise<void> {
    await this.getProject(workspaceId, projectId);
    await this.projectRepo.softDelete(projectId, workspaceId);
    this.logger.log({ projectId }, 'Project soft-deleted');
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
  private static readonly TYPE_PREFIX: Record<WorkItemType, string> = {
    initiative: 'IN',
    feature: 'FE',
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
    const seq = await this.projectRepo.incrementCounter(projectId, workspaceId, type);
    // Item keys follow the type-prefix + hyphen convention (e.g. US-42, DE-1), matching
    // the product UI/UX. The per-type counter provides the sequence; no zero-padding.
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

  async linkTeam(workspaceId: string, projectId: string, teamId: string): Promise<ProjectTeamLink> {
    await this.getProject(workspaceId, projectId);

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
    roleId?: string,
  ): Promise<ProjectMember> {
    await this.getProject(workspaceId, projectId);

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
      roleId,
    });
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

    return this.projectMemberRepo.updateMember(memberId, input);
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
    this.logger.log({ projectId, userId }, 'Project member removed');
  }
}
