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
import { ApiCommonErrors, ApiPagedResponse, buildPageArgs } from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { CurrentUser } from '@modules/identity';
import { RequirePermission, AuthPolicy } from '@modules/access';
import { IterationsService } from '../../application/iterations.service';
import { IterationStatusService } from '../../application/iteration-status.service';
import {
  IterationQueryDto,
  CreateIterationDto,
  UpdateIterationDto,
  RolloverIterationDto,
  IterationAssignmentOptionsQueryDto,
  IterationActivityQueryDto,
} from './dto/iteration-request.dto';
import {
  IterationResponseDto,
  IterationOptionDto,
  IterationActivityResponseDto,
} from './dto/iteration-response.dto';
import {
  IterationStatusQueryDto,
  CreateIterationItemDto,
} from './dto/iteration-status-request.dto';
import {
  IterationStatusResponseDto,
  CreateIterationItemResponseDto,
} from './dto/iteration-status-response.dto';
import type { Iteration, IterationOption } from '../../domain/iteration.types';
import type { ActivityLog as IterationActivityLog } from '@modules/activity';

// ── Mappers ────────────────────────────────────────────────────────────────────

function toIterationOptionDto(o: IterationOption): IterationOptionDto {
  return {
    id: o.id,
    name: o.name,
    iterationKey: o.iterationKey,
    startDate: o.startDate,
    endDate: o.endDate,
    state: o.state,
  };
}

