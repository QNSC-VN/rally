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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPagedResponse,
  buildPageArgs,
  parseSort,
  UseIdempotency,
  RateLimit,
} from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { AuthProjectScoped, RequireProjectPermission } from '@modules/access';
import { CurrentUser } from '@modules/identity';
import { WorkItemsService } from '../../application/work-items.service';
import {
  WorkItemQueryDto,
  WorkItemByKeyQueryDto,
  CreateWorkItemDto,
  UpdateWorkItemDto,
  CreateTaskDto,
  ActivityQueryDto,
  MoveWorkItemDto,
  ReorderWorkItemsDto,
  RankWorkItemDto,
  BulkAssignReleaseDto,
  BulkAssignIterationDto,
  AddLabelDto,
  SetWorkItemMilestonesDto,
  CreateTimeLogDto,
  UpdateTimeLogDto,
  TimeLogQueryDto,
  PresignAttachmentDto,
  CreateRelationDto,
} from './dto/work-item-request.dto';
import {
  WorkItemResponseDto,
  TaskTotalsResponseDto,
  ActivityResponseDto,
  TimeLogResponseDto,
  WatcherResponseDto,
  AttachmentResponseDto,
  PresignAttachmentResponseDto,
  DownloadUrlResponseDto,
} from './dto/work-item-response.dto';
import type { WorkItem } from '../../domain/work-item.types';
import { BACKLOG_SORT_FIELDS } from '../../domain/work-item.types';
import type { ActivityLog } from '../../domain/activity-log.types';
import type { TimeLog } from '../../domain/time-log.types';
import type { Watcher } from '../../domain/watcher.types';
import type { Attachment } from '../../domain/attachment.types';

// ── Mappers ─────────────────────────────────────────────────────────────────

