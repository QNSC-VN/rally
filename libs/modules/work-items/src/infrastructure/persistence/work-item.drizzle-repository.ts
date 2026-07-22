import { Injectable } from '@nestjs/common';
import { and, eq, isNull, lt, or, ilike, inArray, sql, asc, desc, type AnyColumn } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult, keysetCondition } from '@platform';
import type { DrizzleDB, DbExecutor, CursorPayload, PagedResult } from '@platform';
import {
  workItems,
  workItemLabels,
  labels,
  iterations,
  releases,
  tasks,
  milestones,
  milestoneArtifacts,
  projects,
  workflowStatuses,
} from '../../../../../../db/schema/work';
import type {
  DefectSeverity,
  DefectEnvironment,
  DefectRootCause,
  DefectResolution,
  DefectState,
  WorkItemScheduleState,
  TaskState,
} from '../../../../../../db/schema/enums';
import { acceptedScheduleStatesSql } from '../../../../../../db/schema/enums';
import type {
  WorkItem,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemFilters,
  WorkItemSortBy,
  TaskTotals,
  MyWorkItem,
  WorkspaceSummary,
} from '../../domain/work-item.types';
import { UNASSIGNED_FILTER } from '../../domain/work-item.types';
import { IWorkItemRepository, IterationScope } from '../../domain/ports/work-item.repository';

/**
 * Canonical projection of a work-item schedule_state (D1) onto the task_state
 * (D3) lifecycle used by the `tasks` table. Exhaustively keyed on the enum so a
 * future schedule-state addition/rename is a compile error (no silent fallback).
 * `idea`/`defined` → defined, `in_progress` → in_progress, and every completed
 * state (`completed`/`accepted`/`release`) → completed.
 */
const SCHEDULE_STATE_TO_TASK_STATE: Record<WorkItemScheduleState, TaskState> = {
  idea: 'defined',
  defined: 'defined',
  in_progress: 'in_progress',
  completed: 'completed',
  accepted: 'completed',
  release: 'completed',
};

/**
 * Single source of truth pairing each sortable backlog column with the cursor
 * value extracted from a row. Keeping the ORDER BY column and the keyset cursor
 * key defined together guarantees they can never drift apart — the bug that
 * previously left every non-rank sort paginating by rank. `planEstimate` maps to
 * the nullable `story_points`; {@link keysetCondition} handles its NULL ordering.
 */
const BACKLOG_SORT_COLUMNS: Record<
  WorkItemSortBy,
  { column: AnyColumn; value: (w: WorkItem) => unknown }
> = {
  rank: { column: workItems.rank, value: (w) => w.rank },
  itemKey: { column: workItems.itemKey, value: (w) => w.itemKey },
  type: { column: workItems.type, value: (w) => w.type },
  title: { column: workItems.title, value: (w) => w.title },
  scheduleState: { column: workItems.scheduleState, value: (w) => w.scheduleState },
  priority: { column: workItems.priority, value: (w) => w.priority },
  planEstimate: { column: workItems.storyPoints, value: (w) => w.storyPoints },
};

