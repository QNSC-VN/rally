import { Inject, Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { JwtPayload } from '@platform';
import { PERMISSION } from '@shared-kernel';
import { AccessService } from '@modules/access';
import { IterationsService } from '@modules/iterations';
import { WorkItemsService, type UpdateWorkItemInput } from '@modules/work-items';
import { ITeamStatusRepository, TEAM_STATUS_REPOSITORY } from '../domain/ports/team-status.repository';
import type {
  TeamStatusResponse,
  TeamStatusMemberGroup,
  TeamStatusTaskRow,
  TeamTaskState,
  UpdateCapacityInput,
  UpdateTaskFromTeamStatusInput,
  RawTeamStatusTaskRow,
} from '../domain/team-status.types';

/**
 * Schedule-state → Team Status display mapping (SRS §8.5).
 */
const STATE_NORMALIZE: Record<string, TeamTaskState> = {
  idea: 'Defined',
  defined: 'Defined',
  in_progress: 'In-Progress',
  code_review: 'In-Progress',
  testing: 'In-Progress',
  completed: 'Completed',
  accepted: 'Completed',
  released: 'Completed',
};

/**
 * Team Status state → DB schedule_state for updates.
 */
const STATE_TO_SCHEDULE: Record<TeamTaskState, 'defined' | 'in_progress' | 'completed'> = {
  'Defined': 'defined',
  'In-Progress': 'in_progress',
  'Completed': 'completed',
};

@Injectable()
export class TeamStatusService {
  private readonly logger = new Logger(TeamStatusService.name);

  constructor(
    @Inject(TEAM_STATUS_REPOSITORY)
    private readonly repo: ITeamStatusRepository,
    private readonly iterationsService: IterationsService,
    private readonly workItemsService: WorkItemsService,
    private readonly accessService: AccessService,
  ) {}

  /**
   * Build the full Team Status response (P3-TS-FR-001 … P3-TS-FR-015).
   */
  async getTeamStatus(
    actor: JwtPayload,
    projectId: string,
    teamId: string,
    iterationId: string,
  ): Promise<TeamStatusResponse> {
    // Validate iteration exists and belongs to the project.
    const iteration = await this.iterationsService.getIteration(actor.tenantId, iterationId);
    if (iteration.projectId !== projectId) {
      throw new BadRequestException('Iteration does not belong to this project');
    }

    // Fetch raw task rows (type=task, assigned to this iteration).
    const rows = await this.repo.getTaskRows(iterationId, actor.tenantId, teamId);

    // Group by assigneeId.
    const groupMap = new Map<string, TeamStatusTaskRow[]>();
    for (const row of rows) {
      if (!row.assigneeId) continue;
      const group = groupMap.get(row.assigneeId) ?? [];
      group.push(this.toTaskRow(row));
      groupMap.set(row.assigneeId, group);
    }

    // Fetch capacities for all assigned users.
    const userIds = [...groupMap.keys()];
    const capacities = userIds.length > 0
      ? await this.repo.getCapacities(iterationId, userIds)
      : new Map<string, number>();

    // Build member groups.
    const groups: TeamStatusMemberGroup[] = [];
    let totalCapacity = 0;
    let totalEstimate = 0;
    let totalTodo = 0;
    let totalActual = 0;

    for (const [userId, tasks] of groupMap) {
      const capacity = capacities.get(userId) ?? 0;
      const taskEstimate = tasks.reduce((s, t) => s + t.estimateHours, 0);
      const taskTodo = tasks.reduce((s, t) => s + t.todoHours, 0);
      const taskActual = tasks.reduce((s, t) => s + t.actualHours, 0);
      const progress = taskEstimate > 0
        ? Math.min(Math.round((taskActual / taskEstimate) * 100), 100)
        : 0;

      groups.push({
        owner: {
          id: userId,
          displayName: tasks[0].owner.displayName,
          avatarUrl: tasks[0].owner.avatarUrl,
        },
        capacityHours: capacity,
        taskCount: tasks.length,
        estimateHours: taskEstimate,
        todoHours: taskTodo,
        actualHours: taskActual,
        progressPercent: progress,
        tasks,
      });

      totalCapacity += capacity;
      totalEstimate += taskEstimate;
      totalTodo += taskTodo;
      totalActual += taskActual;
    }

    // Sort groups by owner displayName.
    groups.sort((a, b) => a.owner.displayName.localeCompare(b.owner.displayName));

    return {
      projectId,
      teamId,
      iteration: {
        id: iteration.id,
        name: iteration.name,
        startDate: iteration.startDate,
        endDate: iteration.endDate,
      },
      totals: {
        capacityHours: totalCapacity,
        estimateHours: totalEstimate,
        todoHours: totalTodo,
        actualHours: totalActual,
      },
      groups,
    };
  }

  /**
   * Update member capacity (P3-TS-FR-017/018).
   * Upserts by (projectId, teamId, iterationId, userId).
   */
  async updateCapacity(
    actor: JwtPayload,
    input: UpdateCapacityInput,
  ): Promise<{ userId: string; capacityHours: number }> {
    await this.assertEditPermission(actor, input.projectId);
    if (input.capacityHours < 0) {
      throw new BadRequestException('capacityHours must be >= 0');
    }
    return this.repo.upsertCapacity({
      tenantId: actor.tenantId,
      projectId: input.projectId,
      teamId: input.teamId,
      iterationId: input.iterationId,
      userId: input.userId,
      capacityHours: input.capacityHours,
    });
  }

  /**
   * Update a task from Team Status (P3-TS-FR-019 … P3-TS-FR-023).
   * Accepts partial patch for title and/or state.
   * When state = Completed, propagates to parent work product (P3-TS-05).
   */
  async updateTask(
    actor: JwtPayload,
    taskId: string,
    input: UpdateTaskFromTeamStatusInput,
  ): Promise<{
    id: string;
    taskKey: string;
    title: string;
    state: TeamTaskState;
    workProduct?: { id: string; key: string; status: string };
  }> {
    // Look up the task to get its projectId for permission check.
    const task = await this.workItemsService.getWorkItem(actor.tenantId, taskId);
    await this.assertEditPermission(actor, task.projectId);

    const updateInput: UpdateWorkItemInput = {};
    if (input.title !== undefined) {
      const trimmed = input.title.trim();
      if (!trimmed) {
        throw new BadRequestException('Title must not be empty');
      }
      updateInput.title = trimmed;
    }
    if (input.state !== undefined) {
      updateInput.scheduleState = STATE_TO_SCHEDULE[input.state];
    }

    const updated = await this.workItemsService.updateWorkItem(actor, taskId, updateInput);

    const result: {
      id: string;
      taskKey: string;
      title: string;
      state: TeamTaskState;
      workProduct?: { id: string; key: string; status: string };
    } = {
      id: updated.id,
      taskKey: updated.itemKey,
      title: updated.title,
      state: STATE_NORMALIZE[updated.scheduleState] ?? 'Defined',
    };

    // Propagate completion to parent work product (P3-TS-05).
    if (input.state === 'Completed' && updated.parentId) {
      try {
        const parent = await this.workItemsService.updateWorkItem(actor, updated.parentId, {
          scheduleState: 'completed',
        });
        result.workProduct = {
          id: parent.id,
          key: parent.itemKey,
          status: 'Completed',
        };
      } catch {
        this.logger.warn(
          { taskId, parentId: updated.parentId },
          'Failed to propagate completion to parent work product',
        );
      }
    }

    return result;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private toTaskRow(row: RawTeamStatusTaskRow): TeamStatusTaskRow {
    return {
      id: row.id,
      taskKey: row.itemKey,
      title: row.title,
      displayName: row.title,
      workProduct: {
        id: row.parentId ?? '',
        key: row.parentKey ?? '',
        type: (row.parentType as TeamStatusTaskRow['workProduct']['type']) ?? 'Story',
        title: row.parentTitle ?? '',
        status: row.parentScheduleState ?? '',
      },
      release: row.releaseId
        ? { id: row.releaseId, name: row.releaseName ?? '' }
        : null,
      state: STATE_NORMALIZE[row.scheduleState] ?? 'Defined',
      estimateHours: Number(row.estimateHours ?? 0),
      todoHours: Number(row.todoHours ?? 0),
      actualHours: Number(row.actualHours ?? 0),
      owner: {
        id: row.assigneeId ?? '',
        displayName: row.assigneeDisplayName ?? 'Unassigned',
        avatarUrl: row.assigneeAvatarUrl,
      },
      rank: row.rank,
    };
  }

  private async assertEditPermission(actor: JwtPayload, projectId: string) {
    await this.accessService.assertProjectPermission(
      actor,
      projectId,
      PERMISSION.TEAM_STATUS_EDIT,
    );
  }
}