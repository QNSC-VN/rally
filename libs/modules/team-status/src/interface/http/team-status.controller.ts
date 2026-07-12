import {
  Controller,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Query,
  Body,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { RequireProjectPermission, AuthProjectScoped } from '@modules/access';
import { TeamStatusService } from '../../application/team-status.service';
import {
  TeamStatusQueryDto,
  UpdateCapacityDto,
  UpdateTeamTaskDto,
} from './dto/team-status-request.dto';
import type {
  TeamStatusResponse,
  UpdateCapacityInput,
  UpdateTaskFromTeamStatusInput,
} from '../../domain/team-status.types';

@ApiTags('team-status')
@Controller('team-status')
@AuthProjectScoped()
export class TeamStatusController {
  constructor(private readonly teamStatusService: TeamStatusService) {}

  // ── GET /team-status ──────────────────────────────────────────────────

  @Get()
  @RequireProjectPermission('team_status:view', 'query', 'projectId')
  @ApiOperation({ summary: 'Get Team Status for an iteration' })
  @ApiResponse({ status: 200, description: 'Grouped task status by member' })
  @ApiCommonErrors(400, 401, 403, 404)
  async getTeamStatus(
    @CurrentUser() user: JwtPayload,
    @Query() query: TeamStatusQueryDto,
  ): Promise<TeamStatusResponse> {
    return this.teamStatusService.getTeamStatus(
      user,
      query.projectId,
      query.teamId,
      query.iterationId,
    );
  }

  // ── PATCH /team-status/capacity ───────────────────────────────────────

  @Patch('capacity')
  @RequireProjectPermission('team_status:edit', 'body', 'projectId')
  @ApiOperation({ summary: 'Update member capacity for an iteration' })
  @ApiResponse({ status: 200, description: 'Updated capacity' })
  @ApiCommonErrors(400, 401, 403)
  async updateCapacity(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateCapacityDto,
  ) {
    const input: UpdateCapacityInput = {
      projectId: dto.projectId,
      teamId: dto.teamId,
      iterationId: dto.iterationId,
      userId: dto.userId,
      capacityHours: dto.capacityHours,
    };
    return this.teamStatusService.updateCapacity(user, input);
  }

  // ── PATCH /team-status/tasks/:taskId ──────────────────────────────────

  @Patch('tasks/:taskId')
  @ApiOperation({ summary: 'Update a task from Team Status (title/state)' })
  @ApiParam({ name: 'taskId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated task' })
  @ApiCommonErrors(400, 401, 403, 404)
  async updateTask(
    @CurrentUser() user: JwtPayload,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTeamTaskDto,
  ) {
    const input: UpdateTaskFromTeamStatusInput = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.state !== undefined && { state: dto.state }),
      ...(dto.estimateHours !== undefined && { estimateHours: dto.estimateHours }),
      ...(dto.todoHours !== undefined && { todoHours: dto.todoHours }),
      ...(dto.actualHours !== undefined && { actualHours: dto.actualHours }),
      ...(dto.assigneeId !== undefined && { assigneeId: dto.assigneeId }),
    };
    return this.teamStatusService.updateTask(user, taskId, input);
  }
}