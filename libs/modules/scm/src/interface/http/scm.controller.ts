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
import { ScmInstallationService } from '../../application/scm-installation.service';
import type { ScmConnection, ScmChangeset, ScmRepositoryWithSync } from '../../domain/scm.types';
import {
  ScmConnectionResponseDto,
  ScmChangesetResponseDto,
  ScmRepositoryResponseDto,
  ScmInstallationResponseDto,
  ScmConnectResponseDto,
  ScmSyncResponseDto,
} from './dto/scm-response.dto';
import { CreateScmRepositoryDto, ConnectScmInstallationDto } from './dto/scm-request.dto';

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

function toRepositoryDto(r: ScmRepositoryWithSync): ScmRepositoryResponseDto {
  return {
    id: r.id,
    provider: r.provider,
    fullName: r.fullName,
    baseUrl: r.baseUrl,
    active: r.active,
    installationId: r.installationId,
    lastSync: r.lastSync
      ? {
          status: r.lastSync.status,
          at: r.lastSync.at ? r.lastSync.at.toISOString() : null,
          prs: r.lastSync.prs,
          commits: r.lastSync.commits,
        }
      : null,
    createdAt: r.createdAt.toISOString(),
  };
}

@ApiTags('scm')
@Controller()
export class ScmController {
  constructor(
    private readonly scm: ScmService,
    private readonly installations: ScmInstallationService,
  ) {}

  // ── Work-item Connections / Changesets ───────────────────────────────────────

  @Get('work-items/:id/connections')
  // Authn only at the guard; ScmService enforces work_item:view at the item's
  // PROJECT scope (workspace:view would wrongly block a project-only member).
  @Auth()
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
  @Auth()
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

  // ── GitHub App installations (org-level auto-discovery) ───────────────────────

  @Get('scm/installations')
  @Auth('workspace:view')
  @ApiOperation({ summary: 'GitHub App installations connected to the workspace' })
  @ApiResponse({ status: 200, type: ScmInstallationResponseDto, isArray: true })
  @ApiCommonErrors(401)
  async listInstallations(@CurrentUser() user: JwtPayload): Promise<ScmInstallationResponseDto[]> {
    const rows = await this.installations.listInstallations(user);
    return rows.map((i) => ({
      installationId: i.installationId,
      accountLogin: i.accountLogin,
      accountType: i.accountType,
    }));
  }

  @Get('scm/installations/available')
  @Auth('scm:manage')
  @ApiOperation({ summary: 'GitHub App installations the App can see (to connect)' })
  @ApiResponse({ status: 200, type: ScmInstallationResponseDto, isArray: true })
  @ApiCommonErrors(401, 403)
  async availableInstallations(
    @CurrentUser() user: JwtPayload,
  ): Promise<ScmInstallationResponseDto[]> {
    return this.installations.listAvailable(user);
  }

  @Post('scm/installations')
  @Auth('scm:manage')
  @ApiOperation({ summary: 'Connect a GitHub App installation → auto-discover its repos' })
  @ApiResponse({ status: 201, type: ScmConnectResponseDto })
  @ApiCommonErrors(400, 401, 403)
  async connectInstallation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectScmInstallationDto,
  ): Promise<ScmConnectResponseDto> {
    return this.installations.connect(user, dto.installationId);
  }

  @Delete('scm/installations/:installationId')
  @Auth('scm:manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Disconnect a GitHub App installation (deactivates its repos)' })
  @ApiParam({ name: 'installationId', type: 'string' })
  @ApiResponse({ status: 204, description: 'Disconnected' })
  @ApiCommonErrors(401, 403, 404)
  async disconnectInstallation(
    @CurrentUser() user: JwtPayload,
    @Param('installationId') installationId: string,
  ): Promise<void> {
    await this.installations.disconnect(user, installationId);
  }

  // ── Repositories (Settings ▸ Integrations) ────────────────────────────────────

  @Get('scm/repositories')
  @Auth('workspace:view')
  @ApiOperation({ summary: 'List SCM repositories (with sync status) for the workspace' })
  @ApiResponse({ status: 200, type: ScmRepositoryResponseDto, isArray: true })
  @ApiCommonErrors(401)
  async listRepositories(@CurrentUser() user: JwtPayload): Promise<ScmRepositoryResponseDto[]> {
    const repos = await this.scm.listRepositories(user);
    return repos.map(toRepositoryDto);
  }

  @Post('scm/repositories')
  @Auth('scm:manage')
  @ApiOperation({ summary: 'Manually register a repository (workspace-scoped)' })
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
    });
    return toRepositoryDto({ ...repo, installationId: null, lastSync: null });
  }

  @Post('scm/repositories/:id/sync')
  @Auth('scm:manage')
  @ApiOperation({ summary: 'Enqueue a backfill (Sync now) for a mapped repository' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: ScmSyncResponseDto })
  @ApiCommonErrors(400, 401, 403, 404)
  async syncRepository(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ScmSyncResponseDto> {
    return this.scm.syncRepository(user, id);
  }

  @Delete('scm/repositories/:id')
  @Auth('scm:manage')
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
