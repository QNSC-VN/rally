import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Auth, ApiCommonErrors, RequirePermission } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import {
  ProjectsService,
  WorkflowStatusResponseDto,
  WorkflowTransitionResponseDto,
} from '@modules/projects';
import {
  CreateWorkflowStatusDto,
  ReorderStatusesDto,
  CreateWorkflowTransitionDto,
} from './dto/workflow-request.dto';
import type { WorkflowStatus, WorkflowTransition } from '@modules/projects';

function toStatusDto(s: WorkflowStatus): WorkflowStatusResponseDto {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    category: s.category,
    color: s.color ?? null,
    position: s.position,
    isDefault: s.isDefault,
  };
}

function toTransitionDto(t: WorkflowTransition): WorkflowTransitionResponseDto {
  return {
    id: t.id,
    projectId: t.projectId,
    fromStatusId: t.fromStatusId,
    toStatusId: t.toStatusId,
    name: t.name ?? null,
    requiredRole: t.requiredRole ?? null,
  };
}

@ApiTags('workflow')
@Controller('projects/:projectId')
@Auth()
export class WorkflowController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── Statuses ───────────────────────────────────────────────────────────────

  @Post('statuses')
  @RequirePermission('project:edit')
  @ApiOperation({ summary: 'Create a workflow status for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: WorkflowStatusResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async createStatus(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateWorkflowStatusDto,
  ): Promise<WorkflowStatusResponseDto> {
    const status = await this.projectsService.createStatus(user.tenantId, projectId, {
      name: dto.name,
      category: dto.category,
      color: dto.color,
      position: dto.position ?? 9999,
      isDefault: dto.isDefault,
    });
    return toStatusDto(status);
  }

  @Patch('statuses/reorder')
  @RequirePermission('project:edit')
  @ApiOperation({ summary: 'Reorder workflow statuses' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Statuses reordered' })
  @ApiCommonErrors(400, 401, 404, 422)
  @HttpCode(204)
  async reorderStatuses(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ReorderStatusesDto,
  ): Promise<void> {
    await this.projectsService.reorderStatuses(user.tenantId, projectId, dto.orderedIds);
  }

  @Delete('statuses/:statusId')
  @HttpCode(204)
  @RequirePermission('project:edit')
  @ApiOperation({ summary: 'Delete a workflow status' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'statusId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Status deleted' })
  @ApiCommonErrors(401, 404)
  async deleteStatus(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('statusId', ParseUUIDPipe) statusId: string,
  ): Promise<void> {
    await this.projectsService.deleteStatus(user.tenantId, projectId, statusId);
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  @Post('transitions')
  @RequirePermission('project:edit')
  @ApiOperation({ summary: 'Create a workflow transition rule' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: WorkflowTransitionResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async createTransition(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateWorkflowTransitionDto,
  ): Promise<WorkflowTransitionResponseDto> {
    const transition = await this.projectsService.createTransition(user.tenantId, projectId, {
      fromStatusId: dto.fromStatusId,
      toStatusId: dto.toStatusId,
      name: dto.name,
    });
    return toTransitionDto(transition);
  }

  @Delete('transitions/:transitionId')
  @HttpCode(204)
  @RequirePermission('project:edit')
  @ApiOperation({ summary: 'Delete a workflow transition rule' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'transitionId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Transition deleted' })
  @ApiCommonErrors(401, 404)
  async deleteTransition(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('transitionId', ParseUUIDPipe) transitionId: string,
  ): Promise<void> {
    await this.projectsService.deleteTransition(user.tenantId, projectId, transitionId);
  }
}
