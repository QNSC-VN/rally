import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Auth, ApiCommonErrors, ApiPagedResponse, buildPageArgs, PageQueryDto } from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { CurrentUser } from '@modules/identity';
import { ScmService } from '../../application/scm.service';
import type { ScmConnection, ScmChangeset, ScmRepository } from '../../domain/scm.types';
import {
  ScmConnectionResponseDto,
  ScmChangesetResponseDto,
  ScmRepositoryResponseDto,
} from './dto/scm-response.dto';
import { CreateScmRepositoryDto } from './dto/scm-request.dto';

function toConnectionDto(c: ScmConnection): ScmConnectionResponseDto {
  return {
    id: c.id,
    workItemId: c.workItemId,
    provider: c.provider,
    type: c.type,
    name: c.name,
    url: c.url,
    state: c.state,
    authorName: c.authorName,
    createdAt: (c.sourceCreatedAt ?? c.createdAt).toISOString(),
  };
}

function toChangesetDto(c: ScmChangeset): ScmChangesetResponseDto {
  return {
    id: c.id,
    workItemId: c.workItemId,
    provider: c.provider,
    revision: c.revision,
    name: c.name,
    message: c.message,
    uri: c.uri,
    authorName: c.authorName,
    changes: c.changes,
    committedAt: c.committedAt ? c.committedAt.toISOString() : null,
  };
}

function toRepositoryDto(r: ScmRepository): ScmRepositoryResponseDto {
  return {
    id: r.id,
    provider: r.provider,
    fullName: r.fullName,
    baseUrl: r.baseUrl,
    active: r.active,
    projectIds: r.projectIds,
    createdAt: r.createdAt.toISOString(),
  };
}

@ApiTags('scm')
@Controller()
export class ScmController {
  constructor(private readonly scm: ScmService) {}

  // ── Work-item Connections / Changesets ───────────────────────────────────────

  @Get('work-items/:id/connections')
  @Auth('workspace:view')
  @ApiOperation({ summary: 'List SCM connections (pull requests) for a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiPagedResponse(ScmConnectionResponseDto)
  @ApiCommonErrors(400, 401, 404)
  async listConnections(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ): Promise<PagedResult<ScmConnectionResponseDto>> {
    const page = await this.scm.listConnections(user, id, buildPageArgs(query));
    return { data: page.data.map(toConnectionDto), pageInfo: page.pageInfo };
  }

  @Get('work-items/:id/changesets')
  @Auth('workspace:view')
  @ApiOperation({ summary: 'List SCM changesets (commits) for a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiPagedResponse(ScmChangesetResponseDto)
  @ApiCommonErrors(400, 401, 404)
  async listChangesets(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ): Promise<PagedResult<ScmChangesetResponseDto>> {
    const page = await this.scm.listChangesets(user, id, buildPageArgs(query));
    return { data: page.data.map(toChangesetDto), pageInfo: page.pageInfo };
  }

  // ── Repository ↔ project mapping (Settings ▸ Integrations) ────────────────────

  @Get('scm/repositories')
  @Auth('workspace:view')
  @ApiOperation({ summary: 'List SCM repository → project mappings for the workspace' })
  @ApiResponse({ status: 200, type: ScmRepositoryResponseDto, isArray: true })
  @ApiCommonErrors(401)
  async listRepositories(@CurrentUser() user: JwtPayload): Promise<ScmRepositoryResponseDto[]> {
    const repos = await this.scm.listRepositories(user);
    return repos.map(toRepositoryDto);
  }

  @Post('scm/repositories')
  @Auth('workspace:manage_members')
  @ApiOperation({ summary: 'Create/update a repository → project mapping' })
  @ApiResponse({ status: 201, type: ScmRepositoryResponseDto })
  @ApiCommonErrors(400, 401, 403)
  async createRepository(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateScmRepositoryDto,
  ): Promise<ScmRepositoryResponseDto> {
    const repo = await this.scm.createRepository(user, {
      provider: dto.provider,
      fullName: dto.fullName,
      baseUrl: dto.baseUrl,
      projectIds: dto.projectIds,
    });
    return toRepositoryDto(repo);
  }

  @Delete('scm/repositories/:id')
  @Auth('workspace:manage_members')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a repository mapping' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Mapping removed' })
  @ApiCommonErrors(401, 403, 404)
  async deleteRepository(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.scm.deleteRepository(user, id);
  }
}
