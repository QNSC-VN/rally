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
import { ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { AuthPolicy, RequirePermission } from '@modules/access';
import { CapacityPlansService } from '../../application/capacity-plans.service';
import type { CapacityPlanView } from '../../domain/capacity-plan.types';
import type { CapacityPlanDetail } from '../../application/capacity-plans.service';
import {
  AddCapacityTeamDto,
  AllocateDto,
  CapacityPlanListQueryDto,
  CreateCapacityPlanDto,
  ForecastCapacityDto,
  PublishPlanDto,
  SetCapacityDto,
  UpdateAllocationDto,
  UpdateCapacityPlanDto,
} from './dto/capacity-plan-request.dto';
import {
  CapacityForecastResponseDto,
  CapacityPlanResponseDto,
  PublishResultResponseDto,
  RevertResultResponseDto,
} from './dto/capacity-plan-response.dto';

/**
 * Numeric columns arrive as STRINGS from Drizzle (precision preservation) while the API
 * contract is numbers, so the conversion happens here at the boundary — the same split
 * the portfolio controller uses. `null` is preserved as `null` throughout: a capacity
 * that has not been entered is not a capacity of zero.
 */
function toDto(p: CapacityPlanDetail): CapacityPlanResponseDto {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    projectId: p.projectId,
    projectName: p.projectName,
    releaseId: p.releaseId,
    releaseName: p.releaseName,
    planKey: p.planKey,
    name: p.name,
    status: p.status,
    unit: p.unit,
    plannedStartDate: p.plannedStartDate,
    plannedEndDate: p.plannedEndDate,
    targetLoadPct: p.targetLoadPct,
    publishedAt: p.publishedAt === null ? null : p.publishedAt.toISOString(),
    publishedBy: p.publishedBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    items: p.items.map((item) => ({
      portfolioItemId: item.portfolioItemId,
      itemKey: item.itemKey,
      name: item.name,
      rank: item.rank,
      projectId: item.projectId,
      projectName: item.projectName,
      estimated: item.estimated,
      rollup: item.rollup,
      complete: item.complete,
      tier: item.tier,
      teamIds: item.teamIds,
      primaryTeamId: item.primaryTeamId,
      unallocated: item.unallocated,
    })),
    itemCutlineIndex: p.itemCutlineIndex,
    teams: p.teams.map((t) => ({
      id: t.id,
      teamId: t.teamId,
      teamName: t.teamName,
      capacity: t.capacity === null ? null : Number(t.capacity),
      metrics: t.metrics,
    })),
    totalCapacity: p.totalCapacity === null ? null : Number(p.totalCapacity),
    allocations: p.allocations.map((a) => ({
      id: a.id,
      portfolioItemId: a.portfolioItemId,
      itemKey: a.itemKey,
      name: a.name,
      teamId: a.teamId,
      isPrimary: a.isPrimary,
      // numeric arrives as a string from Drizzle; the API contract is a number. Null stays null —
      // it is the difference between "allocated nothing" and "not allocated".
      value: a.value === null ? null : Number(a.value),
      tier: a.tier,
      rank: a.rank,
      state: a.state,
      projectId: a.projectId,
      projectName: a.projectName,
      estimateBreakdown: a.estimateBreakdown,
      metrics: a.metrics,
    })),
    unallocated: p.unallocated,
  };
}

/**
 * The LIST returns plans without allocations or metrics.
 *
 * The grid there shows name/release/unit/status/target/capacity only, and assembling
 * per-row metrics for every plan in a project would mean one aggregate per allocation per
 * plan for numbers nothing displays.
 */
function toListDto(p: CapacityPlanView): CapacityPlanResponseDto {
  return toDto({
    ...p,
    teams: p.teams.map((t) => ({ ...t, metrics: EMPTY_METRICS })),
    // The list projection carries no allocations, so there are no items and no cutline.
    items: [],
    itemCutlineIndex: null,
    allocations: [],
    unallocated: 0,
  });
}

/** Zeroed metrics for the list projection, where no row displays them. */
const EMPTY_METRICS = {
  complete: 0,
  rollup: 0,
  estimated: 0,
  capacity: null,
  warnings: [] as never[],
};

@ApiTags('Capacity Planning')
@Controller('capacity-plans')
@AuthPolicy()
export class CapacityPlansController {
  constructor(private readonly service: CapacityPlansService) {}

  @Get()
  // `projectId` is REQUIRED on this list, so unlike the cross-project Portfolio list the
  // guard can resolve one project and check it directly — no in-service filtering needed.
  @RequirePermission('capacity:view', { from: 'query', field: 'projectId' })
  @ApiOperation({ summary: "List a project's capacity plans" })
  @ApiResponse({ status: 200, type: CapacityPlanResponseDto, isArray: true })
  @ApiCommonErrors(400, 401, 403)
  async listPlans(
    @CurrentUser() user: JwtPayload,
    @Query() query: CapacityPlanListQueryDto,
  ): Promise<CapacityPlanResponseDto[]> {
    const plans = await this.service.listPlans(user, query.projectId);
    return plans.map(toListDto);
  }

  @Post()
  @RequirePermission('capacity:manage', { from: 'body', field: 'projectId' })
  @ApiOperation({ summary: 'Create a capacity plan for a release' })
  @ApiResponse({ status: 201, type: CapacityPlanResponseDto })
  @ApiCommonErrors(400, 401, 403, 409, 422)
  async createPlan(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateCapacityPlanDto,
  ): Promise<CapacityPlanResponseDto> {
    const created = await this.service.createPlan(user, body);
    return toDto(await this.service.getPlanDetail(user, created.id));
  }

