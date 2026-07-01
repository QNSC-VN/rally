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
import { ReleasesService } from '../../application/releases.service';
import { ReleaseQueryDto, CreateReleaseDto, UpdateReleaseDto } from './dto/release-request.dto';
import { ReleaseResponseDto } from './dto/release-response.dto';
import type { Release } from '../../domain/release.types';

function toReleaseDto(r: Release): ReleaseResponseDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    projectId: r.projectId,
    name: r.name,
    description: r.description,
    status: r.status,
    targetDate: r.targetDate,
    releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

@ApiTags('releases')
@Controller('releases')
@Auth()
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
  @RequirePermission('release:manage')
  @ApiOperation({ summary: 'Create a release' })
  @ApiResponse({ status: 201, type: ReleaseResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async createRelease(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReleaseDto,
  ): Promise<ReleaseResponseDto> {
    const release = await this.releasesService.createRelease(user, dto.projectId, dto.name, {
      description: dto.description,
      targetDate: dto.targetDate ?? undefined,
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
    const release = await this.releasesService.getRelease(user.tenantId, id);
    return toReleaseDto(release);
  }

  @Patch(':id')
  @RequirePermission('release:manage')
  @ApiOperation({ summary: 'Update release details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReleaseResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateRelease(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReleaseDto,
  ): Promise<ReleaseResponseDto> {
    const release = await this.releasesService.updateRelease(user.tenantId, id, dto);
    return toReleaseDto(release);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('release:manage')
  @ApiOperation({ summary: 'Delete a planned release' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Release deleted' })
  @ApiCommonErrors(400, 401, 404)
  async deleteRelease(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.releasesService.deleteRelease(user.tenantId, id);
  }

  @Post(':id/ship')
  @RequirePermission('release:manage')
  @ApiOperation({ summary: 'Mark a release as shipped' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: ReleaseResponseDto })
  @ApiCommonErrors(400, 401, 404)
  async shipRelease(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReleaseResponseDto> {
    const release = await this.releasesService.shipRelease(user.tenantId, id);
    return toReleaseDto(release);
  }
}