function numOrNull(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function toWorkItemDto(w: WorkItem): WorkItemResponseDto {
  return {
    id: w.id,
    workspaceId: w.workspaceId,
    projectId: w.projectId,
    itemKey: w.itemKey,
    type: w.type,
    title: w.title,
    description: w.description,
    statusId: w.statusId,
    scheduleState: w.scheduleState,
    flowState: w.flowState,
    priority: w.priority,
    assigneeId: w.assigneeId,
    reporterId: w.reporterId,
    parentId: w.parentId,
    teamId: w.teamId,
    iterationId: w.iterationId,
    releaseId: w.releaseId,
    storyPoints: numOrNull(w.storyPoints),
    estimateHours: numOrNull(w.estimateHours),
    todoHours: numOrNull(w.todoHours),
    actualHours: numOrNull(w.actualHours),
    acceptanceCriteria: w.acceptanceCriteria,
    notes: w.notes,
    releaseNotes: w.releaseNotes,
    isBlocked: w.isBlocked,
    blockedReason: w.blockedReason,
    rank: w.rank,
    customFields: w.customFields,
    createdBy: w.createdBy,
    updatedBy: w.updatedBy,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    // P3.4 — Defect-specific fields
    severity: w.severity,
    foundInEnvironment: w.foundInEnvironment,
    foundInReleaseId: w.foundInReleaseId,
    rootCause: w.rootCause,
    resolution: w.resolution,
    devOwnerId: w.devOwnerId,
    defectState: w.defectState,
    fixedInBuild: w.fixedInBuild,
  };
}

function toActivityDto(a: ActivityLog): ActivityResponseDto {
  return {
    id: a.id,
    createdAt: a.createdAt.toISOString(),
    actorId: a.actorId,
    actorName: a.actorName,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    changes: a.changes,
    metadata: a.metadata,
  };
}

function toTimeLogDto(l: TimeLog): TimeLogResponseDto {
  return {
    id: l.id,
    workItemId: l.workItemId,
    userId: l.userId,
    loggedDate: l.loggedDate,
    hours: Number(l.hours),
    description: l.description,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

function toWatcherDto(w: Watcher): WatcherResponseDto {
  return {
    userId: w.userId,
    watchedAt: w.watchedAt.toISOString(),
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

function toAttachmentDto(a: Attachment): AttachmentResponseDto {
  return {
    id: a.id,
    workItemId: a.workItemId,
    uploadedBy: a.uploadedBy,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: Number(a.sizeBytes),
    status: a.status,
    createdAt: a.createdAt.toISOString(),
  };
}

@ApiTags('work-items')
@Controller('work-items')
@AuthProjectScoped()
export class WorkItemsController {
  constructor(private readonly workItemsService: WorkItemsService) {}

  // ── List ───────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List work items in a project' })
  @RequireProjectPermission('work_item:view', 'query', 'projectId')
  @ApiPagedResponse(WorkItemResponseDto)
  @ApiCommonErrors(400, 401, 404)
  async listWorkItems(
    @CurrentUser() user: JwtPayload,
    @Query() query: WorkItemQueryDto,
  ): Promise<PagedResult<WorkItemResponseDto>> {
    const args = buildPageArgs(query);
    const page = await this.workItemsService.listWorkItems(
      user,
      query.projectId,
      {
        type: query.type,
        parentId: query.parentId,
        statusId: query.statusId,
        scheduleState: query.scheduleState,
        priority: query.priority,
        assigneeId: query.assigneeId,
        teamId: query.teamId,
        iterationId: query.iterationId,
        releaseId: query.releaseId,
        q: query.q,
      },
      args,
    );
    return { data: page.data.map(toWorkItemDto), pageInfo: page.pageInfo };
  }

  // ── Backlog (story + defect only) ────────────────────────────────────────────

  @Get('backlog')
  @ApiOperation({ summary: 'List backlog items (stories and defects) in a project' })
  @RequireProjectPermission('work_item:view', 'query', 'projectId')
  @ApiPagedResponse(WorkItemResponseDto)
  @ApiCommonErrors(400, 401, 404)
  async listBacklog(
    @CurrentUser() user: JwtPayload,
    @Query() query: WorkItemQueryDto,
  ): Promise<PagedResult<WorkItemResponseDto>> {
    const args = buildPageArgs(query);
    const sort = parseSort(query.sort, BACKLOG_SORT_FIELDS);
    const page = await this.workItemsService.listBacklog(
      user,
      query.projectId,
      {
        type: query.type,
        parentId: query.parentId,
        statusId: query.statusId,
        scheduleState: query.scheduleState,
        priority: query.priority,
        assigneeId: query.assigneeId,
        teamId: query.teamId,
        iterationId: query.iterationId,
        releaseId: query.releaseId,
        q: query.q,
        sortBy: sort?.sortBy,
        sortDirection: sort?.sortDirection,
      },
      args,
    );
    return { data: page.data.map(toWorkItemDto), pageInfo: page.pageInfo };
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a work item' })
  @ApiResponse({ status: 201, type: WorkItemResponseDto })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async createWorkItem(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWorkItemDto,
  ): Promise<WorkItemResponseDto> {
    const item = await this.workItemsService.createWorkItem(
      user,
      dto.projectId,
      dto.type,
      dto.title,
      {
        description: dto.description,
        statusId: dto.statusId,
        scheduleState: dto.scheduleState,
        priority: dto.priority,
        assigneeId: dto.assigneeId,
        reporterId: dto.reporterId,
        parentId: dto.parentId,
        teamId: dto.teamId,
        storyPoints: dto.storyPoints,
        estimateHours: dto.estimateHours,
        todoHours: dto.todoHours,
        actualHours: dto.actualHours,
        acceptanceCriteria: dto.acceptanceCriteria,
        notes: dto.notes,
        releaseNotes: dto.releaseNotes,
        // P3.4 — Defect-specific fields
        severity: dto.severity,
        foundInEnvironment: dto.foundInEnvironment,
        foundInReleaseId: dto.foundInReleaseId,
        rootCause: dto.rootCause,
        resolution: dto.resolution,
        devOwnerId: dto.devOwnerId,
        defectState: dto.defectState,
        fixedInBuild: dto.fixedInBuild,
      },
    );
    return toWorkItemDto(item);
  }

  // ── Get ────────────────────────────────────────────────────────────────────

  // Declared before @Get(':id') so the static path is not captured as an :id
  // (which is ParseUUIDPipe-validated and would 400 on the literal "by-key").
  @Get('by-key')
  @ApiOperation({ summary: 'Get a work item by its item key within a project' })
  @RequireProjectPermission('work_item:view', 'query', 'projectId')
  @ApiResponse({ status: 200, type: WorkItemResponseDto })
  @ApiCommonErrors(400, 401, 404)
  async getWorkItemByKey(
    @CurrentUser() user: JwtPayload,
    @Query() query: WorkItemByKeyQueryDto,
  ): Promise<WorkItemResponseDto> {
    const item = await this.workItemsService.getWorkItemByKey(user, query.projectId, query.itemKey);
    return toWorkItemDto(item);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a work item by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkItemResponseDto })
  @ApiCommonErrors(401, 404)
  async getWorkItem(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkItemResponseDto> {
    const item = await this.workItemsService.getWorkItemForView(user, id);
    return toWorkItemDto(item);
  }

  // ── Bulk assign release / iteration (P2-BL-03 / P2-BL-04) ────────────────────
  // Declared before @Patch(':id') so the static paths are not captured as an :id.

  @Patch('bulk-release')
  @ApiOperation({ summary: 'Bulk assign (or clear) a release on selected work items' })
  @ApiResponse({
    status: 200,
    description: 'Number of items updated',
    schema: { type: 'object', properties: { updated: { type: 'number' } } },
  })
  @ApiCommonErrors(400, 401, 404, 422)
  async bulkAssignRelease(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BulkAssignReleaseDto,
  ): Promise<{ updated: number }> {
    const updated = await this.workItemsService.bulkAssignRelease(
      user,
      dto.projectId,
      dto.itemIds,
      dto.releaseId,
    );
    return { updated };
  }

  @Patch('bulk-iteration')
  @ApiOperation({ summary: 'Bulk assign (or clear) an iteration on selected work items' })
  @ApiResponse({
    status: 200,
    description: 'Number of items updated',
    schema: { type: 'object', properties: { updated: { type: 'number' } } },
  })
  @ApiCommonErrors(400, 401, 404, 422)
  async bulkAssignIteration(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BulkAssignIterationDto,
  ): Promise<{ updated: number }> {
    const updated = await this.workItemsService.bulkAssignIteration(
      user,
      dto.projectId,
      dto.itemIds,
      dto.iterationId,
    );
    return { updated };
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({ summary: 'Update a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkItemResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateWorkItem(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkItemDto,
  ): Promise<WorkItemResponseDto> {
    const item = await this.workItemsService.updateWorkItem(user, id, dto);
    return toWorkItemDto(item);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a work item (soft delete)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Work item deleted' })
  @ApiCommonErrors(401, 404)
  async deleteWorkItem(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.workItemsService.deleteWorkItem(user, id);
  }

  // ── Move (board transition) ────────────────────────────────────────────────

  @Patch(':id/move')
  @ApiOperation({ summary: 'Transition a work item to a new workflow status' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkItemResponseDto })
  @ApiCommonErrors(400, 401, 404)
  async moveWorkItem(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveWorkItemDto,
  ): Promise<WorkItemResponseDto> {
    const item = await this.workItemsService.moveWorkItem(user, id, dto.toStatusId);
    return toWorkItemDto(item);
  }

  // ── Reorder (backlog drag-and-drop) ───────────────────────────────────────

  @Patch('reorder')
  @HttpCode(204)
  @ApiOperation({ summary: 'Bulk update work item ranks for backlog reordering' })
  @ApiResponse({ status: 204, description: 'Work items reordered' })
  @ApiCommonErrors(400, 401, 404, 422)
  async reorderWorkItems(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReorderWorkItemsDto,
  ): Promise<void> {
    await this.workItemsService.reorderWorkItems(user, dto.items);
  }

  // ── Rank (neighbour-based single-item reorder — P2-BL-05) ─────────────────

  @Patch(':id/rank')
  @ApiOperation({ summary: 'Reorder a work item between two backlog neighbours' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkItemResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async rankWorkItem(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RankWorkItemDto,
  ): Promise<WorkItemResponseDto> {
    const item = await this.workItemsService.rankWorkItem(user, id, {
      projectId: dto.projectId,
      beforeId: dto.beforeId,
      afterId: dto.afterId,
    });
    return toWorkItemDto(item);
  }

  // ── Tasks (Tasks tab) ────────────────────────────────────────────────────────

  @Get(':id/tasks')
  @ApiOperation({ summary: 'List child tasks of a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkItemResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async listTasks(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkItemResponseDto[]> {
    const tasks = await this.workItemsService.listTasks(user, id);
    return tasks.map(toWorkItemDto);
  }

  @Get(':id/tasks/totals')
  @ApiOperation({ summary: 'Aggregate task hour totals for a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: TaskTotalsResponseDto })
  @ApiCommonErrors(401, 404)
  async getTaskTotals(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskTotalsResponseDto> {
    return this.workItemsService.getTaskTotals(user, id);
  }

  @Post(':id/tasks')
  @ApiOperation({ summary: 'Create a child task under a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: WorkItemResponseDto })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async createTask(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTaskDto,
  ): Promise<WorkItemResponseDto> {
    const task = await this.workItemsService.createTask(user, id, dto.title, {
      description: dto.description,
      state: dto.state,
      assigneeId: dto.assigneeId,
      teamId: dto.teamId,
      iterationId: dto.iterationId,
      estimateHours: dto.estimateHours,
      todoHours: dto.todoHours,
      actualHours: dto.actualHours,
    });
    return toWorkItemDto(task);
  }

  // ── Activity (Revision History) ──────────────────────────────────────────────

  @Get(':id/activity')
  @ApiOperation({ summary: 'List the revision history of a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ActivityResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async getActivity(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ActivityQueryDto,
  ): Promise<{ data: ActivityResponseDto[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize } = query;
    const result = await this.workItemsService.getActivity(user, id, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return {
      data: result.items.map(toActivityDto),
      total: result.total,
      page,
      pageSize,
    };
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  @Get(':id/labels')
  @ApiOperation({ summary: 'List labels on a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } },
      },
    },
  })
  @ApiCommonErrors(401, 404)
  async listWorkItemLabels(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Array<{ id: string; name: string; color: string }>> {
    return this.workItemsService.getWorkItemLabels(user, id);
  }

  @Post(':id/labels')
  @HttpCode(204)
  @ApiOperation({ summary: 'Add a label to a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Label added' })
  @ApiCommonErrors(400, 401, 404, 422)
  async addLabel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddLabelDto,
  ): Promise<void> {
    await this.workItemsService.addLabelToWorkItem(user, id, dto.labelId);
  }

  @Delete(':id/labels/:labelId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a label from a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'labelId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Label removed' })
  @ApiCommonErrors(401, 404)
  async removeLabel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ): Promise<void> {
    await this.workItemsService.removeLabelFromWorkItem(user, id, labelId);
  }

  // ── Relations (F6 — work-item linking) ──────────────────────────────────────

  @Get(':id/relations')
  @ApiOperation({ summary: 'List work items linked to this work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Resolved relation views (outbound + inbound)' })
  @ApiCommonErrors(401, 404)
  async listRelations(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.workItemsService.listRelations(user, id);
  }

  @Post(':id/relations')
  @ApiOperation({ summary: 'Link this work item to another (blocks/duplicates/relates/…)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Relation created; returns the updated relation list' })
  @ApiCommonErrors(400, 401, 404, 422)
  async createRelation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRelationDto,
  ) {
    return this.workItemsService.linkWorkItem(user, id, dto.targetId, dto.relationType);
  }

  @Delete(':id/relations/:relationId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a link between work items' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'relationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Relation removed' })
  @ApiCommonErrors(401, 404)
  async deleteRelation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
  ): Promise<void> {
    await this.workItemsService.unlinkWorkItem(user, id, relationId);
  }

  // ── Milestones ──────────────────────────────────────────────────────────────

  @Get(':id/milestones')
  @ApiOperation({ summary: 'List milestones assigned to a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
  })
  @ApiCommonErrors(401, 404)
  async listWorkItemMilestones(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.workItemsService.getWorkItemMilestones(user, id);
  }

  @Put(':id/milestones')
  @ApiOperation({ summary: 'Replace the set of milestones assigned to a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
  })
  @ApiCommonErrors(400, 401, 404, 422)
  async setWorkItemMilestones(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetWorkItemMilestonesDto,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.workItemsService.setWorkItemMilestones(user, id, dto.ids);
  }

  // ── Time Logs ───────────────────────────────────────────────────────────────

  @Get(':id/time-logs')
  @ApiOperation({ summary: 'List time log entries for a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: TimeLogResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async listTimeLogs(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TimeLogQueryDto,
  ): Promise<{ items: TimeLogResponseDto[]; total: number }> {
    const result = await this.workItemsService.listTimeLogs(user, id, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return { items: result.items.map(toTimeLogDto), total: result.total };
  }

  @Post(':id/time-logs')
  @UseIdempotency()
  @ApiOperation({ summary: 'Log hours against a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: TimeLogResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async logTime(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTimeLogDto,
  ): Promise<TimeLogResponseDto> {
    const log = await this.workItemsService.logTime(user, id, {
      loggedDate: dto.loggedDate,
      hours: dto.hours,
      description: dto.description,
    });
    return toTimeLogDto(log);
  }

  @Patch(':id/time-logs/:logId')
  @ApiOperation({ summary: 'Edit a time log entry (owner only)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'logId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: TimeLogResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async updateTimeLog(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('logId', ParseUUIDPipe) logId: string,
    @Body() dto: UpdateTimeLogDto,
  ): Promise<TimeLogResponseDto> {
    const log = await this.workItemsService.updateTimeLog(user, id, logId, {
      loggedDate: dto.loggedDate,
      hours: dto.hours,
      description: dto.description,
    });
    return toTimeLogDto(log);
  }

  @Delete(':id/time-logs/:logId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a time log entry (owner or admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'logId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Time log deleted' })
  @ApiCommonErrors(401, 403, 404)
  async deleteTimeLog(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('logId', ParseUUIDPipe) logId: string,
  ): Promise<void> {
    await this.workItemsService.deleteTimeLog(user, id, logId);
  }

  // ── Watchers ────────────────────────────────────────────────────────────────

  @Get(':id/watchers')
  @ApiOperation({ summary: 'List watchers (followers) of a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WatcherResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async listWatchers(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WatcherResponseDto[]> {
    const watchers = await this.workItemsService.listWatchers(user, id);
    return watchers.map(toWatcherDto);
  }

  @Post(':id/watchers')
  @HttpCode(204)
  @ApiOperation({ summary: 'Watch (follow) a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Now watching' })
  @ApiCommonErrors(401, 404)
  async watch(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.workItemsService.watch(user, id);
  }

  @Delete(':id/watchers')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unwatch (unfollow) a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'No longer watching' })
  @ApiCommonErrors(401, 404)
  async unwatch(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.workItemsService.unwatch(user, id);
  }
  // ── Attachments ──────────────────────────────────────────────────────────

  @Post(':id/attachments/presign')
  @RateLimit('STRICT')
  @ApiOperation({ summary: 'Get presigned S3 PUT URL to upload an attachment' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: PresignAttachmentResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async presignAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignAttachmentDto,
  ): Promise<PresignAttachmentResponseDto> {
    return this.workItemsService.presignAttachment(user, id, {
      filename: dto.filename,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    });
  }

  @Post(':id/attachments/:aid/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm file upload completed — activates the attachment' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'aid', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: AttachmentResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async confirmAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ): Promise<AttachmentResponseDto> {
    const attachment = await this.workItemsService.confirmAttachment(user, id, aid);
    return toAttachmentDto(attachment);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'List completed attachments for a work item' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: AttachmentResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async listAttachments(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttachmentResponseDto[]> {
    const items = await this.workItemsService.listAttachments(user, id);
    return items.map(toAttachmentDto);
  }

  @Get(':id/attachments/:aid/download')
  @ApiOperation({ summary: 'Get a presigned S3 GET URL for downloading an attachment' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'aid', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: DownloadUrlResponseDto })
  @ApiCommonErrors(401, 404)
  async getAttachmentDownloadUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ): Promise<DownloadUrlResponseDto> {
    return this.workItemsService.getAttachmentDownloadUrl(user, id, aid);
  }

  @Delete(':id/attachments/:aid')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an attachment (uploader or admin only)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'aid', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Attachment deleted' })
  @ApiCommonErrors(401, 403, 404)
  async deleteAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ): Promise<void> {
    await this.workItemsService.deleteAttachment(user, id, aid);
  }
}
