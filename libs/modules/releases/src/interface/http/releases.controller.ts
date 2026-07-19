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
import { RequireProjectPermission, AuthProjectScoped } from '@modules/access';
import { ReleasesService } from '../../application/releases.service';
import { ReleaseQueryDto, CreateReleaseDto, UpdateReleaseDto } from './dto/release-request.dto';
import { ReleaseResponseDto } from './dto/release-response.dto';
import type { Release } from '../../domain/release.types';

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
      progressPercent: number;
    };
  },
): ReleaseResponseDto {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    projectId: r.projectId,
    name: r.name,
    description: r.description,
    theme: r.theme,
    notes: r.notes ?? null,
    releaseNotes: (r as Release & { releaseNotes?: string | null }).releaseNotes ?? null,
    status: r.status,
    startDate: r.startDate,
    releaseDate: r.releaseDate,
    plannedVelocity: r.plannedVelocity,
    planEstimate: r.planEstimate ? Number(r.planEstimate) : null,
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
@AuthProjectScoped()
export class ReleasesController {
  constructor(private readonly releasesService: ReleasesService) {}

  @Get()
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
  @RequireProjectPermission('release:create', 'body', 'projectId')
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

  @Patch(':id')
  @ApiOperation({ summary: 'Update release details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReleaseResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async updateRelease(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReleaseDto,
  ): Promise<ReleaseResponseDto> {
    const release = await this.releasesService.updateRelease(user, id, dto);
    return toReleaseDto(release);
  }

  @Delete(':id')
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
  @ApiOperation({ summary: 'Get release burndown data' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(400, 401, 404)
  async getReleaseBurndown(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.releasesService.getReleaseBurndown(user.workspaceId, id);
  }

  // ── Release Artifacts (P3) ──────────────────────────────────────────

  @Get(':id/artifacts')
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
