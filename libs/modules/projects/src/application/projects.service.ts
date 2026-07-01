import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  PermissionDeniedException,
  UnitOfWork,
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
import { IWorkspaceMemberRepository, WORKSPACE_MEMBER_REPOSITORY } from '@modules/tenancy';
import type {
  Project,
  ProjectWithStats,
  WorkflowStatus,
  WorkflowTransition,
  ProjectTeamLink,
  ProjectMember,
  UpdateProjectInput,
  CreateWorkflowStatusInput,
  CreateWorkflowTransitionInput,
  UpdateProjectMemberInput,
} from '../domain/project.types';
import { DEFAULT_WORKFLOW_STATUSES } from '../domain/project.constants';
import type { Label } from '../domain/label.types';

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
    private readonly uow: UnitOfWork,
  ) {}

  // ── Projects ──────────────────────────────────────────────────────────────

  async listProjects(
    actor: JwtPayload,
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<ProjectWithStats>> {
    return this.projectRepo.listByWorkspaceWithStats(workspaceId, actor.tenantId, args);
  }

  async createProject(
    actor: JwtPayload,
    workspaceId: string,
    key: string,
    name: string,
    description?: string,
    leadId?: string,
  ): Promise<Project> {
    const normalizedKey = key.toUpperCase().trim();

    const existing = await this.projectRepo.findByKey(actor.tenantId, normalizedKey);
    if (existing) {
      throw new ConflictException(
        'PROJECT_KEY_TAKEN',
        `Project key "${normalizedKey}" is already taken`,
      );
    }

    // PRJ-FR-002/006: owner is required; default to the authenticated actor
    const resolvedLeadId = leadId ?? actor.sub;

    // PRJ-FR-006: validate that the resolved lead is an active workspace member
    const lead = await this.workspaceMemberRepo.findMember(workspaceId, resolvedLeadId);
    if (!lead || lead.status !== 'active') {
      throw new PreconditionFailedException(
        'PROJECT_LEAD_NOT_MEMBER',
        'The project lead must be an active member of this workspace',
      );
    }

    const projectId = uuidv7();

    // PRJ-FR-003: create the project and seed its counter, owner membership and
    // default workflow statuses in ONE transaction. A partial failure here would
    // otherwise leave a project with no statuses or no owner — unusable state.
    const project = await this.uow.run(async (tx) => {
      const created = await this.projectRepo.create(
        {
          id: projectId,
          tenantId: actor.tenantId,
          workspaceId,
          key: normalizedKey,
          name,
          description,
          leadId: resolvedLeadId,
        },
        tx,
      );

      await this.projectRepo.initCounter(projectId, actor.tenantId, tx);
      await this.projectMemberRepo.addMember(
        {
          id: uuidv7(),
          tenantId: actor.tenantId,
          projectId,
          userId: resolvedLeadId,
        },
        tx,
      );
      for (const s of DEFAULT_WORKFLOW_STATUSES) {
        await this.statusRepo.create(
          {
            id: uuidv7(),
            tenantId: actor.tenantId,
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

      return created;
    });

    this.logger.log(
      { projectId, key: normalizedKey, leadId: resolvedLeadId, userId: actor.sub },
      'Project created',
    );
    return project;
  }

  async getProject(tenantId: string, projectId: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    if (!project || project.deletedAt || project.tenantId !== tenantId) {
      throw new NotFoundException('PROJECT_NOT_FOUND', 'Project not found');
    }
    return project;
  }

  async updateProject(
    actor: JwtPayload,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<Project> {
    const project = await this.getProject(actor.tenantId, projectId);

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

    return this.projectRepo.update(projectId, input);
  }

  async deleteProject(tenantId: string, projectId: string): Promise<void> {
    await this.getProject(tenantId, projectId);
    await this.projectRepo.softDelete(projectId);
    this.logger.log({ projectId }, 'Project soft-deleted');
  }

  // ── Workflow statuses ─────────────────────────────────────────────────────

  async listStatuses(tenantId: string, projectId: string): Promise<WorkflowStatus[]> {
    await this.getProject(tenantId, projectId);
    return this.statusRepo.listByProject(projectId);
  }

  async listTransitions(tenantId: string, projectId: string): Promise<WorkflowTransition[]> {
    await this.getProject(tenantId, projectId);
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

  /** Used by work-items to generate the next sequential item key (e.g. "PROJ-42"). */
  async generateItemKey(tenantId: string, projectId: string): Promise<string> {
    const project = await this.getProject(tenantId, projectId);
    // PRJ-FR-010: archived projects are read-only; block new work item creation
    if (project.status === 'archived') {
      throw new PreconditionFailedException(
        'PROJECT_ARCHIVED',
        'Cannot create work items in an archived project.',
      );
    }
    const seq = await this.projectRepo.incrementCounter(projectId);
    return `${project.key}-${seq}`;
  }

  // ── Workflow status mutations ──────────────────────────────────────────────

  async createStatus(
    tenantId: string,
    projectId: string,
    input: Omit<CreateWorkflowStatusInput, 'id' | 'tenantId' | 'projectId'>,
  ): Promise<WorkflowStatus> {
    await this.getProject(tenantId, projectId);
    const statuses = await this.statusRepo.listByProject(projectId);
    return this.statusRepo.create({
      id: uuidv7(),
      tenantId,
      projectId,
      name: input.name,
      category: input.category,
      color: input.color,
      position: input.position ?? statuses.length,
      isDefault: input.isDefault ?? false,
    });
  }

  async deleteStatus(tenantId: string, projectId: string, statusId: string): Promise<void> {
    await this.getProject(tenantId, projectId);
    const status = await this.statusRepo.findById(statusId);
    if (!status || status.projectId !== projectId) {
      throw new NotFoundException('WORKFLOW_STATUS_NOT_FOUND', 'Workflow status not found');
    }
    await this.statusRepo.delete(statusId);
  }

  async reorderStatuses(tenantId: string, projectId: string, orderedIds: string[]): Promise<void> {
    await this.getProject(tenantId, projectId);
    await this.statusRepo.updatePositions(projectId, orderedIds);
  }

  // ── Workflow transition mutations ─────────────────────────────────────────

  async createTransition(
    tenantId: string,
    projectId: string,
    input: Omit<CreateWorkflowTransitionInput, 'id' | 'tenantId' | 'projectId'>,
  ): Promise<WorkflowTransition> {
    await this.getProject(tenantId, projectId);
    return this.statusRepo.createTransition({
      id: uuidv7(),
      tenantId,
      projectId,
      fromStatusId: input.fromStatusId,
      toStatusId: input.toStatusId,
      name: input.name,
    });
  }

  async deleteTransition(tenantId: string, projectId: string, transitionId: string): Promise<void> {
    await this.getProject(tenantId, projectId);
    const transition = await this.statusRepo.findTransitionById(transitionId);
    if (!transition || transition.projectId !== projectId) {
      throw new NotFoundException('WORKFLOW_STATUS_NOT_FOUND', 'Workflow transition not found');
    }
    await this.statusRepo.deleteTransition(transitionId);
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  async listLabels(tenantId: string, projectId: string): Promise<Label[]> {
    await this.getProject(tenantId, projectId);
    return this.labelRepo.listByProject(projectId, tenantId);
  }

  async createLabel(
    tenantId: string,
    projectId: string,
    name: string,
    color?: string,
  ): Promise<Label> {
    await this.getProject(tenantId, projectId);
    return this.labelRepo.create({ id: uuidv7(), tenantId, projectId, name, color });
  }

  async updateLabel(
    tenantId: string,
    projectId: string,
    labelId: string,
    input: { name?: string; color?: string },
  ): Promise<Label> {
    await this.getProject(tenantId, projectId);
    const label = await this.labelRepo.findById(labelId);
    if (!label || label.projectId !== projectId || label.tenantId !== tenantId) {
      throw new NotFoundException('LABEL_NOT_FOUND', 'Label not found');
    }
    return this.labelRepo.update(labelId, input);
  }

  async deleteLabel(tenantId: string, projectId: string, labelId: string): Promise<void> {
    await this.getProject(tenantId, projectId);
    const label = await this.labelRepo.findById(labelId);
    if (!label || label.projectId !== projectId || label.tenantId !== tenantId) {
      throw new NotFoundException('LABEL_NOT_FOUND', 'Label not found');
    }
    await this.labelRepo.delete(labelId);
    this.logger.log({ labelId, projectId }, 'Label deleted');
  }

  // ── Project Teams ─────────────────────────────────────────────────────────

  async listProjectTeams(tenantId: string, projectId: string): Promise<ProjectTeamLink[]> {
    await this.getProject(tenantId, projectId);
    return this.projectTeamRepo.listByProject(projectId);
  }

  async linkTeam(tenantId: string, projectId: string, teamId: string): Promise<ProjectTeamLink> {
    await this.getProject(tenantId, projectId);

    const existing = await this.projectTeamRepo.findLink(projectId, teamId);
    if (existing) {
      throw new ConflictException(
        'PROJECT_TEAM_ALREADY_LINKED',
        'Team is already linked to this project',
      );
    }

    const link = await this.projectTeamRepo.linkTeam(uuidv7(), tenantId, projectId, teamId);
    this.logger.log({ projectId, teamId }, 'Team linked to project');
    return link;
  }

  async unlinkTeam(tenantId: string, projectId: string, teamId: string): Promise<void> {
    await this.getProject(tenantId, projectId);

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

  async listProjectMembers(tenantId: string, projectId: string): Promise<ProjectMember[]> {
    await this.getProject(tenantId, projectId);
    return this.projectMemberRepo.listByProject(projectId);
  }

  async addProjectMember(
    tenantId: string,
    projectId: string,
    userId: string,
    roleId?: string,
  ): Promise<ProjectMember> {
    await this.getProject(tenantId, projectId);

    const existing = await this.projectMemberRepo.findMember(projectId, userId);
    if (existing) {
      throw new ConflictException(
        'PROJECT_MEMBER_ALREADY_EXISTS',
        'User is already a member of this project',
      );
    }

    const member = await this.projectMemberRepo.addMember({
      id: uuidv7(),
      tenantId,
      projectId,
      userId,
      roleId,
    });
    this.logger.log({ projectId, userId }, 'Project member added');
    return member;
  }

  async updateProjectMember(
    tenantId: string,
    projectId: string,
    memberId: string,
    input: UpdateProjectMemberInput,
  ): Promise<ProjectMember> {
    await this.getProject(tenantId, projectId);

    const member = await this.projectMemberRepo.findMemberById(memberId);
    if (!member || member.projectId !== projectId) {
      throw new NotFoundException('PROJECT_MEMBER_NOT_FOUND', 'Project member not found');
    }

    return this.projectMemberRepo.updateMember(memberId, input);
  }

  async removeProjectMember(tenantId: string, projectId: string, userId: string): Promise<void> {
    await this.getProject(tenantId, projectId);

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
