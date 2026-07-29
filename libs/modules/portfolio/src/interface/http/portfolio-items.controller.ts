import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors, ApiPagedResponse, buildPageArgs } from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { CurrentUser } from '@modules/identity';
import { AuthPolicy, RequirePermission } from '@modules/access';
import {
  PortfolioItemsService,
  type PortfolioItemWithProgress,
} from '../../application/portfolio-items.service';
import type { PortfolioChildItem } from '../../domain/ports/portfolio-item.repository';
import { PortfolioChildrenQueryDto, PortfolioListQueryDto } from './dto/portfolio-item-request.dto';
import {
  PortfolioChildResponseDto,
  PortfolioItemResponseDto,
} from './dto/portfolio-item-response.dto';

function toDto(i: PortfolioItemWithProgress): PortfolioItemResponseDto {
  return {
    id: i.id,
    workspaceId: i.workspaceId,
    projectId: i.projectId,
    itemKey: i.itemKey,
    type: i.type,
    name: i.name,
    description: i.description,
    state: i.state,
    preliminaryEstimate: i.preliminaryEstimate,
    // numeric arrives as a string from Drizzle (precision preservation); the API
    // contract is a number, so the conversion belongs here at the boundary.
    refinedEstimate: i.refinedEstimate === null ? null : Number(i.refinedEstimate),
    refinedItemCountEstimate: i.refinedItemCountEstimate,
    parentId: i.parentId,
    parentKey: i.parentKey,
    teamId: i.teamId,
    teamName: i.teamName,
    releaseId: i.releaseId,
    releaseName: i.releaseName,
    ownerId: i.ownerId,
    ownerName: i.ownerName,
    plannedStartDate: i.plannedStartDate,
    plannedEndDate: i.plannedEndDate,
    marketReleaseDate: i.marketReleaseDate,
    rank: i.rank,
    archivedAt: i.archivedAt === null ? null : i.archivedAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    childFeatureCount: i.childFeatureCount,
    rollup: i.rollup,
    progress: i.progress,
  };
}

function toChildDto(c: PortfolioChildItem): PortfolioChildResponseDto {
  return {
    id: c.id,
    itemKey: c.itemKey,
    type: c.type,
    title: c.title,
    scheduleState: c.scheduleState,
    storyPoints: c.storyPoints === null ? null : Number(c.storyPoints),
    releaseName: c.releaseName,
    projectName: c.projectName,
    teamName: c.teamName,
    ownerName: c.ownerName,
  };
}

@ApiTags('Portfolio')
@Controller('portfolio-items')
@AuthPolicy()
export class PortfolioItemsController {
  constructor(private readonly service: PortfolioItemsService) {}

  @Get()
  // Gated at `workspace:view`, then narrowed in the service — the same shape
  // work-items.controller.ts uses for its cross-project `by-key` lookup.
  //
  // `portfolio:view` is PROJECT-tier, and this route's `projectId` is optional because
  // a Workspace Admin lists across projects (BA spec §3.2) and the grid has a Project
  // column. So the guard cannot resolve one project to check against, and the tier-safe
  // decorator correctly refuses to pretend otherwise.
  //
  // The real check is `AccessService.listReadableProjectIds`, which the service applies
  // as a project filter. That mirrors Rally, where access to an artifact follows from
  // permission on its PROJECT rather than any per-artifact grant.
  @RequirePermission('workspace:view')
  @ApiOperation({ summary: 'List Epics or Features' })
  @ApiPagedResponse(PortfolioItemResponseDto)
  @ApiCommonErrors(400, 401)
  async listItems(
    @CurrentUser() user: JwtPayload,
    @Query() query: PortfolioListQueryDto,
  ): Promise<PagedResult<PortfolioItemResponseDto>> {
    const args = buildPageArgs(query);
    const page = await this.service.listItems(
      user,
      {
        type: query.type,
        projectId: query.projectId,
        teamId: query.teamId,
        search: query.search,
        includeArchived: query.includeArchived,
      },
      args,
    );
    return { data: page.data.map(toDto), pageInfo: page.pageInfo };
  }

  @Get(':id')
  // Resolved by LOADING the row: the project id is only reachable via `:id` here, and a
  // bad id becomes a clean 404 rather than a misleading 403.
  @RequirePermission('portfolio:view', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Get an Epic or Feature with its rollups' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: PortfolioItemResponseDto })
  @ApiCommonErrors(401, 404)
  async getItem(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PortfolioItemResponseDto> {
    return toDto(await this.service.getItem(user, id));
  }

  @Get(':id/children')
  @RequirePermission('portfolio:view', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List the Story/Defect linked to a Feature' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiPagedResponse(PortfolioChildResponseDto)
  @ApiCommonErrors(400, 401, 404)
  async listChildren(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PortfolioChildrenQueryDto,
  ): Promise<PagedResult<PortfolioChildResponseDto>> {
    const args = buildPageArgs(query);
    const page = await this.service.listChildren(user, id, { ...args, search: query.search });
    return { data: page.data.map(toChildDto), pageInfo: page.pageInfo };
  }

  @Get(':id/features')
  @RequirePermission('portfolio:view', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiOperation({ summary: "List an Epic's child Features" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: PortfolioItemResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async listChildFeatures(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PortfolioItemResponseDto[]> {
    const children = await this.service.listChildFeatures(user, id);
    return children.map(toDto);
  }
}
