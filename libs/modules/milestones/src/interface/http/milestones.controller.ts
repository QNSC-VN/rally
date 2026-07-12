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
import { RequireProjectPermission, AuthProjectScoped } from '@modules/access';
import { MilestonesService, type MilestoneProgress } from '../../application/milestones.service';
import { MilestoneQueryDto, CreateMilestoneDto, UpdateMilestoneDto } from './dto/milestone-request.dto';
import { MilestoneResponseDto, MilestoneListItemDto } from './dto/milestone-response.dto';
import type { Milestone } from '../../domain/milestone.types';

function toMilestoneDto(m: Milestone & { progress?: MilestoneProgress }): MilestoneResponseDto {
  return {
    id: m.id,
    tenantId: m.tenantId,
    projectId: m.projectId,
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
@AuthProjectScoped()
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Get()
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
  @RequireProjectPermission('milestone:manage', 'body', 'projectId')
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

  @Get(':id')
  @ApiOperation({ summary: 'Get milestone details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: MilestoneResponseDto })
  @ApiCommonErrors(401, 404)
  async getMilestone(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MilestoneResponseDto> {
    const milestone = await this.milestonesService.getMilestone(user.tenantId, id);
    return toMilestoneDto(milestone);
  }

  @Patch(':id')
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
  @ApiOperation({ summary: 'List milestone artifacts (US/DE work items)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Array of work item IDs' })
  @ApiCommonErrors(401, 404)
  async listMilestoneArtifacts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string[]> {
    return this.milestonesService.getMilestoneArtifacts(user, id);
  }

  @Put(':id/artifacts')
  @ApiOperation({ summary: 'Set milestone artifacts (replace all)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated artifact IDs' })
  @ApiCommonErrors(400, 401, 403, 404)
  async setMilestoneArtifacts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { ids: string[] },
  ): Promise<string[]> {
    return this.milestonesService.setMilestoneArtifacts(user, id, body.ids);
  }

  @Get(':id/projects')
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
  @ApiOperation({ summary: 'Set linked projects for a milestone (replace all)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated project IDs' })
  @ApiCommonErrors(400, 401, 403, 404)
  async setMilestoneProjects(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { ids: string[] },
  ): Promise<string[]> {
    return this.milestonesService.setMilestoneProjects(user, id, body.ids);
  }

  @Get(':id/teams')
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
  @ApiOperation({ summary: 'Set linked teams for a milestone (replace all)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated team IDs' })
  @ApiCommonErrors(400, 401, 403, 404)
  async setMilestoneTeams(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { ids: string[] },
  ): Promise<string[]> {
    return this.milestonesService.setMilestoneTeams(user, id, body.ids);
  }
}