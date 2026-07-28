import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { InjectDrizzle, buildPageResult, keysetCondition } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import { workItems, tasks, milestones, milestoneArtifacts } from '../../../../../../db/schema/work';
import { acceptedScheduleStatesSql } from '../../../../../../db/schema/enums';
import type {
  IterationStatusItem,
  IterationStatusFilters,
} from '../../domain/iteration-status.types';
import {
  IIterationStatusRepository,
  type RawIterationMetrics,
} from '../../domain/ports/iteration-status.repository';

@Injectable()
export class IterationStatusDrizzleRepository implements IIterationStatusRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async getMetrics(iterationId: string, workspaceId: string): Promise<RawIterationMetrics> {
    // Single pass over the iteration's non-deleted items. story_points is a
    // nullable numeric (fractional points); sums coalesce to 0. "Accepted" is
    // the canonical ACCEPTED_SCHEDULE_STATES set (accepted OR release) — a story
    // stays accepted once it advances to the terminal 'release' state — so this
    // shares the exact same definition as every other roll-up (SRS §8).
    const rows = await this.db
      .select({
        totalPlanEstimate: sql<number>`coalesce(sum(${workItems.storyPoints}), 0)::numeric`,
        acceptedPoints: sql<number>`coalesce(sum(${workItems.storyPoints}) filter (where ${workItems.scheduleState} in (${acceptedScheduleStatesSql()})), 0)::numeric`,
        defectCount: sql<number>`(count(*) filter (where ${workItems.type} = 'defect'))::int`,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.iterationId, iterationId),
          eq(workItems.workspaceId, workspaceId),
          isNull(workItems.deletedAt),
        ),
      );

    // Task metrics are STATE-based (SRS/BA 2026-07-20): the "active" count is
    // every child task NOT in the Completed task-state — the SAME definition the
    // Team Status screen uses — so the two screens always agree. A separate
    // aggregate over `tasks` joined to the iteration's items (a correlated
    // subquery cannot live beside the ungrouped work-item aggregate above).
    const parent = alias(workItems, 'wi_task_parent');
    const [taskAgg] = await this.db
      .select({
        taskCount: sql<number>`count(*)::int`,
        activeTaskCount: sql<number>`(count(*) filter (where ${tasks.state} <> 'completed'))::int`,
      })
      .from(tasks)
      .innerJoin(parent, eq(parent.id, tasks.parentId))
      .where(
        and(
          eq(parent.iterationId, iterationId),
          eq(parent.workspaceId, workspaceId),
          isNull(parent.deletedAt),
          isNull(tasks.deletedAt),
        ),
      );

    const r = rows[0];
    return {
      totalPlanEstimate: Number(r?.totalPlanEstimate ?? 0),
      acceptedPoints: Number(r?.acceptedPoints ?? 0),
      defectCount: Number(r?.defectCount ?? 0),
      taskCount: Number(taskAgg?.taskCount ?? 0),
      activeTaskCount: Number(taskAgg?.activeTaskCount ?? 0),
    };
  }

  async listItems(
    iterationId: string,
    workspaceId: string,
    filters: IterationStatusFilters,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<IterationStatusItem>> {
    // The list shows the backlog-shaped items (story/defect) assigned to the
    // iteration. Tasks roll up into their parent's Task Est / To Do columns.
    const conditions: SQL[] = [
      eq(workItems.iterationId, iterationId),
      eq(workItems.workspaceId, workspaceId),
      isNull(workItems.deletedAt),
      inArray(workItems.type, ['story', 'defect']),
    ];

    if (filters.type) conditions.push(eq(workItems.type, filters.type));
    if (filters.scheduleState) conditions.push(eq(workItems.scheduleState, filters.scheduleState));
    if (filters.isBlocked !== undefined)
      conditions.push(eq(workItems.isBlocked, filters.isBlocked));
    if (filters.assigneeId) conditions.push(eq(workItems.assigneeId, filters.assigneeId));
    if (filters.q) {
      const term = filters.q.trim();
      if (term) {
        conditions.push(
          or(ilike(workItems.itemKey, `%${term}%`), ilike(workItems.title, `%${term}%`))!,
        );
      }
    }

    // Task rollups via correlated subqueries over the dedicated `tasks` table.
    const taskEstimate = sql<string>`(
      select coalesce(sum(t.estimate_hours), 0)
      from ${tasks} t
      where t.parent_id = ${workItems.id}
        and t.deleted_at is null
    )`;
    const toDo = sql<string>`(
      select coalesce(sum(t.todo_hours), 0)
      from ${tasks} t
      where t.parent_id = ${workItems.id}
        and t.deleted_at is null
    )`;
    // Actual = roll-up of child task actual_hours (parity with To Do / Task Est,
    // which also sum from the child tasks). Actual is a manual per-task input.
    const actual = sql<string>`(
      select coalesce(sum(t.actual_hours), 0)
      from ${tasks} t
      where t.parent_id = ${workItems.id}
        and t.deleted_at is null
    )`;

    // State-based task rollup (SRS/BA 2026-07-20): Task % = done/total tasks,
    // where "done" is the Completed task-state — NOT derived from To Do hours —
    // so the Iteration Status "Tasks" column matches the Team Status screen.
    const taskTotal = sql<number>`(
      select count(*)::int
      from ${tasks} t
      where t.parent_id = ${workItems.id}
        and t.deleted_at is null
    )`;
    const taskDone = sql<number>`(
      select count(*)::int
      from ${tasks} t
      where t.parent_id = ${workItems.id}
        and t.deleted_at is null
        and t.state = 'completed'
    )`;

    // Nearest ancestor Feature (story→feature, defect→story→feature) — Rally "Feature" column.
    const parentItem = alias(workItems, 'wi_parent');
    const grandparentItem = alias(workItems, 'wi_grandparent');
    const featureKey = sql<string | null>`case
      when ${parentItem.type} = 'feature' then ${parentItem.itemKey}
      when ${grandparentItem.type} = 'feature' then ${grandparentItem.itemKey}
      else null end`;
    const featureTitle = sql<string | null>`case
      when ${parentItem.type} = 'feature' then ${parentItem.title}
      when ${grandparentItem.type} = 'feature' then ${grandparentItem.title}
      else null end`;

    // Child-defect rollup — Rally "Defects" (count) + "Defect Status" (open summary).
    const defectCount = sql<number>`(
      select count(*)::int from ${workItems} d
      where d.parent_id = ${workItems.id} and d.type = 'defect' and d.deleted_at is null
    )`;
    const openDefectCount = sql<number>`(
      select count(*)::int from ${workItems} d
      where d.parent_id = ${workItems.id} and d.type = 'defect' and d.deleted_at is null
        and d.schedule_state not in (${acceptedScheduleStatesSql()})
    )`;

    // Milestones directly assigned to the work item — Rally "Milestones" column.
    // Returns {id,name} objects so the grid can render names AND edit by id.
    const milestoneList = sql<Array<{ id: string; name: string }>>`coalesce((
      select json_agg(json_build_object('id', m.id, 'name', m.name) order by m.name)
      from ${milestoneArtifacts} ma
      join ${milestones} m on m.id = ma.milestone_id
      where ma.work_item_id = ${workItems.id}
    ), '[]'::json)`;

    // Keyset pagination on (rank, id) — the pair the ORDER BY below uses.
    //
    // `rank` is NOT unique here. It is a LexoRank assigned per SCOPE — the
    // top-level items of a project, or the children of one parent — so it is only
    // unique within a scope. This grid deliberately flattens that: an iteration
    // contains a story and its child defect side by side, and each was ranked
    // first in its own scope, so both legitimately hold the same value.
    //
    // Ordering by a non-unique column leaves tied rows in an order SQL does not
    // define, so Postgres returns whatever the scan yields — and an UPDATE that
    // relocates a tuple to a new page silently changes it. That is what made a
    // work item jump below its neighbour after nothing but a schedule-state edit.
    //
    // The previous predicate was also inverted: `rank < cursor` under ORDER BY
    // rank ASC walks backwards, so page 2 re-served rows from page 1.
    //
    // Both are fixed by using the same helper the backlog already uses
    // (work-item.drizzle-repository.ts), which compares (sort, id) as a pair.
    if (cursor) {
      conditions.push(keysetCondition(workItems.rank, workItems.id, cursor));
    }

    const rows = await this.db
      .select({
        id: workItems.id,
        itemKey: workItems.itemKey,
        type: workItems.type,
        title: workItems.title,
        scheduleState: workItems.scheduleState,
        iterationId: workItems.iterationId,
        isBlocked: workItems.isBlocked,
        blockedReason: workItems.blockedReason,
        planEstimate: sql<number | null>`${workItems.storyPoints}::float8`,
        assigneeId: workItems.assigneeId,
        devOwnerId: workItems.devOwnerId,
        rank: workItems.rank,
        taskEstimate,
        toDo,
        actual,
        taskTotal,
        taskDone,
        featureKey,
        featureTitle,
        defectCount,
        openDefectCount,
        milestoneList,
      })
      .from(workItems)
      .leftJoin(parentItem, eq(parentItem.id, workItems.parentId))
      .leftJoin(grandparentItem, eq(grandparentItem.id, parentItem.parentId))
      .where(and(...conditions))
      // `id` is the tiebreaker that makes this total rather than partial. Without
      // it, rows sharing a rank come back in physical-tuple order, which changes
      // whenever one of them is updated.
      .orderBy(asc(workItems.rank), asc(workItems.id))
      .limit(limit + 1);

    const items: IterationStatusItem[] = rows.map((r) => ({
      id: r.id,
      itemKey: r.itemKey,
      type: r.type,
      title: r.title,
      scheduleState: r.scheduleState,
      iterationId: r.iterationId,
      isBlocked: r.isBlocked,
      blockedReason: r.blockedReason,
      planEstimate: r.planEstimate,
      taskEstimate: Number(r.taskEstimate ?? 0),
      toDo: Number(r.toDo ?? 0),
      actual: Number(r.actual ?? 0),
      taskTotal: Number(r.taskTotal ?? 0),
      taskDone: Number(r.taskDone ?? 0),
      assigneeId: r.assigneeId,
      devOwnerId: r.devOwnerId,
      rank: r.rank,
      featureKey: r.featureKey,
      featureTitle: r.featureTitle,
      defectCount: Number(r.defectCount ?? 0),
      openDefectCount: Number(r.openDefectCount ?? 0),
      milestones: r.milestoneList ?? [],
    }));

    return buildPageResult(items, limit, (i) => [i.rank]);
  }
}
