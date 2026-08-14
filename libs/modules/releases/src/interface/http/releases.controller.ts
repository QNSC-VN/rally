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
import {
  ReleaseQueryDto,
  ReleaseOptionsQueryDto,
  ReleaseArtifactQueryDto,
  CreateReleaseDto,
  UpdateReleaseDto,
} from './dto/release-request.dto';
import {
  ReleaseResponseDto,
  ReleaseOptionDto,
  ReleaseArtifactDto,
} from './dto/release-response.dto';
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
      estimateHours: number;
      toDoHours: number;
      actualHours: number;
      acceptedItems: number;
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

  // ── Reference feed (declared before `:id` so the static path is not captured as an id) ──

  /**
   * The RELEASE REFERENCE feed: what a picker needs to label, order and choose a release.
   *
   * `project:view` — the PARENT's own view permission, which all three tier roles hold. The route
   * above keeps `release:view` and stays the `Plan > Releases` administration grid's feed, which is
   * right: §3.2 marks that surface Hidden for an Editor. But it was also the only source of a
   * release's NAME for the Backlog Release column, the Work Item detail sidebar, the Backlog summary
   * panel and Quality's release filter — all Editor surfaces — and every one of them defaults a
   * failed request to `[]`, so a row assigned to a real release read as unscheduled and the picker
   * offered nothing. The gate was correct; the FEED was the defect. Identical split, and identical
   * reasoning, to `GET /projects/:id/member-options` and `GET /workspaces/:id/member-options`.
   *
   * Not `release:view` with a service-side level check, and not an undecorated resolve-then-check:
   * the project id is right there in the query, so the tier-safe decorator can express the whole
   * decision and `PolicyGuard` makes it before the handler runs.
   */
  @Get('options')
  @RequirePermission('project:view', { from: 'query', field: 'projectId' })
  @ApiOperation({ summary: "List this project's releases for a picker (id, key, name, window)" })
  @ApiResponse({ status: 200, type: ReleaseOptionDto, isArray: true })
  @ApiCommonErrors(400, 401, 403, 404)
  async listReleaseOptions(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReleaseOptionsQueryDto,
  ): Promise<ReleaseOptionDto[]> {
    return this.releasesService.listReleaseOptions(user, query.projectId);
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

  // `GET :id/burndown` is deliberately gone, with the panel it fed and the DTO fields beside it.
  //
  // FR-037 puts release progress in `Portfolio > Release Tracking`, and this route answered the same
  // question from the same `release_daily_snapshots` rows under a DIFFERENT definition — its
  // `completedPoints` was the All Teams accepted total with no scope control and no Ideal, so a reader
  // comparing it with the report got two numbers for one release. Removing the panel left it with no
  // consumer at all, which is the point at which "two sources" stops being a trade-off and is just the
  // wrong one still shipping.

  // ── Release Artifacts (P3) ──────────────────────────────────────────

  @Get(':id/artifacts')
  @RequirePermission('release:view', { resource: 'release', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List artifacts (stories/defects) in a release' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiPagedResponse(ReleaseArtifactDto)
  @ApiCommonErrors(400, 401, 404)
  async listReleaseArtifacts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReleaseArtifactQueryDto,
  ) {
    const args = buildPageArgs(query);
    return this.releasesService.listReleaseArtifacts(user, id, { ...args, q: query.q });
  }
}
