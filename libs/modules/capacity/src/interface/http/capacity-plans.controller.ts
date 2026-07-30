import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AddCapacityTeamDto,
  CapacityPlanListQueryDto,
  CreateCapacityPlanDto,
  SetCapacityDto,
  UpdateCapacityPlanDto,
} from './dto/capacity-plan-request.dto';
import { CapacityPlanResponseDto } from './dto/capacity-plan-response.dto';

/**
 * Numeric columns arrive as STRINGS from Drizzle (precision preservation) while the API
 * contract is numbers, so the conversion happens here at the boundary — the same split
 * the portfolio controller uses. `null` is preserved as `null` throughout: a capacity
 * that has not been entered is not a capacity of zero.
 */
function toDto(p: CapacityPlanView): CapacityPlanResponseDto {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    projectId: p.projectId,
    projectName: p.projectName,
    releaseId: p.releaseId,
    releaseName: p.releaseName,
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
    teams: p.teams.map((t) => ({
      id: t.id,
      teamId: t.teamId,
      teamName: t.teamName,
      capacity: t.capacity === null ? null : Number(t.capacity),
    })),
    totalCapacity: p.totalCapacity === null ? null : Number(p.totalCapacity),
  };
}

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
    return plans.map(toDto);
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
    return toDto(await this.service.createPlan(user, body));
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
    return toDto(await this.service.getPlan(user, id));
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
    return toDto(await this.service.updatePlan(user, id, body));
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
    return toDto(await this.service.addTeam(user, id, body.teamId));
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
    return toDto(await this.service.setTeamCapacity(user, id, teamId, capacity));
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
    return toDto(await this.service.removeTeam(user, id, teamId));
  }
}