  @Get(':id')
  // Resolved by LOADING the row: the project is only reachable through `:id`, and a bad id
  // becomes a clean 404 rather than a misleading 403.
  @RequirePermission('capacity:view', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Get a plan with its teams and totals' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CapacityPlanResponseDto })
  @ApiCommonErrors(401, 403, 404)
  async getPlan(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CapacityPlanResponseDto> {
    return toDto(await this.service.getPlanDetail(user, id));
  }

  @Patch(':id')
  @RequirePermission('capacity:manage', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Update a draft plan' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CapacityPlanResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async updatePlan(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCapacityPlanDto,
  ): Promise<CapacityPlanResponseDto> {
    await this.service.updatePlan(user, id, body);
    return toDto(await this.service.getPlanDetail(user, id));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('capacity:manage', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Delete a plan (published plans included)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiCommonErrors(401, 403, 404, 422)
  async deletePlan(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.deletePlan(user, id);
  }

  @Post(':id/teams')
  @RequirePermission('capacity:manage', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Add a team to a plan' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: CapacityPlanResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 409, 422)
  async addTeam(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddCapacityTeamDto,
  ): Promise<CapacityPlanResponseDto> {
    await this.service.addTeam(user, id, body.teamId);
    return toDto(await this.service.getPlanDetail(user, id));
  }

  @Post(':id/publish')
  /**
   * `capacity:publish`, separate from `capacity:manage` on purpose: this writes back to
   * Feature rows outside the plan, which is a different blast radius from editing a draft.
   */
  @RequirePermission('capacity:publish', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Publish a plan, optionally writing its window onto the Features' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: PublishResultResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async publishPlan(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PublishPlanDto,
  ): Promise<PublishResultResponseDto> {
    const result = await this.service.publishPlan(user, id, { updateFields: body.updateFields });
    return { ...result, plan: toDto(result.plan) };
  }

  @Post(':id/revert')
  @RequirePermission('capacity:publish', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Revert a published plan to draft — fields already written STAY' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: RevertResultResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async revertPlan(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RevertResultResponseDto> {
    const result = await this.service.revertPlan(user, id);
    return { ...result, plan: toDto(result.plan) };
  }

  @Post(':id/teams/:teamId/forecast')
  /**
   * `capacity:view`, not `manage` — and POST despite computing nothing.
   *
   * The permission is a read one because this reads iteration history and writes nothing;
   * adopting the number is a separate act through `PATCH :id/teams/:teamId`, which is what
   * `capacity:manage` guards. Being shown a forecast is not the same as committing to it.
   *
   * POST because the inputs are a body: availability and complexity are a small model, not
   * a filter, and GET with a body is not a thing. The route is idempotent regardless — the
   * sampler is seeded from the ids, so the same request returns the same forecast.
   */
  @RequirePermission('capacity:view', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: "Forecast a team's capacity from its accepted iteration history" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CapacityForecastResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async forecastTeamCapacity(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() body: ForecastCapacityDto,
  ): Promise<CapacityForecastResponseDto> {
    return this.service.forecastTeamCapacity(user, id, teamId, {
      availabilityPct: body.availabilityPct,
      complexity: body.complexity,
    });
  }

  @Patch(':id/teams/:teamId')
  @RequirePermission('capacity:manage', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: "Set or clear a team's capacity" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CapacityPlanResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async setTeamCapacity(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() body: SetCapacityDto,
  ): Promise<CapacityPlanResponseDto> {
    // Number → numeric string at the boundary; `null` stays null ("not entered").
    const capacity = body.capacity === null ? null : String(body.capacity);
    await this.service.setTeamCapacity(user, id, teamId, capacity);
    return toDto(await this.service.getPlanDetail(user, id));
  }

  @Post(':id/allocations')
  @RequirePermission('capacity:manage', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Allocate a Feature to a team (or to the Unallocated bucket)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: CapacityPlanResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async allocate(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AllocateDto,
  ): Promise<CapacityPlanResponseDto> {
    return toDto(await this.service.allocate(user, id, body));
  }

  @Patch(':id/allocations/:allocationId')
  @RequirePermission('capacity:manage', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Change an allocation value, or move it between teams' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'allocationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CapacityPlanResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async updateAllocation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
    @Body() body: UpdateAllocationDto,
  ): Promise<CapacityPlanResponseDto> {
    return toDto(await this.service.updateAllocation(user, id, allocationId, body));
  }

  @Post(':id/allocations/:allocationId/primary')
  @RequirePermission('capacity:manage', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: "Make this allocation's team the Feature's primary assignment" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'allocationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CapacityPlanResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async setPrimaryAllocation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
  ): Promise<CapacityPlanResponseDto> {
    return toDto(await this.service.setPrimaryAllocation(user, id, allocationId));
  }

  @Delete(':id/allocations/:allocationId')
  @RequirePermission('capacity:manage', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Remove an allocation' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'allocationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CapacityPlanResponseDto })
  @ApiCommonErrors(401, 403, 404)
  async removeAllocation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allocationId', ParseUUIDPipe) allocationId: string,
  ): Promise<CapacityPlanResponseDto> {
    return toDto(await this.service.removeAllocation(user, id, allocationId));
  }

  @Delete(':id/teams/:teamId')
  @RequirePermission('capacity:manage', { resource: 'capacity_plan', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Remove a team from a plan' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CapacityPlanResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async removeTeam(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ): Promise<CapacityPlanResponseDto> {
    await this.service.removeTeam(user, id, teamId);
    return toDto(await this.service.getPlanDetail(user, id));
  }
}
