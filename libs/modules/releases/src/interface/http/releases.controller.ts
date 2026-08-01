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
import { RequirePermission, AuthPolicy } from '@modules/access';
import { ReleasesService } from '../../application/releases.service';
import { ReleaseQueryDto, CreateReleaseDto, UpdateReleaseDto } from './dto/release-request.dto';
import { ReleaseResponseDto } from './dto/release-response.dto';
import type { Release } from '../../domain/release.types';
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

function toReleaseDto(
  r: Release & {
    taskEstimate?: number;
    taskRollup?: {
      totalItems: number;
      completedItems: number;
      acceptedItems: number;
      toDoItems: number;
      totalPoints: number;
      completedPoints: number;
      toDoPoints: number;
      /** Null when not computable — nothing linked, or nothing estimated. */
      progressPercent: number | null;
    };
  },
): ReleaseResponseDto {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    projectId: r.projectId,
    releaseKey: r.releaseKey,
    name: r.name,
    description: r.description,
    theme: r.theme,
    notes: r.notes ?? null,
    releaseNotes: (r as Release & { releaseNotes?: string | null }).releaseNotes ?? null,
    status: r.status,
    startDate: r.startDate,
    releaseDate: r.releaseDate,
    plannedVelocity: r.plannedVelocity,
    // `=== null`, not truthiness: a stored 0 is a real plan estimate. Drizzle hands back
    // `"0.00"` for numeric columns so the truthy form happened to work, but it depended on
    // the value arriving as a string while the declared type says number.
    planEstimate: r.planEstimate === null ? null : Number(r.planEstimate),
    taskEstimate: r.taskEstimate ?? 0,
    version: r.version ?? null,
    releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    taskRollup: r.taskRollup,
  };
}

@ApiTags('releases')
@Controller('releases')
@AuthPolicy()
export class ReleasesController {
  constructor(private readonly releasesService: ReleasesService) {}

  @Get()
  @RequirePermission('release:view', { from: 'query', field: 'projectId' })
  @ApiOperation({ summary: 'List releases for a project' })
  @ApiPagedResponse(ReleaseResponseDto)
  @ApiCommonErrors(400, 401, 404)
  async listReleases(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReleaseQueryDto,
  ): Promise<PagedResult<ReleaseResponseDto>> {
    const args = buildPageArgs(query);
    const page = await this.releasesService.listReleases(user, query.projectId, args);
    return { data: page.data.map(toReleaseDto), pageInfo: page.pageInfo };
  }

  @Post()
  @RequirePermission('release:create', { from: 'body', field: 'projectId' })
  @ApiOperation({ summary: 'Create a release' })
  @ApiResponse({ status: 201, type: ReleaseResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async createRelease(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReleaseDto,
  ): Promise<ReleaseResponseDto> {
    const release = await this.releasesService.createRelease(user, dto.projectId, dto.name, {
      description: dto.description,
      theme: dto.theme,
      startDate: dto.startDate ?? undefined,
      releaseDate: dto.releaseDate ?? undefined,
      state: dto.state,
      releaseNotes: dto.releaseNotes ?? undefined,
    });
    return toReleaseDto(release);
  }

  @Get(':id')
  @RequirePermission('release:view', { resource: 'release', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Get release details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReleaseResponseDto })
  @ApiCommonErrors(401, 404)
  async getRelease(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReleaseResponseDto> {
    const release = await this.releasesService.getReleaseDetail(user, id);
    return toReleaseDto(release);
  }

  @Get(':id/activity')
  @RequirePermission('release:view', { resource: 'release', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List the revision history of a release' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ActivityPageDto })
  @ApiCommonErrors(401, 404)
  async getActivity(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityPageDto> {
    const { page, pageSize } = query;
    const result = await this.releasesService.getReleaseActivity(user, id, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { data: result.items.map(toActivityDto), total: result.total, page, pageSize };
  }

  @Patch(':id')
  @RequirePermission('release:edit', { resource: 'release', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Update release details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReleaseResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async updateRelease(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReleaseDto,
  ): Promise<ReleaseResponseDto> {
    // The API field is `state` (matching create + the client), but the domain
    // model uses `status`. Map it here so state changes actually persist
    // (previously `dto.state` was dropped because the service reads `status`).
    const { state, ...rest } = dto;
    const release = await this.releasesService.updateRelease(user, id, {
      ...rest,
      ...(state !== undefined ? { status: state } : {}),
    });
    return toReleaseDto(release);
  }

  @Delete(':id')
  @RequirePermission('release:delete', { resource: 'release', from: 'param', field: 'id' })
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a planned release' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Release deleted' })
  @ApiCommonErrors(400, 401, 403, 404)
  async deleteRelease(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.releasesService.deleteRelease(user, id);
  }

  @Get(':id/burndown')
  @RequirePermission('release:view', { resource: 'release', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Get release burndown data' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(400, 401, 404)
  async getReleaseBurndown(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.releasesService.getReleaseBurndown(user, id);
  }

  // ── Release Artifacts (P3) ──────────────────────────────────────────

  @Get(':id/artifacts')
  @RequirePermission('release:view', { resource: 'release', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List artifacts (stories/defects) in a release' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiPagedResponse(ReleaseResponseDto)
  @ApiCommonErrors(400, 401, 404)
  async listReleaseArtifacts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReleaseQueryDto,
  ) {
    const args = buildPageArgs(query);
    return this.releasesService.listReleaseArtifacts(user, id, args);
  }
}
