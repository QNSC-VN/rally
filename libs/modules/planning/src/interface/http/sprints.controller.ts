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
import { PlanningService } from '../../application/planning.service';
import {
  SprintQueryDto,
  CreateSprintDto,
  UpdateSprintDto,
  CompleteSprintDto,
} from './dto/sprint-request.dto';
import { SprintResponseDto } from './dto/sprint-response.dto';
import type { Sprint } from '../../domain/sprint.types';

// ── Mapper ────────────────────────────────────────────────────────────────────

function toSprintDto(s: Sprint): SprintResponseDto {
  return {
    id: s.id,
    tenantId: s.tenantId,
    projectId: s.projectId,
    name: s.name,
    goal: s.goal,
    status: s.status,
    startDate: s.startDate,
    endDate: s.endDate,
    completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('sprints')
@Controller('sprints')
@Auth()
export class SprintsController {
  constructor(private readonly planningService: PlanningService) {}

  @Get()
  @ApiOperation({ summary: 'List sprints for a project' })
  @ApiPagedResponse(SprintResponseDto)
  @ApiCommonErrors(400, 401, 404)
  async listSprints(
    @CurrentUser() user: JwtPayload,
    @Query() query: SprintQueryDto,
  ): Promise<PagedResult<SprintResponseDto>> {
    const args = buildPageArgs(query);
    const page = await this.planningService.listSprints(user, query.projectId, args);
    return { data: page.data.map(toSprintDto), pageInfo: page.pageInfo };
  }

  @Post()
  @RequirePermission('sprint:manage')
  @ApiOperation({ summary: 'Create a sprint' })
  @ApiResponse({ status: 201, type: SprintResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async createSprint(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSprintDto,
  ): Promise<SprintResponseDto> {
    const sprint = await this.planningService.createSprint(user, dto.projectId, dto.name, {
      goal: dto.goal,
      startDate: dto.startDate ?? undefined,
      endDate: dto.endDate ?? undefined,
    });
    return toSprintDto(sprint);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get sprint details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: SprintResponseDto })
  @ApiCommonErrors(401, 404)
  async getSprint(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SprintResponseDto> {
    const sprint = await this.planningService.getSprint(user.tenantId, id);
    return toSprintDto(sprint);
  }

  @Patch(':id')
  @RequirePermission('sprint:manage')
  @ApiOperation({ summary: 'Update sprint details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: SprintResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateSprint(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSprintDto,
  ): Promise<SprintResponseDto> {
    const sprint = await this.planningService.updateSprint(user.tenantId, id, dto);
    return toSprintDto(sprint);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('sprint:manage')
  @ApiOperation({ summary: 'Delete a planned sprint' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Sprint deleted' })
  @ApiCommonErrors(400, 401, 404)
  async deleteSprint(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.planningService.deleteSprint(user.tenantId, id);
  }

  @Post(':id/start')
  @RequirePermission('sprint:manage')
  @ApiOperation({ summary: 'Start a sprint (planned → active)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: SprintResponseDto })
  @ApiCommonErrors(400, 401, 404, 409)
  async startSprint(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SprintResponseDto> {
    const sprint = await this.planningService.startSprint(user.tenantId, id);
    return toSprintDto(sprint);
  }

  @Post(':id/complete')
  @RequirePermission('sprint:manage')
  @ApiOperation({ summary: 'Complete a sprint (active → completed); moves unfinished items' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(400, 401, 404)
  async completeSprint(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteSprintDto,
  ): Promise<SprintResponseDto> {
    const sprint = await this.planningService.completeSprint(user.tenantId, id, {
      moveToSprintId: dto.moveToSprintId,
    });
    return toSprintDto(sprint);
  }
}
