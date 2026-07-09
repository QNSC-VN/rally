import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import { workItems } from '../../../../../../db/schema/work';
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
    // nullable integer; sums coalesce to 0. 'accepted' uses the schedule_state
    // maturity dimension per SRS §8.
    const rows = await this.db
      .select({
        totalPlanEstimate: sql<number>`coalesce(sum(${workItems.storyPoints}), 0)::int`,
        acceptedPoints: sql<number>`coalesce(sum(${workItems.storyPoints}) filter (where ${workItems.scheduleState} = 'accepted'), 0)::int`,
        defectCount: sql<number>`(count(*) filter (where ${workItems.type} = 'defect'))::int`,
        taskCount: sql<number>`(count(*) filter (where ${workItems.type} = 'task'))::int`,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.iterationId, iterationId),
          eq(workItems.workspaceId, workspaceId),
          isNull(workItems.deletedAt),
        ),
      );

    const r = rows[0];
    return {
      totalPlanEstimate: Number(r?.totalPlanEstimate ?? 0),
      acceptedPoints: Number(r?.acceptedPoints ?? 0),
      defectCount: Number(r?.defectCount ?? 0),
      taskCount: Number(r?.taskCount ?? 0),
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
    if (filters.isBlocked !== undefined) conditions.push(eq(workItems.isBlocked, filters.isBlocked));
    if (filters.assigneeId) conditions.push(eq(workItems.assigneeId, filters.assigneeId));
    if (filters.q) {
      const term = filters.q.trim();
      if (term) {
        conditions.push(
          or(ilike(workItems.itemKey, `%${term}%`), ilike(workItems.title, `%${term}%`))!,
        );
      }
    }

    // Task rollups via correlated subqueries over child tasks (parent_id = row id).
    const taskEstimate = sql<string>`(
      select coalesce(sum(t.estimate_hours), 0)
      from ${workItems} t
      where t.parent_id = ${workItems.id}
        and t.type = 'task'
        and t.deleted_at is null
    )`;
    const toDo = sql<string>`(
      select coalesce(sum(t.todo_hours), 0)
      from ${workItems} t
      where t.parent_id = ${workItems.id}
        and t.type = 'task'
        and t.deleted_at is null
    )`;

    const sortCol = {
      rank: workItems.rank,
      itemKey: workItems.itemKey,
      type: workItems.type,
      title: workItems.title,
      scheduleState: workItems.scheduleState,
      planEstimate: workItems.storyPoints,
      taskEstimate: workItems.rank, // rollups are computed; fall back to rank for stability
      toDo: workItems.rank,
    }[filters.sortBy ?? 'rank'];
    const dir = filters.sortDirection === 'desc' ? desc : asc;

    // Keyset pagination on rank (stable, matches default backlog ordering).
    if (cursor) {
      conditions.push(lt(workItems.rank, cursor.k[0] as string));
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
        planEstimate: workItems.storyPoints,
        assigneeId: workItems.assigneeId,
        rank: workItems.rank,
        taskEstimate,
        toDo,
      })
      .from(workItems)
      .where(and(...conditions))
      .orderBy(filters.sortBy ? dir(sortCol) : asc(workItems.rank))
      .limit(limit + 1);

    const items: IterationStatusItem[] = rows.map((r) => ({
      id: r.id,
      itemKey: r.itemKey,
      type: r.type,
      title: r.title,
      scheduleState: r.scheduleState,
      iterationId: r.iterationId,
      isBlocked: r.isBlocked,
      planEstimate: r.planEstimate,
      taskEstimate: Number(r.taskEstimate ?? 0),
      toDo: Number(r.toDo ?? 0),
      assigneeId: r.assigneeId,
      rank: r.rank,
    }));

    return buildPageResult(items, limit, (i) => [i.rank]);
  }
}
