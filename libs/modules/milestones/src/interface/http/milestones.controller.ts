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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors, ApiPagedResponse, buildPageArgs } from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { CurrentUser } from '@modules/identity';
import { RequirePermission, AuthPolicy } from '@modules/access';
import { MilestonesService, type MilestoneProgress } from '../../application/milestones.service';
import {
  MilestoneQueryDto,
  MilestoneOptionsQueryDto,
  MilestoneArtifactQueryDto,
  CreateMilestoneDto,
  UpdateMilestoneDto,
  SetMilestoneProjectsDto,
  SetMilestoneTeamsDto,
  SetMilestoneArtifactsDto,
  SetMilestoneReleasesDto,
} from './dto/milestone-request.dto';
import {
  MilestoneResponseDto,
  MilestoneListItemDto,
  MilestoneOptionDto,
  MilestoneArtifactDto,
} from './dto/milestone-response.dto';
import type { Milestone } from '../../domain/milestone.types';
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

function toMilestoneDto(m: Milestone & { progress?: MilestoneProgress }): MilestoneResponseDto {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    projectId: m.projectId,
    milestoneKey: m.milestoneKey,
    name: m.name,
    description: m.description,
    notes: m.notes,
    status: m.status,
    ownerId: m.ownerId,
    targetStartDate: m.targetStartDate,
    targetEndDate: m.targetEndDate,
    releaseIds: m.releaseIds,
    projectIds: m.projectIds ?? [],
    teamIds: m.teamIds ?? [],
    progress: m.progress,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

@ApiTags('milestones')
@Controller('milestones')
@AuthPolicy()
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Get()
  @RequirePermission('milestone:view', { from: 'query', field: 'projectId' })
  @ApiOperation({ summary: 'List milestones for a project' })
  @ApiPagedResponse(MilestoneListItemDto)
  @ApiCommonErrors(400, 401, 404)
  async listMilestones(
    @CurrentUser() user: JwtPayload,
    @Query() query: MilestoneQueryDto,
  ): Promise<PagedResult<MilestoneListItemDto>> {
    const args = buildPageArgs(query);
    const page = await this.milestonesService.listMilestones(user, query.projectId, args);
    return { data: page.data.map(toMilestoneDto), pageInfo: page.pageInfo };
  }

  @Post()
  @RequirePermission('milestone:create', { from: 'body', field: 'projectId' })
  @ApiOperation({ summary: 'Create a milestone' })
  @ApiResponse({ status: 201, type: MilestoneResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async createMilestone(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMilestoneDto,
  ): Promise<MilestoneResponseDto> {
    const milestone = await this.milestonesService.createMilestone(user, dto.projectId, dto.name, {
      description: dto.description,
      notes: dto.notes,
      status: dto.status,
      ownerId: dto.ownerId,
      targetStartDate: dto.targetStartDate,
      targetEndDate: dto.targetEndDate,
      releaseIds: dto.releaseIds,
      projectIds: dto.projectIds,
      teamIds: dto.teamIds,
    });
    return toMilestoneDto(milestone);
  }

  // ── Reference feed (declared before `:id` so the static path is not captured as an id) ──

  /**
   * The MILESTONE REFERENCE feed: what a picker needs to label, choose and scope a milestone.
   *
   * `project:view` — the PARENT's own view permission, which all three tier roles hold. The list
   * route above keeps `milestone:view` and stays the `Plan > Milestones` administration grid's feed,
   * which is right: §3.2 marks that surface Hidden for an Editor. But it was also the only feed for
   * the Milestones column and picker on Iteration Status and on the Work Item detail sidebar — both
   * Editor surfaces, and both defaulting a failed request to `[]`, so an item's real milestones
   * rendered as none and none could be added while `PUT /work-items/:id/milestones` (`work_item:edit`)
   * would have accepted the write. The gate was correct; the FEED was the defect. Identical split, and
   * identical reasoning, to `GET /releases/options` and the two `member-options` feeds.
   */
  @Get('options')
  @RequirePermission('project:view', { from: 'query', field: 'projectId' })
  @ApiOperation({
    summary: "List this project's milestones for a picker (id, key, name, releases)",
  })
  @ApiResponse({ status: 200, type: MilestoneOptionDto, isArray: true })
  @ApiCommonErrors(400, 401, 403, 404)
  async listMilestoneOptions(
    @CurrentUser() user: JwtPayload,
    @Query() query: MilestoneOptionsQueryDto,
  ): Promise<MilestoneOptionDto[]> {
    return this.milestonesService.listMilestoneOptions(user, query.projectId);
  }

  @Get(':id')
  @RequirePermission('milestone:view', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Get milestone details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: MilestoneResponseDto })
  @ApiCommonErrors(401, 404)
  async getMilestone(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MilestoneResponseDto> {
    const milestone = await this.milestonesService.getMilestoneForView(user, id);
    return toMilestoneDto(milestone);
  }

  @Get(':id/activity')
  @RequirePermission('milestone:view', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List the revision history of a milestone' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ActivityPageDto })
  @ApiCommonErrors(401, 404)
  async getActivity(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityPageDto> {
    const { page, pageSize } = query;
    const result = await this.milestonesService.getMilestoneActivity(user, id, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { data: result.items.map(toActivityDto), total: result.total, page, pageSize };
  }

  @Patch(':id')
  @RequirePermission('milestone:edit', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Update milestone details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: MilestoneResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async updateMilestone(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMilestoneDto,
  ): Promise<MilestoneResponseDto> {
    const milestone = await this.milestonesService.updateMilestone(user, id, dto);
    return toMilestoneDto(milestone);
  }

  @Delete(':id')
  @RequirePermission('milestone:delete', { resource: 'milestone', from: 'param', field: 'id' })
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a milestone' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Milestone deleted' })
  @ApiCommonErrors(400, 401, 403, 404)
  async deleteMilestone(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.milestonesService.deleteMilestone(user, id);
  }

  // ── P3.3 — Artifact/Project/Team junction endpoints ───────────────

  @Get(':id/artifacts')
  @RequirePermission('milestone:view', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List milestone artifact LINKS (work item IDs)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Array of work item IDs' })
  @ApiCommonErrors(401, 404)
  async listMilestoneArtifactIds(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string[]> {
    return this.milestonesService.getMilestoneArtifacts(user, id);
  }

  /**
   * The Artifacts DASHBOARD (P3-MS-FR-019/020) — Backlog-shaped rows, paged and searchable.
   *
   * A separate resource from the link list above on purpose: `PUT :id/artifacts` takes ids back, so
   * that pair speaks ids, and this one speaks rows. Serving both shapes from one path is what left
   * the tab reading `{ data, pageInfo }` off a bare array and rendering "No artifacts linked to this
   * milestone" for every milestone in every environment.
   */
  @Get(':id/artifacts/items')
  @RequirePermission('milestone:view', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List milestone artifacts (US/DE work items) as dashboard rows' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiPagedResponse(MilestoneArtifactDto)
  @ApiCommonErrors(400, 401, 404)
  async listMilestoneArtifacts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MilestoneArtifactQueryDto,
  ) {
    const args = buildPageArgs(query);
    return this.milestonesService.listMilestoneArtifacts(user, id, { ...args, q: query.q });
  }

  @Put(':id/artifacts')
  @RequirePermission('milestone:edit', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Set milestone artifacts (replace all)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated artifact IDs' })
  @ApiCommonErrors(400, 401, 403, 404)
  async setMilestoneArtifacts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMilestoneArtifactsDto,
  ): Promise<string[]> {
    return this.milestonesService.setMilestoneArtifacts(user, id, dto.workItemIds);
  }

  @Get(':id/projects')
  @RequirePermission('milestone:view', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List linked projects for a milestone' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Array of project IDs' })
  @ApiCommonErrors(401, 404)
  async listMilestoneProjects(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string[]> {
    return this.milestonesService.getMilestoneProjects(user, id);
  }

  @Put(':id/projects')
  @RequirePermission('milestone:edit', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Set linked projects for a milestone (replace all)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated project IDs' })
  @ApiCommonErrors(400, 401, 403, 404)
  async setMilestoneProjects(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMilestoneProjectsDto,
  ): Promise<string[]> {
    return this.milestonesService.setMilestoneProjects(user, id, dto.projectIds);
  }

  @Get(':id/teams')
  @RequirePermission('milestone:view', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List linked teams for a milestone' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Array of team IDs' })
  @ApiCommonErrors(401, 404)
  async listMilestoneTeams(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string[]> {
    return this.milestonesService.getMilestoneTeams(user, id);
  }

  @Put(':id/teams')
  @RequirePermission('milestone:edit', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Set linked teams for a milestone (replace all)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated team IDs' })
  @ApiCommonErrors(400, 401, 403, 404)
  async setMilestoneTeams(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMilestoneTeamsDto,
  ): Promise<string[]> {
    return this.milestonesService.setMilestoneTeams(user, id, dto.teamIds);
  }

  @Get(':id/releases')
  @RequirePermission('milestone:view', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List linked releases for a milestone' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Array of release IDs' })
  @ApiCommonErrors(401, 404)
  async listMilestoneReleases(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string[]> {
    return this.milestonesService.getMilestoneReleases(user, id);
  }

  @Put(':id/releases')
  @RequirePermission('milestone:edit', { resource: 'milestone', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Set linked releases for a milestone (replace all)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated release IDs' })
  @ApiCommonErrors(400, 401, 403, 404)
  async setMilestoneReleases(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMilestoneReleasesDto,
  ): Promise<string[]> {
    return this.milestonesService.setMilestoneReleases(user, id, dto.releaseIds);
  }
}
