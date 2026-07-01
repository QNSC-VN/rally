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
import {
  Auth,
  ApiCommonErrors,
  ApiPagedResponse,
  buildPageArgs,
  RequirePermission,
} from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { CurrentUser } from '@modules/identity';
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
  WorkflowStatusResponseDto,
  WorkflowTransitionResponseDto,
  LabelResponseDto,
} from './dto/project-response.dto';
import type { Project, WorkflowStatus, WorkflowTransition } from '../../domain/project.types';
import type { Label } from '../../domain/label.types';

// ── Mappers ──────────────────────────────────────────────────────────────────

function toProjectDto(
  p: Project & { memberCount?: number; teamCount?: number; leadName?: string | null },
): ProjectResponseDto {
  return {
    id: p.id,
    tenantId: p.tenantId,
    workspaceId: p.workspaceId,
    key: p.key,
    name: p.name,
    description: p.description,
    leadId: p.leadId,
    leadName: p.leadName ?? null,
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

// ── Controller ───────────────────────────────────────────────────────────────

@ApiTags('projects')
@Controller('projects')
@Auth()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── List projects ──────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List projects in a workspace' })
  @ApiPagedResponse(ProjectResponseDto)
  @ApiCommonErrors(400, 401)
  async listProjects(
    @CurrentUser() user: JwtPayload,
    @Query() query: ProjectQueryDto,
  ): Promise<PagedResult<ProjectResponseDto>> {
    const args = buildPageArgs(query);
    const page = await this.projectsService.listProjects(user, query.workspaceId, args);
    return { data: page.data.map(toProjectDto), pageInfo: page.pageInfo };
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
    const project = await this.projectsService.createProject(
      user,
      dto.workspaceId,
      dto.key,
      dto.name,
      dto.description,
      dto.leadId,
    );
    return toProjectDto(project);
  }

  // ── Get project ────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get project details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProjectResponseDto })
  @ApiCommonErrors(401, 404)
  async getProject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.getProject(user.tenantId, id);
    return toProjectDto(project);
  }

  // ── Update project ─────────────────────────────────────────────────────────

  @Patch(':id')
  @RequirePermission('project:edit')
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
  @RequirePermission('project:archive')
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
  @RequirePermission('project:restore')
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
  @RequirePermission('project:delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete project (soft delete)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Project deleted' })
  @ApiCommonErrors(401, 404)
  async deleteProject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.projectsService.deleteProject(user.tenantId, id);
  }

  // ── Workflow statuses ──────────────────────────────────────────────────────

  @Get(':id/statuses')
  @ApiOperation({ summary: 'List workflow statuses for a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [WorkflowStatusResponseDto] })
  @ApiCommonErrors(401, 404)
  async listStatuses(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkflowStatusResponseDto[]> {
    const statuses = await this.projectsService.listStatuses(user.tenantId, id);
    return statuses.map(toStatusDto);
  }

  // ── Workflow transitions ───────────────────────────────────────────────────

  @Get(':id/transitions')
  @ApiOperation({ summary: 'List workflow transitions for a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [WorkflowTransitionResponseDto] })
  @ApiCommonErrors(401, 404)
  async listTransitions(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkflowTransitionResponseDto[]> {
    const transitions = await this.projectsService.listTransitions(user.tenantId, id);
    return transitions.map(toTransitionDto);
  }
  // ── Labels ──────────────────────────────────────────────────────────────

  @Get(':id/labels')
  @ApiOperation({ summary: 'List labels for a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [LabelResponseDto] })
  @ApiCommonErrors(401, 404)
  async listLabels(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LabelResponseDto[]> {
    const labelList = await this.projectsService.listLabels(user.tenantId, id);
    return labelList.map(toLabelDto);
  }

  @Post(':id/labels')
  @RequirePermission('project:edit')
  @ApiOperation({ summary: 'Create a label for a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: LabelResponseDto })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async createLabel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLabelDto,
  ): Promise<LabelResponseDto> {
    const label = await this.projectsService.createLabel(user.tenantId, id, dto.name, dto.color);
    return toLabelDto(label);
  }

  @Patch(':id/labels/:labelId')
  @RequirePermission('project:edit')
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
    const label = await this.projectsService.updateLabel(user.tenantId, id, labelId, dto);
    return toLabelDto(label);
  }

  @Delete(':id/labels/:labelId')
  @HttpCode(204)
  @RequirePermission('project:edit')
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
    await this.projectsService.deleteLabel(user.tenantId, id, labelId);
  }

  // ── Project Teams ─────────────────────────────────────────────────────────

  @Get(':id/teams')
  @ApiOperation({ summary: 'List teams linked to a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(401, 404)
  async listProjectTeams(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.listProjectTeams(user.tenantId, id);
  }

  @Post(':id/teams')
  @RequirePermission('project:edit')
  @ApiOperation({ summary: 'Link a team to a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async linkTeam(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { teamId: string },
  ) {
    return this.projectsService.linkTeam(user.tenantId, id, dto.teamId);
  }

  @Delete(':id/teams/:teamId')
  @HttpCode(204)
  @RequirePermission('project:edit')
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
    await this.projectsService.unlinkTeam(user.tenantId, id, teamId);
  }

  // ── Project Members ───────────────────────────────────────────────────────

  @Get(':id/members')
  @ApiOperation({ summary: 'List project members' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(401, 404)
  async listProjectMembers(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projectsService.listProjectMembers(user.tenantId, id);
  }

  @Post(':id/members')
  @RequirePermission('project:manage_members')
  @ApiOperation({ summary: 'Add a member to a project' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async addProjectMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { userId: string; roleId?: string },
  ) {
    return this.projectsService.addProjectMember(user.tenantId, id, dto.userId, dto.roleId);
  }

  @Patch(':id/members/:memberId')
  @RequirePermission('project:manage_members')
  @ApiOperation({ summary: 'Update a project member role/status' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'memberId', type: 'string', format: 'uuid' })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateProjectMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    return this.projectsService.updateProjectMember(user.tenantId, id, memberId, dto);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @RequirePermission('project:manage_members')
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
    await this.projectsService.removeProjectMember(user.tenantId, id, userId);
  }
}
