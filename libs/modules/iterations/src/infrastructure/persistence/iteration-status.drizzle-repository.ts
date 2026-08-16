import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { InjectDrizzle, buildPageResult, keysetCondition } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import {
  workItems,
  tasks,
  milestones,
  milestoneArtifacts,
  portfolioItems,
} from '../../../../../../db/schema/work';
import { acceptedScheduleStatesSql } from '../../../../../../db/schema/enums';
import { UNASSIGNED_FILTER } from '@modules/work-items';
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

    // Task rollups via correlated subqueries over the dedicated `tasks` table.
    //
    // Declared BEFORE the filter block because the Manage Filters "Task Est" and
    // "To Do" predicates reuse the very same expressions in the WHERE clause —
    // one definition, so a filter can never test a different number than the
    // column displays (the property whose absence produced the zero-point
    // Velocity bars; see CLAUDE.md "Eligibility must be counted in the SAME
    // scope as the measurement").
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

    if (filters.type) conditions.push(eq(workItems.type, filters.type));
    if (filters.scheduleState) conditions.push(eq(workItems.scheduleState, filters.scheduleState));
    if (filters.isBlocked !== undefined)
      conditions.push(eq(workItems.isBlocked, filters.isBlocked));
    if (filters.assigneeId) {
      // `unassigned` is a sentinel, not a user id: SQL equality never matches
      // NULL, so an "Unassigned" option built as `assignee_id = 'unassigned'`
      // would return nothing. Same rule as the Backlog Owner filter.
      conditions.push(
        filters.assigneeId === UNASSIGNED_FILTER
          ? isNull(workItems.assigneeId)
          : eq(workItems.assigneeId, filters.assigneeId),
      );
    }
    if (filters.q) {
      const term = filters.q.trim();
      if (term) {
        conditions.push(
          or(ilike(workItems.itemKey, `%${term}%`), ilike(workItems.title, `%${term}%`))!,
        );
      }
    }
    // ── Manage Filters column predicates (P2-IS-FR-022/023/024) ───────────────
    // Whitelisted columns, bound parameters — never interpolated SQL.
    if (filters.itemKey?.trim()) {
      conditions.push(ilike(workItems.itemKey, `%${filters.itemKey.trim()}%`));
    }
    if (filters.title?.trim()) {
      conditions.push(ilike(workItems.title, `%${filters.title.trim()}%`));
    }
    if (filters.planEstimate !== undefined) {
      conditions.push(eq(workItems.storyPoints, filters.planEstimate));
    }
    if (filters.taskEstimate !== undefined) {
      conditions.push(sql`${taskEstimate} = ${filters.taskEstimate}::numeric`);
    }
    if (filters.toDo !== undefined) {
      conditions.push(sql`${toDo} = ${filters.toDo}::numeric`);
    }
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

    // The Feature this row belongs to — Rally's "Feature" column.
    //
    // Read from work_items.feature_id → work.portfolio_items, which is where a
    // Feature actually lives (P5.1). This previously walked parent_id looking for a
    // work_items row of type 'feature': a Feature was a work item, found one or two
    // levels up (story→feature, defect→story→feature).
    //
    // That model is gone. In both Rally and the BA spec a Feature is a PORTFOLIO
    // ITEM, not a schedulable artifact — Rally keeps PortfolioItem and
    // HierarchicalRequirement as separate object families joined by a field, and only
    // the lowest portfolio level attaches to the story hierarchy. Keeping the old
    // walk would have meant two tables both minting `FE-` keys and both meaning
    // Feature, so `feature` has been removed from work_item_type.
    //
    // A defect no longer inherits its parent story's Feature implicitly: it carries
    // its own feature_id. Simpler, and it matches Rally, where the association is an
    // explicit field on each artifact rather than something inferred from ancestry.
    const featureItem = alias(portfolioItems, 'pi_feature');
    const featureId = featureItem.id;
    const featureKey = featureItem.itemKey;
    const featureTitle = featureItem.name;

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
      where ma.entity_type = 'work_item' and ma.entity_id = ${workItems.id}
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
        // The ITEM's own team. Deliberately not `coalesce(work_items.team_id, iterations.team_id)`:
        // that two-tier rule is for measuring HOURS in a scope (`getScopedTaskHours`, Team Status),
        // whereas SRS:435 judges Owner against the Work Item Team alone — and the iteration's team is
        // NULL on most iterations (a shared sprint), so a coalesce would either invent a team the item
        // does not carry or, read the other way, collapse every picker on this screen to `Unassigned`.
        teamId: workItems.teamId,
        rank: workItems.rank,
        taskEstimate,
        toDo,
        actual,
        taskTotal,
        taskDone,
        featureId,
        featureKey,
        featureTitle,
        defectCount,
        openDefectCount,
        milestoneList,
      })
      .from(workItems)
      // Not archived: an archived Feature must stop labelling live work rather than
      // keep showing a key nobody can open.
      .leftJoin(
        featureItem,
        and(eq(featureItem.id, workItems.featureId), isNull(featureItem.archivedAt)),
      )
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
      teamId: r.teamId,
      rank: r.rank,
      featureId: r.featureId,
      featureKey: r.featureKey,
      featureTitle: r.featureTitle,
      defectCount: Number(r.defectCount ?? 0),
      openDefectCount: Number(r.openDefectCount ?? 0),
      milestones: r.milestoneList ?? [],
    }));

    return buildPageResult(items, limit, (i) => [i.rank]);
  }
}