@Injectable()
export class WorkItemDrizzleRepository implements IWorkItemRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string, workspaceId: string, executor?: DbExecutor): Promise<WorkItem | null> {
    const exec = executor ?? this.db;
    // Try work_items first, then fall back to tasks table (P3).
    const rows = await exec
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.id, id),
          eq(workItems.workspaceId, workspaceId),
          isNull(workItems.deletedAt),
        ),
      )
      .limit(1);
    if (rows.length > 0) return rows[0] as WorkItem;

    const tRows = await exec
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
      .limit(1);
    if (tRows.length > 0) {
      return this.mapTaskRow(tRows[0]);
    }
    return null;
  }

  /**
   * Resolve a work item by its human item key within a project. Mirrors
   * {@link findById}'s work_items→tasks fallback so task detail pages (whose
   * rows live in `work.tasks` since the Phase 3 split) are reachable by key.
   */
  async findByKey(
    itemKey: string,
    projectId: string,
    workspaceId: string,
  ): Promise<WorkItem | null> {
    const rows = await this.db
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.itemKey, itemKey),
          eq(workItems.projectId, projectId),
          eq(workItems.workspaceId, workspaceId),
          isNull(workItems.deletedAt),
        ),
      )
      .limit(1);
    if (rows.length > 0) return rows[0] as WorkItem;

    const tRows = await this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.itemKey, itemKey),
          eq(tasks.projectId, projectId),
          eq(tasks.workspaceId, workspaceId),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    return tRows.length > 0 ? this.mapTaskRow(tRows[0]) : null;
  }

  /** Project a `work.tasks` row onto the unified WorkItem shape. */
  private mapTaskRow(t: typeof tasks.$inferSelect): WorkItem {
    return {
      id: t.id,
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      itemKey: t.itemKey,
      type: 'task',
      title: t.title,
      description: t.description,
      statusId: '',
      scheduleState:
        t.state === 'in_progress'
          ? 'in_progress'
          : t.state === 'completed'
            ? 'completed'
            : 'defined',
      // Tasks have a single state; Flow State mirrors it for shape compatibility.
      flowState:
        t.state === 'in_progress'
          ? 'in_progress'
          : t.state === 'completed'
            ? 'completed'
            : 'defined',
      priority: 'normal',
      assigneeId: t.assigneeId,
      reporterId: null,
      parentId: t.parentId,
      teamId: t.teamId,
      iterationId: t.iterationId,
      releaseId: null,
      storyPoints: null,
      estimateHours: t.estimateHours,
      todoHours: t.todoHours,
      actualHours: t.actualHours,
      acceptanceCriteria: null,
      notes: null,
      releaseNotes: null,
      isBlocked: false,
      blockedReason: null,
      rank: t.rank,
      customFields: {},
      createdBy: t.createdBy,
      updatedBy: t.updatedBy,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      deletedAt: t.deletedAt,
      severity: null,
      foundInEnvironment: null,
      foundInReleaseId: null,
      rootCause: null,
      resolution: null,
      devOwnerId: null,
      defectState: null,
      fixedInBuild: null,
    };
  }

  async findByIds(ids: string[], workspaceId: string): Promise<WorkItem[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(workItems)
      .where(
        and(
          inArray(workItems.id, ids),
          eq(workItems.workspaceId, workspaceId),
          isNull(workItems.deletedAt),
        ),
      );
    // Fall back to the tasks table for any ids not in work_items (Phase 3 split),
    // mirroring findById — so task-neighbour lookups (e.g. rank reorder) resolve.
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      const tRows = await this.db
        .select()
        .from(tasks)
        .where(
          and(
            inArray(tasks.id, missing),
            eq(tasks.workspaceId, workspaceId),
            isNull(tasks.deletedAt),
          ),
        );
      return [...(rows as WorkItem[]), ...tRows.map((r) => this.mapTaskRow(r))];
    }
    return rows as WorkItem[];
  }

  async findIterationScope(
    iterationId: string,
    workspaceId: string,
  ): Promise<IterationScope | null> {
    const rows = await this.db
      .select({ projectId: iterations.projectId, teamId: iterations.teamId })
      .from(iterations)
      .where(and(eq(iterations.id, iterationId), eq(iterations.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findReleaseProject(releaseId: string, workspaceId: string): Promise<string | null> {
    const rows = await this.db
      .select({ projectId: releases.projectId })
      .from(releases)
      .where(and(eq(releases.id, releaseId), eq(releases.workspaceId, workspaceId)))
      .limit(1);
    return rows[0]?.projectId ?? null;
  }

  async assignIteration(
    ids: string[],
    iterationId: string | null,
    workspaceId: string,
    updatedBy: string,
    executor?: DbExecutor,
  ): Promise<void> {
    if (ids.length === 0) return;
    const exec = executor ?? this.db;
    await exec
      .update(workItems)
      .set({ iterationId, updatedBy, updatedAt: new Date() })
      .where(
        and(
          inArray(workItems.id, ids),
          eq(workItems.workspaceId, workspaceId),
          isNull(workItems.deletedAt),
        ),
      );
  }

  async assignRelease(
    ids: string[],
    releaseId: string | null,
    workspaceId: string,
    updatedBy: string,
    executor?: DbExecutor,
  ): Promise<void> {
    if (ids.length === 0) return;
    const exec = executor ?? this.db;
    await exec
      .update(workItems)
      .set({ releaseId, updatedBy, updatedAt: new Date() })
      .where(
        and(
          inArray(workItems.id, ids),
          eq(workItems.workspaceId, workspaceId),
          isNull(workItems.deletedAt),
        ),
      );
  }

  /** Shared filter builder for list/backlog queries. */
  private buildFilters(
    projectId: string,
    workspaceId: string,
    filters: WorkItemFilters,
  ): ReturnType<typeof and>[] {
    const conditions = [
      eq(workItems.projectId, projectId),
      eq(workItems.workspaceId, workspaceId),
      isNull(workItems.deletedAt),
    ];

    if (filters.type) conditions.push(eq(workItems.type, filters.type));
    if (filters.statusId) conditions.push(eq(workItems.statusId, filters.statusId));
    if (filters.scheduleState) conditions.push(eq(workItems.scheduleState, filters.scheduleState));
    if (filters.priority) conditions.push(eq(workItems.priority, filters.priority));
    if (filters.assigneeId) {
      conditions.push(
        filters.assigneeId === UNASSIGNED_FILTER
          ? isNull(workItems.assigneeId)
          : eq(workItems.assigneeId, filters.assigneeId),
      );
    }
    if (filters.teamId) {
      conditions.push(eq(workItems.teamId, filters.teamId));
    }
    if (filters.iterationId) conditions.push(eq(workItems.iterationId, filters.iterationId));
    if (filters.releaseId) conditions.push(eq(workItems.releaseId, filters.releaseId));
    if (filters.parentId) conditions.push(eq(workItems.parentId, filters.parentId));
    if (filters.q) {
      const term = filters.q.trim();
      if (term) {
        // Use Postgres full-text search (GIN index on search_vector, migration 0012).
        // ILIKE with % wildcards on item_key for prefix/substring key lookups (e.g. "US", "DE", "US-1").
        // plainto_tsquery handles multi-word title searches.
        conditions.push(
          or(
            ilike(workItems.itemKey, `%${term}%`),
            ilike(workItems.title, `%${term}%`),
            sql`${workItems.searchVector} @@ plainto_tsquery('english', ${term})`,
          )!,
        );
      }
    }
    return conditions;
  }

  async listByProject(
    projectId: string,
    workspaceId: string,
    filters: WorkItemFilters,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>> {
    const conditions = this.buildFilters(projectId, workspaceId, filters);
    if (cursor) {
      conditions.push(lt(workItems.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(workItems)
      .where(and(...conditions))
      .orderBy(desc(workItems.createdAt))
      .limit(limit + 1);

    return buildPageResult(rows as WorkItem[], limit, (w) => [w.createdAt.toISOString()]);
  }

  async listBacklog(
    projectId: string,
    workspaceId: string,
    filters: WorkItemFilters,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>> {
    const conditions = this.buildFilters(projectId, workspaceId, filters);
    // Backlog shows only story + defect (tasks live under their parent item).
    conditions.push(inArray(workItems.type, ['story', 'defect']));

    // Keyset ("seek") pagination keyed on the ACTIVE sort column, with the row
    // id as a stable unique tie-breaker. This keeps paging correct for every
    // sort — non-unique columns (title/type/priority), the nullable
    // planEstimate, and the default rank — instead of always seeking by rank.
    const sort = BACKLOG_SORT_COLUMNS[filters.sortBy ?? 'rank'];
    const direction: 'asc' | 'desc' = filters.sortBy
      ? (filters.sortDirection ?? 'asc')
      : 'asc';
    const orderDir = direction === 'desc' ? desc : asc;

    // Total matching the filters (before the cursor/limit) so the backlog
    // footer can show an accurate count — SRS BL-FR-007 ("total đúng").
    const baseConditions = [...conditions];

    if (cursor) {
      conditions.push(keysetCondition(sort.column, workItems.id, cursor));
    }

    const rows = await this.db
      .select()
      .from(workItems)
      .where(and(...conditions))
      .orderBy(orderDir(sort.column), asc(workItems.id))
      .limit(limit + 1);

    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(workItems)
      .where(and(...baseConditions));

    return buildPageResult(
      rows as WorkItem[],
      limit,
      (w) => [sort.value(w)],
      direction,
      Number(countRow?.total ?? 0),
    );
  }

  async listTasksByParent(parentId: string, workspaceId: string): Promise<WorkItem[]> {
    const rows = await this.db
      .select({
        id: tasks.id,
        workspaceId: tasks.workspaceId,
        projectId: tasks.projectId,
        itemKey: tasks.itemKey,
        type: sql<string>`'task'`.as('type'),
        title: tasks.title,
        description: tasks.description,
        statusId: sql<string>`''`.as('status_id'),
        scheduleState: tasks.state,
        flowState: tasks.state,
        priority: sql<string>`'normal'`.as('priority'),
        assigneeId: tasks.assigneeId,
        reporterId: sql<string | null>`null`.as('reporter_id'),
        parentId: tasks.parentId,
        teamId: tasks.teamId,
        iterationId: tasks.iterationId,
        releaseId: sql<string | null>`null`.as('release_id'),
        storyPoints: sql<string | null>`null`.as('story_points'),
        estimateHours: tasks.estimateHours,
        todoHours: tasks.todoHours,
        actualHours: tasks.actualHours,
        acceptanceCriteria: sql<string | null>`null`.as('acceptance_criteria'),
        notes: sql<string | null>`null`.as('notes'),
        releaseNotes: sql<string | null>`null`.as('release_notes'),
        isBlocked: sql<boolean>`false`.as('is_blocked'),
        blockedReason: sql<string | null>`null`.as('blocked_reason'),
        rank: tasks.rank,
        customFields: sql<Record<string, unknown>>`'{}'`.as('custom_fields'),
        createdBy: tasks.createdBy,
        updatedBy: tasks.updatedBy,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        deletedAt: tasks.deletedAt,
        severity: sql<string | null>`null`.as('severity'),
        foundInEnvironment: sql<string | null>`null`.as('found_in_environment'),
        foundInReleaseId: sql<string | null>`null`.as('found_in_release_id'),
        rootCause: sql<string | null>`null`.as('root_cause'),
        resolution: sql<string | null>`null`.as('resolution'),
        devOwnerId: sql<string | null>`null`.as('dev_owner_id'),
        defectState: sql<string | null>`null`.as('defect_state'),
        fixedInBuild: sql<string | null>`null`.as('fixed_in_build'),
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.parentId, parentId),
          eq(tasks.workspaceId, workspaceId),
          isNull(tasks.deletedAt),
        ),
      )
      .orderBy(tasks.rank, tasks.createdAt);
    return rows as WorkItem[];
  }

  async findMaxRank(
    scope: { projectId: string; parentId?: string | null },
    workspaceId: string,
  ): Promise<string | null> {
    // P3: When parentId is set, this is for a task — query the `tasks` table.
    if (scope.parentId) {
      const rows = await this.db
        .select({ rank: tasks.rank })
        .from(tasks)
        .where(
          and(
            eq(tasks.parentId, scope.parentId),
            eq(tasks.workspaceId, workspaceId),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(desc(tasks.rank))
        .limit(1);
      return rows[0]?.rank ?? null;
    }

    const conditions = [eq(workItems.workspaceId, workspaceId), isNull(workItems.deletedAt)];
    conditions.push(eq(workItems.projectId, scope.projectId), isNull(workItems.parentId));
    const rows = await this.db
      .select({ rank: workItems.rank })
      .from(workItems)
      .where(and(...conditions))
      .orderBy(desc(workItems.rank))
      .limit(1);
    return rows[0]?.rank ?? null;
  }

  async areAllTasksComplete(
    parentId: string,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<boolean> {
    const exec = executor ?? this.db;
    const rows = await exec
      .select({
        count: sql<number>`count(*)::int`,
        allDone: sql<boolean>`bool_and(state = 'completed')`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.parentId, parentId),
          eq(tasks.workspaceId, workspaceId),
          isNull(tasks.deletedAt),
        ),
      );
    const r = rows[0];
    // If there are no tasks, return true (nothing blocks parent completion).
    if (!r || Number(r.count) === 0) return true;
    return r.allDone === true;
  }

  async autoAcceptIterationIfComplete(
    iterationId: string,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<boolean> {
    const exec = executor ?? this.db;
    // Are all assigned Story/Defect items accepted, with at least one present?
    const rows = await exec
      .select({
        total: sql<number>`count(*)::int`,
        allAccepted: sql<boolean>`bool_and(${workItems.scheduleState} in (${acceptedScheduleStatesSql()}))`,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.iterationId, iterationId),
          eq(workItems.workspaceId, workspaceId),
          inArray(workItems.type, ['story', 'defect']),
          isNull(workItems.deletedAt),
        ),
      );
    const r = rows[0];
    if (!r || Number(r.total) === 0 || r.allAccepted !== true) return false;

    // Idempotent transition — a planning or committed iteration flips to
    // accepted (BR-IT-02: auto-accept when every assigned US/DE is accepted,
    // regardless of whether the iteration was manually committed first). An
    // already-accepted iteration is left untouched, so this never auto-reverses.
    const updated = await exec
      .update(iterations)
      .set({ state: 'accepted', completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(iterations.id, iterationId),
          eq(iterations.workspaceId, workspaceId),
          inArray(iterations.state, ['planning', 'committed']),
        ),
      )
      .returning({ id: iterations.id });
    return updated.length > 0;
  }

  async getTaskTotals(parentId: string, workspaceId: string): Promise<TaskTotals> {
    // P3: Query the dedicated `tasks` table.
    const rows = await this.db
      .select({
        taskCount: sql<number>`count(*)::int`,
        estimateHours: sql<string>`coalesce(sum(${tasks.estimateHours}), 0)`,
        todoHours: sql<string>`coalesce(sum(${tasks.todoHours}), 0)`,
        actualHours: sql<string>`coalesce(sum(${tasks.actualHours}), 0)`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.parentId, parentId),
          eq(tasks.workspaceId, workspaceId),
          isNull(tasks.deletedAt),
        ),
      );
    const r = rows[0];
    return {
      taskCount: Number(r?.taskCount ?? 0),
      estimateHours: Number(r?.estimateHours ?? 0),
      todoHours: Number(r?.todoHours ?? 0),
      actualHours: Number(r?.actualHours ?? 0),
    };
  }

  // ── Home dashboard aggregates ─────────────────────────────────────────────
  // Bounded / workspace-scoped queries that replace the old per-project fan-out.

  /** Top-N work items assigned to the actor across the workspace, ordered by
   *  priority (urgent→none) then rank. One query, project key/name joined. */
  async listMyWork(
    workspaceId: string,
    userId: string,
    { limit }: { limit: number },
  ): Promise<MyWorkItem[]> {
    const rows = await this.db
      .select({
        id: workItems.id,
        itemKey: workItems.itemKey,
        type: workItems.type,
        title: workItems.title,
        scheduleState: workItems.scheduleState,
        priority: workItems.priority,
        projectId: workItems.projectId,
        projectKey: projects.key,
        projectName: projects.name,
      })
      .from(workItems)
      .innerJoin(projects, eq(projects.id, workItems.projectId))
      .where(
        and(
          eq(workItems.workspaceId, workspaceId),
          eq(workItems.assigneeId, userId),
          isNull(workItems.deletedAt),
        ),
      )
      .orderBy(
        desc(
          sql`case ${workItems.priority} when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 when 'low' then 1 else 0 end`,
        ),
        asc(workItems.rank),
      )
      .limit(limit);
    return rows;
  }

  /** Exact workspace-wide counts for the Home summary strip. "Open" = the work
   *  item's workflow-status category is not `done`. */
  async getWorkspaceSummary(workspaceId: string, userId: string): Promise<WorkspaceSummary> {
    const [projRow] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.status, 'active'),
          isNull(projects.deletedAt),
        ),
      );
    const [iterRow] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(iterations)
      .where(and(eq(iterations.workspaceId, workspaceId), eq(iterations.state, 'committed')));
    const [wiRow] = await this.db
      .select({
        open: sql<number>`sum(case when ${workflowStatuses.category} <> 'done' then 1 else 0 end)::int`,
        blocked: sql<number>`sum(case when ${workItems.isBlocked} and ${workflowStatuses.category} <> 'done' then 1 else 0 end)::int`,
        defects: sql<number>`sum(case when ${workItems.type} = 'defect' and ${workflowStatuses.category} <> 'done' then 1 else 0 end)::int`,
        mine: sql<number>`sum(case when ${workItems.assigneeId} = ${userId} and ${workflowStatuses.category} <> 'done' then 1 else 0 end)::int`,
      })
      .from(workItems)
      .innerJoin(workflowStatuses, eq(workflowStatuses.id, workItems.statusId))
      .where(and(eq(workItems.workspaceId, workspaceId), isNull(workItems.deletedAt)));
    return {
      activeProjects: projRow?.c ?? 0,
      activeSprints: iterRow?.c ?? 0,
      openWorkItems: wiRow?.open ?? 0,
      blockedItems: wiRow?.blocked ?? 0,
      openDefects: wiRow?.defects ?? 0,
      assignedToMe: wiRow?.mine ?? 0,
    };
  }

  async create(input: CreateWorkItemInput, executor?: DbExecutor): Promise<WorkItem> {
    const exec = executor ?? this.db;

    // P3: Route task-type items to the dedicated `tasks` table.
    if (input.type === 'task') {
      const rows = await exec
        .insert(tasks)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          parentId: input.parentId!,
          itemKey: input.itemKey,
          title: input.title,
          description: input.description,
          state: SCHEDULE_STATE_TO_TASK_STATE[input.scheduleState ?? 'defined'],
          assigneeId: input.assigneeId,
          teamId: input.teamId,
          iterationId: input.iterationId,
          estimateHours: input.estimateHours,
          todoHours: input.todoHours,
          actualHours: input.actualHours,
          rank: input.rank,
          createdBy: input.createdBy,
        })
        .returning();
      const t = rows[0];
      // Return a WorkItem-shaped object for service compatibility.
      return {
        id: t.id,
        workspaceId: t.workspaceId,
        projectId: t.projectId,
        itemKey: t.itemKey,
        type: 'task',
        title: t.title,
        description: t.description,
        statusId: '',
        scheduleState:
          t.state === 'in_progress'
            ? 'in_progress'
            : t.state === 'completed'
              ? 'completed'
              : 'defined',
        // Tasks have a single state; Flow State mirrors it for shape compatibility.
        flowState:
          t.state === 'in_progress'
            ? 'in_progress'
            : t.state === 'completed'
              ? 'completed'
              : 'defined',
        priority: 'normal',
        assigneeId: t.assigneeId,
        reporterId: null,
        parentId: t.parentId,
        teamId: t.teamId,
        iterationId: t.iterationId,
        releaseId: null,
        storyPoints: null,
        estimateHours: t.estimateHours,
        todoHours: t.todoHours,
        actualHours: t.actualHours,
        acceptanceCriteria: null,
        notes: null,
        releaseNotes: null,
        isBlocked: false,
        blockedReason: null,
        rank: t.rank,
        customFields: {},
        createdBy: t.createdBy,
        updatedBy: t.updatedBy,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        deletedAt: t.deletedAt,
        severity: null,
        foundInEnvironment: null,
        foundInReleaseId: null,
        rootCause: null,
        resolution: null,
        devOwnerId: null,
        defectState: null,
        fixedInBuild: null,
      };
    }

    const rows = await exec
      .insert(workItems)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        itemKey: input.itemKey,
        type: input.type,
        title: input.title,
        description: input.description,
        statusId: input.statusId,
        scheduleState: input.scheduleState ?? 'defined',
        // BR-WI-01 — Flow State mirrors Schedule State on create.
        flowState: input.flowState ?? input.scheduleState ?? 'defined',
        priority: input.priority,
        assigneeId: input.assigneeId,
        reporterId: input.reporterId,
        parentId: input.parentId,
        teamId: input.teamId,
        iterationId: input.iterationId,
        releaseId: input.releaseId,
        storyPoints: input.storyPoints,
        estimateHours: input.estimateHours,
        todoHours: input.todoHours,
        actualHours: input.actualHours,
        acceptanceCriteria: input.acceptanceCriteria,
        notes: input.notes,
        releaseNotes: input.releaseNotes,
        rank: input.rank,
        createdBy: input.createdBy,
        // P3.4 — Defect-specific fields
        severity: input.severity as DefectSeverity | null,
        foundInEnvironment: input.foundInEnvironment as DefectEnvironment | null,
        foundInReleaseId: input.foundInReleaseId,
        rootCause: input.rootCause as DefectRootCause | null,
        resolution: input.resolution as DefectResolution | null,
        devOwnerId: input.devOwnerId,
        defectState: input.defectState as DefectState | null,
        fixedInBuild: input.fixedInBuild,
      })
      .returning();
    return rows[0] as WorkItem;
  }

  async update(
    id: string,
    input: UpdateWorkItemInput,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<WorkItem> {
    const exec = executor ?? this.db;

    // P3: If this is a task (exists in tasks table), update there instead.
    const taskCheck = await exec
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
      .limit(1);

    if (taskCheck.length > 0) {
      const setFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) setFields.title = input.title;
      if (input.description !== undefined) setFields.description = input.description;
      // TASK-FR-012: Work Product (parent) reassignment. tasks.parent_id is NOT
      // NULL, so only a concrete new parent is written; the service rejects null.
      if (input.parentId !== undefined && input.parentId !== null)
        setFields.parentId = input.parentId;
      // BR-WI-01 mirror: a task's single state is driven by whichever of
      // scheduleState / flowState the caller sent (they always agree).
      const taskMirroredState = input.scheduleState ?? input.flowState;
      if (taskMirroredState !== undefined)
        setFields.state = SCHEDULE_STATE_TO_TASK_STATE[taskMirroredState];
      if (input.assigneeId !== undefined) setFields.assigneeId = input.assigneeId;
      if (input.teamId !== undefined) setFields.teamId = input.teamId;
      if (input.iterationId !== undefined) setFields.iterationId = input.iterationId;
      if (input.estimateHours !== undefined) setFields.estimateHours = input.estimateHours;
      if (input.todoHours !== undefined) setFields.todoHours = input.todoHours;
      if (input.actualHours !== undefined) setFields.actualHours = input.actualHours;
      if (input.rank !== undefined) setFields.rank = input.rank;
      if (input.updatedBy !== undefined) setFields.updatedBy = input.updatedBy;

      await exec
        .update(tasks)
        .set(setFields)
        .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId)));

      // Re-fetch and return as WorkItem (use exec/tx for transaction consistency)
      return (await this.findById(id, workspaceId, exec))!;
    }

    // BR-WI-01 mirror: any change to either Schedule or Flow State writes BOTH
    // columns, so they can never drift. The service rejects a conflicting pair.
    const mirroredState = input.scheduleState ?? input.flowState;
    const rows = await exec
      .update(workItems)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.statusId !== undefined && { statusId: input.statusId }),
        ...(mirroredState !== undefined && {
          scheduleState: mirroredState,
          flowState: mirroredState,
        }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
        ...(input.reporterId !== undefined && { reporterId: input.reporterId }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        ...(input.teamId !== undefined && { teamId: input.teamId }),
        ...(input.iterationId !== undefined && { iterationId: input.iterationId }),
        ...(input.releaseId !== undefined && { releaseId: input.releaseId }),
        ...(input.storyPoints !== undefined && { storyPoints: input.storyPoints }),
        ...(input.estimateHours !== undefined && { estimateHours: input.estimateHours }),
        ...(input.todoHours !== undefined && { todoHours: input.todoHours }),
        ...(input.actualHours !== undefined && { actualHours: input.actualHours }),
        ...(input.acceptanceCriteria !== undefined && {
          acceptanceCriteria: input.acceptanceCriteria,
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.releaseNotes !== undefined && { releaseNotes: input.releaseNotes }),
        ...(input.isBlocked !== undefined && { isBlocked: input.isBlocked }),
        ...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
        ...(input.rank !== undefined && { rank: input.rank }),
        ...(input.customFields !== undefined && { customFields: input.customFields }),
        ...(input.updatedBy !== undefined && { updatedBy: input.updatedBy }),
        // P3.4 — Defect-specific fields
        ...(input.severity !== undefined && { severity: input.severity as DefectSeverity | null }),
        ...(input.foundInEnvironment !== undefined && {
          foundInEnvironment: input.foundInEnvironment as DefectEnvironment | null,
        }),
        ...(input.foundInReleaseId !== undefined && { foundInReleaseId: input.foundInReleaseId }),
        ...(input.rootCause !== undefined && {
          rootCause: input.rootCause as DefectRootCause | null,
        }),
        ...(input.resolution !== undefined && {
          resolution: input.resolution as DefectResolution | null,
        }),
        ...(input.devOwnerId !== undefined && { devOwnerId: input.devOwnerId }),
        ...(input.defectState !== undefined && {
          defectState: input.defectState as DefectState | null,
        }),
        ...(input.fixedInBuild !== undefined && { fixedInBuild: input.fixedInBuild }),
        updatedAt: new Date(),
      })
      .where(and(eq(workItems.id, id), eq(workItems.workspaceId, workspaceId)))
      .returning();
    return rows[0] as WorkItem;
  }

  async softDelete(id: string, workspaceId: string, executor?: DbExecutor): Promise<void> {
    const exec = executor ?? this.db;
    // P3: Check tasks table first
    const taskCheck = await exec
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId)))
      .limit(1);
    if (taskCheck.length > 0) {
      await exec
        .update(tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId)));
      return;
    }
    await exec
      .update(workItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(workItems.id, id), eq(workItems.workspaceId, workspaceId)));
  }

  async reorderItems(
    items: Array<{ id: string; rank: string }>,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<void> {
    if (items.length === 0) return;
    const exec = executor ?? this.db;
    // Single transaction — caller (service) wraps this in uow.run() for
    // atomicity + RLS activation. The workspace_id guard here is belt-and-
    // suspenders: even if called outside UoW it cannot write across workspaces.
    await Promise.all(
      items.map(({ id, rank }) =>
        exec
          .update(workItems)
          .set({ rank, updatedAt: new Date() })
          .where(and(eq(workItems.id, id), eq(workItems.workspaceId, workspaceId))),
      ),
    );
  }

  async addLabel(workItemId: string, labelId: string, _workspaceId: string): Promise<void> {
    await this.db.insert(workItemLabels).values({ workItemId, labelId }).onConflictDoNothing();
  }

  async removeLabel(workItemId: string, labelId: string, _workspaceId: string): Promise<void> {
    await this.db
      .delete(workItemLabels)
      .where(and(eq(workItemLabels.workItemId, workItemId), eq(workItemLabels.labelId, labelId)));
  }

  async listLabels(
    workItemId: string,
  ): Promise<Array<{ id: string; name: string; color: string }>> {
    const rows = await this.db
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(workItemLabels)
      .innerJoin(labels, eq(workItemLabels.labelId, labels.id))
      .where(eq(workItemLabels.workItemId, workItemId))
      .orderBy(labels.name);
    return rows;
  }

  async listMilestones(workItemId: string): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.db
      .select({ id: milestones.id, name: milestones.name })
      .from(milestoneArtifacts)
      .innerJoin(milestones, eq(milestoneArtifacts.milestoneId, milestones.id))
      .where(eq(milestoneArtifacts.workItemId, workItemId))
      .orderBy(milestones.name);
    return rows;
  }

  async setMilestones(workItemId: string, milestoneIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(milestoneArtifacts).where(eq(milestoneArtifacts.workItemId, workItemId));
      if (milestoneIds.length > 0) {
        await tx
          .insert(milestoneArtifacts)
          .values(milestoneIds.map((milestoneId) => ({ milestoneId, workItemId })));
      }
    });
  }

  async countMilestonesInProject(milestoneIds: string[], projectId: string): Promise<number> {
    if (milestoneIds.length === 0) return 0;
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(milestones)
      .where(and(inArray(milestones.id, milestoneIds), eq(milestones.projectId, projectId)));
    return Number(rows[0]?.count ?? 0);
  }
}
