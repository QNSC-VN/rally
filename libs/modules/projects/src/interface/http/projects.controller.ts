import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors, ApiPagedResponse, buildPageArgs } from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { CurrentUser } from '@modules/identity';
import { RequirePermission, AuthPolicy, AuthorizedInService } from '@modules/access';
import { ProjectsService } from '../../application/projects.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  ProjectQueryDto,
  CreateLabelDto,
  UpdateLabelDto,
  UpdateProjectMemberDto,
} from './dto/project-request.dto';
import {
  ProjectResponseDto,
  ProjectHealthResponseDto,
  WorkflowStatusResponseDto,
  WorkflowTransitionResponseDto,
  LabelResponseDto,
  ProjectMemberResponseDto,
} from './dto/project-response.dto';
import type {
  Project,
  ProjectMember,
  WorkflowStatus,
  WorkflowTransition,
} from '../../domain/project.types';
import type { Label } from '../../domain/label.types';
import {
  ActivityQueryDto,
  ActivityResponseDto,
  ActivityPageDto,
  type ActivityLog,
} from '@modules/activity';

function toActivityDto(a: ActivityLog): ActivityResponseDto {
  return {
    id: a.id,
    createdAt: a.createdAt,
    actorId: a.actorId,
    actorName: a.actorName,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    changes: a.changes,
    metadata: a.metadata ?? {},
  };
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function toProjectDto(
  p: Project & { memberCount?: number; teamCount?: number; leadName?: string | null },
): ProjectResponseDto {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    key: p.key,
    name: p.name,
    description: p.description,
    leadId: p.leadId,
    leadName: p.leadName ?? null,
    startDate: p.startDate ?? null,
    endDate: p.endDate ?? null,
    status: p.status,
    memberCount: p.memberCount ?? 0,
    teamCount: p.teamCount ?? 0,
    settings: p.settings,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toStatusDto(s: WorkflowStatus): WorkflowStatusResponseDto {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    category: s.category,
    color: s.color,
    position: s.position,
    isDefault: s.isDefault,
  };
}

function toTransitionDto(t: WorkflowTransition): WorkflowTransitionResponseDto {
  return {
    id: t.id,
    projectId: t.projectId,
    fromStatusId: t.fromStatusId,
    toStatusId: t.toStatusId,
    name: t.name,
    requiredRole: t.requiredRole,
  };
}

function toLabelDto(l: Label): LabelResponseDto {
  return {
    id: l.id,
    projectId: l.projectId,
    name: l.name,
    color: l.color,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

function toProjectMemberDto(m: ProjectMember): ProjectMemberResponseDto {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    projectId: m.projectId,
    userId: m.userId,
    accessLevel: (m.accessLevel as 'admin' | 'editor' | null) ?? null,
    status: m.status,
    joinedAt: m.joinedAt instanceof Date ? m.joinedAt.toISOString() : m.joinedAt,
    updatedAt: m.updatedAt instanceof Date ? m.updatedAt.toISOString() : m.updatedAt,
    displayName: m.displayName ?? null,
    email: m.email ?? null,
    avatarUrl: m.avatarUrl ?? null,
  };
}

// ── Controller ───────────────────────────────────────────────────────────────

@ApiTags('projects')
@Controller('projects')
// AuthPolicy bundles JwtAuth → PolicyGuard in a guaranteed order. Each route
// declares its own @RequirePermission; a route with none is authenticated-only.
@AuthPolicy()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── List projects ──────────────────────────────────────────────────────────

  @Get()
  @AuthorizedInService(
    'cross-project list scoped by AccessService.listReadableProjectIds, whose null sentinel means UNRESTRICTED and [] means nothing — a distinction a scope descriptor cannot carry',
    'project-authz.e2e.spec.ts',
  )
  @ApiOperation({ summary: 'List projects in a workspace' })
  @ApiPagedResponse(ProjectResponseDto)
  @ApiCommonErrors(400, 401)
  async listProjects(
    @CurrentUser() user: JwtPayload,
    @Query() query: ProjectQueryDto,
  ): Promise<PagedResult<ProjectResponseDto>> {
    const args = buildPageArgs(query);
    const page = await this.projectsService.listProjects(user, args);
    return { data: page.data.map(toProjectDto), pageInfo: page.pageInfo };
  }

  // ── Project health (Home widget) ─────────────────────────────────────────────
  // Declared before @Get(':id') so the static path is not captured as an :id.

  @Get('health')
  @AuthorizedInService(
    'scoped by listReadableProjectIds, like the list above',
    'project-authz.e2e.spec.ts',
  )
  @ApiOperation({ summary: 'Bounded, attention-sorted per-project health rollup (Home widget)' })
  @ApiResponse({ status: 200, type: ProjectHealthResponseDto, isArray: true })
  @ApiCommonErrors(400, 401)
  async listProjectHealth(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
  ): Promise<ProjectHealthResponseDto[]> {
    const n = Math.min(Math.max(Number(limit) || 10, 1), 50);
    return this.projectsService.listProjectHealth(user, n);
  }

  // ── Create project ─────────────────────────────────────────────────────────

  @Post()
  @RequirePermission('project:create')
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, type: ProjectResponseDto })
  @ApiCommonErrors(400, 401, 409, 422)
  async createProject(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.createProject(user, {
      key: dto.key,
      name: dto.name,
      description: dto.description,
      leadId: dto.leadId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      teamIds: dto.teamIds,
    });
    return toProjectDto(project);
  }

  // ── Get project ────────────────────────────────────────────────────────────

  @Get(':id')
  @RequirePermission('project:view', { from: 'param', field: 'id' })
  @AuthorizedInService(
    'assertWorkspaceMember, then the project must be readable by this actor',
    'project-authz.e2e.spec.ts',
  )
  @ApiOperation({ summary: 'Get project details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProjectResponseDto })
  @ApiCommonErrors(401, 404)
  async getProject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.getProject(user.workspaceId, id);
    return toProjectDto(project);
  }

  @Get(':id/activity')
  @RequirePermission('project:view', { from: 'param', field: 'id' })
  @AuthorizedInService('assertWorkspaceMember on the owning project', 'project-authz.e2e.spec.ts')
  @ApiOperation({ summary: 'List the revision history of a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ActivityPageDto })
  @ApiCommonErrors(401, 404)
  async getActivity(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityPageDto> {
    const { page, pageSize } = query;
    const result = await this.projectsService.getProjectActivity(user, id, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { data: result.items.map(toActivityDto), total: result.total, page, pageSize };
  }

  // ── Update project ─────────────────────────────────────────────────────────

  @Patch(':id')
  @RequirePermission('project:edit', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Update project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProjectResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateProject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.updateProject(user, id, dto);
    return toProjectDto(project);
  }

  // ── Archive project ────────────────────────────────────────────────────────

  @Post(':id/archive')
  @RequirePermission('project:archive', { from: 'param', field: 'id' })
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a project (sets status to archived, becomes read-only)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProjectResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async archiveProject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.updateProject(user, id, { status: 'archived' });
    return toProjectDto(project);
  }

  // ── Restore project ────────────────────────────────────────────────────────

  @Post(':id/restore')
  @RequirePermission('project:restore', { from: 'param', field: 'id' })
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore an archived project back to active' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProjectResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async restoreProject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.updateProject(user, id, { status: 'active' });
    return toProjectDto(project);
  }

  // ── Delete project ─────────────────────────────────────────────────────────

  @Delete(':id')
  @RequirePermission('project:delete', { from: 'param', field: 'id' })
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete project (soft delete)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Project deleted' })
  @ApiCommonErrors(401, 404)
  async deleteProject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.projectsService.deleteProject(user.workspaceId, id);
  }

  // ── Workflow statuses ──────────────────────────────────────────────────────

  @Get(':id/statuses')
  @RequirePermission('project:view', { from: 'param', field: 'id' })
  @AuthorizedInService(
    'workspace reference data for a project the actor can read',
    'project-authz.e2e.spec.ts',
  )
  @ApiOperation({ summary: 'List workflow statuses for a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [WorkflowStatusResponseDto] })
  @ApiCommonErrors(401, 404)
  async listStatuses(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkflowStatusResponseDto[]> {
    const statuses = await this.projectsService.listStatuses(user.workspaceId, id);
    return statuses.map(toStatusDto);
  }

  // ── Workflow transitions ───────────────────────────────────────────────────

  @Get(':id/transitions')
  @RequirePermission('project:view', { from: 'param', field: 'id' })
  @AuthorizedInService(
    'workspace reference data for a project the actor can read',
    'project-authz.e2e.spec.ts',
  )
  @ApiOperation({ summary: 'List workflow transitions for a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [WorkflowTransitionResponseDto] })
  @ApiCommonErrors(401, 404)
  async listTransitions(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkflowTransitionResponseDto[]> {
    const transitions = await this.projectsService.listTransitions(user.workspaceId, id);
    return transitions.map(toTransitionDto);
  }
  // ── Labels ──────────────────────────────────────────────────────────────

  @Get(':id/labels')
  @RequirePermission('project:view', { from: 'param', field: 'id' })
  @AuthorizedInService(
    'workspace reference data for a project the actor can read',
    'project-authz.e2e.spec.ts',
  )
  @ApiOperation({ summary: 'List labels for a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [LabelResponseDto] })
  @ApiCommonErrors(401, 404)
  async listLabels(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LabelResponseDto[]> {
    const labelList = await this.projectsService.listLabels(user.workspaceId, id);
    return labelList.map(toLabelDto);
  }

  @Post(':id/labels')
  @RequirePermission('project:edit', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Create a label for a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: LabelResponseDto })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async createLabel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLabelDto,
  ): Promise<LabelResponseDto> {
    const label = await this.projectsService.createLabel(user.workspaceId, id, dto.name, dto.color);
    return toLabelDto(label);
  }

  @Patch(':id/labels/:labelId')
  @RequirePermission('project:edit', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Update a label' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'labelId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: LabelResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateLabel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() dto: UpdateLabelDto,
  ): Promise<LabelResponseDto> {
    const label = await this.projectsService.updateLabel(user.workspaceId, id, labelId, dto);
    return toLabelDto(label);
  }

  @Delete(':id/labels/:labelId')
  @HttpCode(204)
  @RequirePermission('project:edit', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Delete a label' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'labelId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Label deleted' })
  @ApiCommonErrors(401, 404)
  async deleteLabel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ): Promise<void> {
    await this.projectsService.deleteLabel(user.workspaceId, id, labelId);
  }

  // ── Project Teams ─────────────────────────────────────────────────────────

  @Get(':id/teams')
  @RequirePermission('project:view', { from: 'param', field: 'id' })
  @AuthorizedInService('assertWorkspaceMember on the owning project', 'project-authz.e2e.spec.ts')
  @ApiOperation({ summary: 'List teams linked to a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(401, 404)
  async listProjectTeams(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.listProjectTeams(user.workspaceId, id);
  }

  @Post(':id/teams')
  @RequirePermission('project:edit', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Link a team to a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async linkTeam(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { teamId: string },
  ) {
    return this.projectsService.linkTeam(user.workspaceId, id, dto.teamId);
  }

  @Delete(':id/teams/:teamId')
  @HttpCode(204)
  @RequirePermission('project:edit', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Unlink a team from a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Team unlinked' })
  @ApiCommonErrors(401, 404)
  async unlinkTeam(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ): Promise<void> {
    await this.projectsService.unlinkTeam(user.workspaceId, id, teamId);
  }

  // ── Project Members ───────────────────────────────────────────────────────

  @Get(':id/members')
  // The project's own roster, so `project:view` scoped to that project — expressible as a decorator
  // because the id is right there in the path. It carried nothing, and a route with no metadata is
  // OPEN, so any authenticated caller could read the membership of a project they have no access to.
  // All three tier roles hold `project:view`, so every principal who can legitimately see the project
  // can still see its roster.
  // No `resource`: the param IS the project id, so there is nothing to resolve.
  @RequirePermission('project:view', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List project members' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProjectMemberResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async listProjectMembers(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectMemberResponseDto[]> {
    const members = await this.projectsService.listProjectMembers(user.workspaceId, id);
    return members.map(toProjectMemberDto);
  }

  @Post(':id/members')
  @RequirePermission('project:manage_members', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Add a member to a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: ProjectMemberResponseDto })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async addProjectMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { userId: string; accessLevel?: 'admin' | 'editor' },
  ): Promise<ProjectMemberResponseDto> {
    const member = await this.projectsService.addProjectMember(user.workspaceId, id, dto.userId);
    return toProjectMemberDto(member);
  }

  @Patch(':id/members/:memberId')
  @RequirePermission('project:manage_members', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Update a project member access level / status' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'memberId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProjectMemberResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateProjectMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateProjectMemberDto,
  ): Promise<ProjectMemberResponseDto> {
    const member = await this.projectsService.updateProjectMember(
      user.workspaceId,
      id,
      memberId,
      dto,
    );
    return toProjectMemberDto(member);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @RequirePermission('project:manage_members', { from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Remove a member from a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiCommonErrors(401, 404)
  async removeProjectMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.projectsService.removeProjectMember(user.workspaceId, id, userId);
  }
}
