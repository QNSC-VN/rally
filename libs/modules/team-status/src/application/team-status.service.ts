import { Inject, Injectable, Logger } from '@nestjs/common';
import { PreconditionFailedException, ValidationException, type JwtPayload } from '@platform';
import { PERMISSION } from '@shared-kernel';
import { AccessService } from '@modules/access';
import { IterationsService } from '@modules/iterations';
import { WorkItemsService, type UpdateWorkItemInput } from '@modules/work-items';
import {
  ITeamStatusRepository,
  TEAM_STATUS_REPOSITORY,
} from '../domain/ports/team-status.repository';
import type {
  TeamStatusResponse,
  TeamStatusMemberGroup,
  TeamStatusOwner,
  TeamStatusTaskRow,
  TeamTaskState,
  UpdateCapacityInput,
  UpdateTaskFromTeamStatusInput,
  RawTeamStatusTaskRow,
} from '../domain/team-status.types';

/**
 * Task state → Team Status display mapping (SRS §8.5).
 * Maps both work_item schedule_state and task_state enum values.
 */
const STATE_NORMALIZE: Record<string, TeamTaskState> = {
  // work_item schedule_state values
  idea: 'Defined',
  defined: 'Defined',
  ready: 'Defined',
  in_progress: 'In-Progress',
  code_review: 'In-Progress',
  testing: 'In-Progress',
  completed: 'Completed',
  accepted: 'Completed',
  released: 'Completed',
  // task_state enum values (dedicated tasks table)
  // 'defined' and 'in_progress' and 'completed' already covered above
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
    teamId: string | undefined | null,
    iterationId: string,
  ): Promise<TeamStatusResponse> {
    // Validate iteration exists and belongs to the project.
    const iteration = await this.iterationsService.getIteration(actor.workspaceId, iterationId);
    if (iteration.projectId !== projectId) {
      throw new PreconditionFailedException(
        'ITERATION_PROJECT_MISMATCH',
        'Iteration does not belong to this project',
      );
    }

    // Fetch raw task rows (type=task, assigned to this iteration).
    const rows = await this.repo.getTaskRows(iterationId, actor.workspaceId, teamId);

    // Group tasks by assignee ('unassigned' bucket for a null assignee).
    const tasksByUser = new Map<string, TeamStatusTaskRow[]>();
    for (const row of rows) {
      const key = row.assigneeId ?? 'unassigned';
      const bucket = tasksByUser.get(key) ?? [];
      bucket.push(this.toTaskRow(row));
      tasksByUser.set(key, bucket);
    }

    // Full member roster — Rally lists every team member for the iteration,
    // including those with zero tasks (rendered with an empty load bar). Source
    // is the iteration's team; falls back to project members when the iteration
    // is not team-scoped. Task assignees no longer on the roster (e.g. left the
    // team but still own tasks) are folded in so their work stays visible.
    const rosterTeamId = teamId ?? iteration.teamId ?? null;
    const roster = await this.repo.getRosterMembers({
      workspaceId: actor.workspaceId,
      projectId,
      teamId: rosterTeamId,
    });

    const memberInfo = new Map<string, TeamStatusOwner>();
    for (const member of roster) {
      memberInfo.set(member.id, {
        id: member.id,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
      });
    }
    for (const [userId, tasks] of tasksByUser) {
      if (userId !== 'unassigned' && !memberInfo.has(userId)) {
        memberInfo.set(userId, tasks[0].owner);
      }
    }

    // Capacities for every roster member (not just those who own tasks).
    const memberIds = [...memberInfo.keys()];
    const capacities =
      memberIds.length > 0
        ? await this.repo.getCapacities(iterationId, memberIds)
        : new Map<string, number>();

    // One group per member (empty task list when they have none), plus an
    // Unassigned group when unassigned tasks exist.
    const groups: TeamStatusMemberGroup[] = [];
    for (const [userId, owner] of memberInfo) {
      groups.push(
        this.buildMemberGroup(owner, capacities.get(userId) ?? 0, tasksByUser.get(userId) ?? []),
      );
    }
    const unassignedTasks = tasksByUser.get('unassigned');
    if (unassignedTasks && unassignedTasks.length > 0) {
      groups.push(
        this.buildMemberGroup(
          { id: 'unassigned', displayName: 'Unassigned', avatarUrl: null },
          0,
          unassignedTasks,
        ),
      );
    }

    // Sort members alphabetically by displayName; Unassigned pinned to the bottom.
    groups.sort((a, b) => {
      if (a.owner.id === 'unassigned') return 1;
      if (b.owner.id === 'unassigned') return -1;
      return a.owner.displayName.localeCompare(b.owner.displayName);
    });

    // Totals span the whole roster (capacity includes zero-task members).
    const totals = groups.reduce(
      (acc, g) => ({
        capacityHours: acc.capacityHours + g.capacityHours,
        estimateHours: acc.estimateHours + g.estimateHours,
        todoHours: acc.todoHours + g.todoHours,
        actualHours: acc.actualHours + g.actualHours,
      }),
      { capacityHours: 0, estimateHours: 0, todoHours: 0, actualHours: 0 },
    );

    return {
      projectId,
      teamId,
      iteration: {
        id: iteration.id,
        name: iteration.name,
        startDate: iteration.startDate,
        endDate: iteration.endDate,
      },
      totals,
      groups,
    };
  }

  /**
   * Update member capacity (P3-TS-FR-017/018).
   * Upserts by (projectId, teamId, iterationId, userId).
   * If teamId is not provided (e.g. "All teams" view), resolves it from the iteration.
   */
  async updateCapacity(
    actor: JwtPayload,
    input: UpdateCapacityInput,
  ): Promise<{ userId: string; capacityHours: number }> {
    await this.assertEditPermission(actor, input.projectId);
    if (input.capacityHours < 0) {
      throw new ValidationException('TEAM_STATUS_INVALID_CAPACITY', 'capacityHours must be >= 0');
    }

    // Resolve teamId from iteration when not provided (e.g. "All teams" view)
    let teamId = input.teamId;
    if (!teamId) {
      const iteration = await this.iterationsService.getIteration(
        actor.workspaceId,
        input.iterationId,
      );
      teamId = iteration.teamId ?? undefined;
      if (!teamId) {
        throw new ValidationException(
          'TEAM_STATUS_TEAM_REQUIRED',
          'Cannot determine team for capacity update — iteration is not team-scoped and no teamId was provided',
        );
      }
    }

    return this.repo.upsertCapacity({
      workspaceId: actor.workspaceId,
      projectId: input.projectId,
      teamId,
      iterationId: input.iterationId,
      userId: input.userId,
      capacityHours: input.capacityHours,
    });
  }

  /**
   * Update a task from Team Status (P3-TS-FR-019 … P3-TS-FR-023).
   * Accepts partial patch for title and/or state.
   * When state = Completed, propagates to parent work product (P3-TS-05).
   * P3 refactor: updates the `tasks` table via work-items service.
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
    const task = await this.workItemsService.getWorkItem(actor.workspaceId, taskId);
    await this.assertEditPermission(actor, task.projectId);

    const updateInput: UpdateWorkItemInput = {};
    if (input.title !== undefined) {
      const trimmed = input.title.trim();
      if (!trimmed) {
        throw new ValidationException('TEAM_STATUS_INVALID_TITLE', 'Title must not be empty');
      }
      updateInput.title = trimmed;
    }
    if (input.state !== undefined) {
      // Map Team Status state to task_state enum
      const stateMap: Record<TeamTaskState, string> = {
        Defined: 'defined',
        'In-Progress': 'in_progress',
        Completed: 'completed',
      };
      updateInput.scheduleState = stateMap[input.state] as 'defined' | 'in_progress' | 'completed';
    }
    if (input.estimateHours !== undefined) {
      updateInput.estimateHours =
        input.estimateHours === null ? null : input.estimateHours.toFixed(2);
      // Auto-sync: editing estimate also sets To Do, unless caller explicitly sent one.
      if (input.todoHours === undefined) {
        updateInput.todoHours = updateInput.estimateHours;
      }
    }
    if (input.todoHours !== undefined) {
      updateInput.todoHours = input.todoHours === null ? null : input.todoHours.toFixed(2);
    }
    if (input.actualHours !== undefined) {
      updateInput.actualHours = input.actualHours === null ? null : input.actualHours.toFixed(2);
    }
    if (input.assigneeId !== undefined) {
      updateInput.assigneeId = input.assigneeId;
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
          'Failed to check/propagate completion to parent work product',
        );
      }
    }

    return result;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Aggregate a member's tasks into a group row (works for zero-task members). */
  private buildMemberGroup(
    owner: TeamStatusOwner,
    capacityHours: number,
    tasks: TeamStatusTaskRow[],
  ): TeamStatusMemberGroup {
    const estimateHours = tasks.reduce((s, t) => s + t.estimateHours, 0);
    const todoHours = tasks.reduce((s, t) => s + t.todoHours, 0);
    const actualHours = tasks.reduce((s, t) => s + t.actualHours, 0);
    const progressPercent =
      capacityHours > 0 ? Math.round((estimateHours / capacityHours) * 100) : 0;
    return {
      owner,
      capacityHours,
      taskCount: tasks.length,
      estimateHours,
      todoHours,
      actualHours,
      progressPercent,
      tasks,
    };
  }

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
      release: row.releaseId ? { id: row.releaseId, name: row.releaseName ?? '' } : null,
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
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.TEAM_STATUS_EDIT);
  }
}