function toIterationDto(i: Iteration): IterationResponseDto {
  return {
    id: i.id,
    workspaceId: i.workspaceId,
    projectId: i.projectId,
    teamId: i.teamId,
    iterationKey: i.iterationKey,
    name: i.name,
    goal: i.goal,
    theme: i.theme,
    notes: i.notes,
    state: i.state,
    plannedVelocity: i.plannedVelocity,
    // IT-001: task-estimate rollup. Optional on the DTO — present on the list
    // (enriched by listIterations), undefined elsewhere.
    taskEstimate: i.taskEstimate,
    startDate: i.startDate,
    endDate: i.endDate,
    completedAt: i.completedAt ? i.completedAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

function toIterationActivityDto(a: IterationActivityLog): IterationActivityResponseDto {
  return {
    id: a.id,
    createdAt: a.createdAt,
    actorId: a.actorId,
    actorName: a.actorName,
    action: a.action,
    changes: a.changes,
    metadata: a.metadata ?? {},
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('iterations')
@Controller('iterations')
// Iterations are project-owned. Create checks the project in the body via the
// guard; update/delete/commit/accept resolve the project from the iteration id.
// Guards run in a guaranteed order (JwtAuth → Permission → ProjectPermission).
//
// THE READS SPLIT IN TWO, AND THE SPLIT IS THE POINT (§3.2, RBE-09 / P23-08 / P01-11).
//   • `iteration:view`   — the timebox READ every delivery surface needs: the list, the
//     `/options` picker feed and `Track > Iteration Status`, which §3.2 grants an Editor as
//     "View and update in assigned Teams".
//   • `timebox:view`     — the `Plan > Timeboxes` administration surface: a timebox's own
//     record and its revision history. §3.2 marks that surface **Hidden** for an Editor.
// One code used to gate both, so an Editor read the whole timebox inventory on a hidden
// screen. Do not "simplify" these back to one: whichever code won, one of the two §3.2 rows
// would be wrong again. See the TIMEBOX_VIEW docblock in db/permissions.catalog.ts.
@AuthPolicy()
export class IterationsController {
  constructor(
    private readonly iterationsService: IterationsService,
    private readonly iterationStatusService: IterationStatusService,
  ) {}

  @Get()
  // Stays `iteration:view`. It is the Timeboxes GRID's feed, but it is also the picker feed
  // for Iteration Status, the Backlog's iteration filter, Team Status and Quality — four
  // surfaces §3.2 grants an Editor. Gating it on `timebox:view` would 403 all four.
  @RequirePermission('iteration:view', { from: 'query', field: 'projectId' })
  @ApiOperation({ summary: 'List iterations for a project' })
  @ApiPagedResponse(IterationResponseDto)
  @ApiCommonErrors(400, 401, 404)
  async listIterations(
    @CurrentUser() user: JwtPayload,
    @Query() query: IterationQueryDto,
  ): Promise<PagedResult<IterationResponseDto>> {
    const args = buildPageArgs(query);
    const page = await this.iterationsService.listIterations(
      user,
      query.projectId,
      {
        teamId: query.teamId,
        state: query.state,
        q: query.q,
      },
      args,
    );
    return { data: page.data.map(toIterationDto), pageInfo: page.pageInfo };
  }

  @Post()
  @RequirePermission('iteration:create', { from: 'body', field: 'projectId' })
  @ApiOperation({ summary: 'Create an iteration' })
  @ApiResponse({ status: 201, type: IterationResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async createIteration(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateIterationDto,
  ): Promise<IterationResponseDto> {
    const iteration = await this.iterationsService.createIteration(user, dto.projectId, dto.name, {
      teamId: dto.teamId,
      goal: dto.goal,
      theme: dto.theme,
      notes: dto.notes,
      state: dto.state,
      startDate: dto.startDate ?? undefined,
      endDate: dto.endDate ?? undefined,
      plannedVelocity: dto.plannedVelocity,
    });
    return toIterationDto(iteration);
  }

  // ── Assignment options (P2-IT-10) — declared before :id to avoid route conflict ──

  @Get('options')
  @RequirePermission('iteration:view', { from: 'query', field: 'projectId' })
  @ApiOperation({ summary: 'Get assignable iterations for the work-item picker' })
  @ApiResponse({ status: 200, type: [IterationOptionDto] })
  @ApiCommonErrors(400, 401, 404)
  async getAssignmentOptions(
    @CurrentUser() user: JwtPayload,
    @Query() query: IterationAssignmentOptionsQueryDto,
  ): Promise<IterationOptionDto[]> {
    const options = await this.iterationsService.getAssignmentOptions(
      user,
      query.projectId,
      query.teamId,
    );
    return options.map(toIterationOptionDto);
  }

  @Get(':id')
  // The timebox RECORD — goal, theme, notes, planned velocity — read by exactly one screen,
  // the `Plan > Timeboxes` detail (`IterationDetail`, the only caller of `useIteration`).
  // §3.2 hides that screen from an Editor, so it takes the administration code.
  @RequirePermission('timebox:view', { resource: 'iteration', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Get iteration details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: IterationResponseDto })
  @ApiCommonErrors(401, 404)
  async getIteration(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IterationResponseDto> {
    const iteration = await this.iterationsService.getIterationForView(user, id);
    return toIterationDto(iteration);
  }

  @Get(':id/activity')
  // Who committed, who moved the dates, who changed the goal — the Timeboxes detail's own
  // Revision History tab, and nothing else calls it. Same gate as the record it belongs to.
  @RequirePermission('timebox:view', { resource: 'iteration', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List the revision history of an iteration' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: IterationActivityResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async getActivity(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: IterationActivityQueryDto,
  ): Promise<{
    data: IterationActivityResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { page, pageSize } = query;
    const result = await this.iterationsService.getIterationActivity(user, id, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return {
      data: result.items.map(toIterationActivityDto),
      total: result.total,
      page,
      pageSize,
    };
  }

  @Patch(':id')
  @RequirePermission('iteration:edit', { resource: 'iteration', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Update iteration details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: IterationResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async updateIteration(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIterationDto,
  ): Promise<IterationResponseDto> {
    const iteration = await this.iterationsService.updateIteration(user, id, dto);
    return toIterationDto(iteration);
  }

  @Delete(':id')
  @RequirePermission('iteration:delete', { resource: 'iteration', from: 'param', field: 'id' })
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a planning-state iteration that has no recorded Burndown history',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Iteration deleted' })
  @ApiCommonErrors(400, 401, 403, 404)
  async deleteIteration(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.iterationsService.deleteIteration(user, id);
  }

  @Post(':id/commit')
  @RequirePermission('iteration:edit', { resource: 'iteration', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Commit an iteration (→ committed)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: IterationResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 409)
  async commitIteration(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IterationResponseDto> {
    const iteration = await this.iterationsService.commitIteration(user, id);
    return toIterationDto(iteration);
  }

  @Post(':id/accept')
  @RequirePermission('iteration:edit', { resource: 'iteration', from: 'param', field: 'id' })
  @ApiOperation({
    summary:
      'Accept an iteration (→ accepted). Requires ≥1 assigned Story/Defect and all of them accepted.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async acceptIteration(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IterationResponseDto> {
    const iteration = await this.iterationsService.acceptIteration(user, id);
    return toIterationDto(iteration);
  }

  @Post(':id/rollover')
  @RequirePermission('iteration:edit', { resource: 'iteration', from: 'param', field: 'id' })
  @ApiOperation({
    summary: 'Move unfinished items out of an iteration to another iteration or the backlog',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCommonErrors(400, 401, 403, 404, 422)
  async rolloverIteration(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RolloverIterationDto,
  ): Promise<{ movedCount: number }> {
    return this.iterationsService.rolloverUnfinished(user, id, {
      moveToIterationId: dto.moveToIterationId,
    });
  }

  // ── Iteration Status read-model (P2.3) ──────────────────────────────────────

  @Get(':id/status')
  // `iteration:view`, NOT `timebox:view`: §3.2 gives an Editor `Iteration Status | View
  // and update in assigned Teams`. This is the surface the split exists to keep open.
  @RequirePermission('iteration:view', { resource: 'iteration', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Get Iteration Status: metrics + assigned work items' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: IterationStatusResponseDto })
  @ApiCommonErrors(400, 401, 404)
  async getIterationStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: IterationStatusQueryDto,
  ): Promise<IterationStatusResponseDto> {
    const args = buildPageArgs(query);
    const result = await this.iterationStatusService.getStatus(
      user,
      id,
      {
        q: query.q,
        type: query.type,
        scheduleState: query.scheduleState,
        isBlocked: query.isBlocked,
        assigneeId: query.assigneeId,
        // Manage Filters (P2-IS-FR-022): the chosen columns' own predicates,
        // combined server-side with everything above and with `q`.
        itemKey: query.itemKey,
        title: query.title,
        planEstimate: query.planEstimate,
        taskEstimate: query.taskEstimate,
        toDo: query.toDo,
      },
      args,
    );
    return {
      iteration: {
        id: result.iteration.id,
        name: result.iteration.name,
        iterationKey: result.iteration.iterationKey,
        startDate: result.iteration.startDate,
        endDate: result.iteration.endDate,
        plannedVelocity: result.iteration.plannedVelocity,
      },
      metrics: result.metrics,
      items: result.items.data,
      pageInfo: result.items.pageInfo,
    };
  }

  @Post(':id/work-items')
  /**
   * `work_item:create`, not `iteration:edit` — creating a Story inside an iteration is a work-item
   * create (Iteration Status SRS: "Create Story/Defect in Iteration | `work_item:create` plus
   * project/team access"), and the service's own docblock already said so.
   *
   * A Project Member holds `work_item:create` and not `iteration:edit`, so they saw the Add New
   * button (gated client-side on `work_item:create`), filled the modal and got a 403 — for an item
   * they can create from the Backlog. The iteration still supplies the project scope.
   */
  @RequirePermission('work_item:create', { resource: 'iteration', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Create a Story/Defect directly in the iteration' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: CreateIterationItemResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async createIterationItem(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateIterationItemDto,
  ): Promise<CreateIterationItemResponseDto> {
    return this.iterationStatusService.createItemInIteration(user, id, {
      type: dto.type,
      title: dto.title,
      assigneeId: dto.assigneeId,
      planEstimate: dto.planEstimate,
    });
  }
}
