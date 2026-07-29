import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { InjectDrizzle, buildPageResult, keysetCondition } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import {
  portfolioItems,
  workItems,
  releases,
  teams,
  projects,
} from '../../../../../../db/schema/work';
import { users } from '../../../../../../db/schema/identity';
import {
  acceptedScheduleStatesSql,
  completedScheduleStatesSql,
} from '../../../../../../db/schema/enums';
import type {
  PortfolioItem,
  PortfolioItemView,
  PortfolioListFilter,
  PortfolioRollupRow,
} from '../../domain/portfolio-item.types';
import type {
  IPortfolioItemRepository,
  PortfolioChildItem,
} from '../../domain/ports/portfolio-item.repository';

@Injectable()
export class PortfolioItemDrizzleRepository implements IPortfolioItemRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  /**
   * Child rollups for a set of portfolio items, as correlated subqueries.
   *
   * ONE query for the whole page. A 50-row list showing four progress indicators each
   * would otherwise be 200 round trips; the aggregate has to travel with the row.
   *
   * An EPIC aggregates through its child Features — a story is never linked to an Epic
   * directly (only the lowest portfolio level attaches to the story hierarchy, in both
   * Rally and the BA spec), so the subquery matches any work item whose feature_id is
   * one of this Epic's active Features.
   *
   * TWO "done" definitions, and both are used here on purpose:
   *   accepted*  → ACCEPTED_SCHEDULE_STATES  (accepted, release)   — Percent Done
   *   completed* → COMPLETED_SCHEDULE_STATES (completed, accepted, release) — capacity
   * `db/schema/enums.ts` documents this as the D1 distinction. Collapsing them would
   * silently change both numbers.
   */
  private rollupSubqueries() {
    // Matches the linked leaf items for either type in one predicate, so Feature and
    // Epic rows can share a single select list.
    const linked = sql`(
      ${workItems.featureId} = ${portfolioItems.id}
      or ${workItems.featureId} in (
        select c.id from ${portfolioItems} c
        where c.parent_id = ${portfolioItems.id} and c.archived_at is null
      )
    )`;

    const scoped = (metric: SQL) => sql<number>`(
      select coalesce(${metric}, 0)
      from ${workItems}
      where ${linked} and ${workItems.deletedAt} is null
    )`;

    return {
      rollupPoints: scoped(sql`sum(${workItems.storyPoints})`),
      rollupCount: scoped(sql`count(*)`),
      acceptedPoints: scoped(
        sql`sum(${workItems.storyPoints}) filter (where ${workItems.scheduleState} in (${acceptedScheduleStatesSql()}))`,
      ),
      acceptedCount: scoped(
        sql`count(*) filter (where ${workItems.scheduleState} in (${acceptedScheduleStatesSql()}))`,
      ),
      completedPoints: scoped(
        sql`sum(${workItems.storyPoints}) filter (where ${workItems.scheduleState} in (${completedScheduleStatesSql()}))`,
      ),
      completedCount: scoped(
        sql`count(*) filter (where ${workItems.scheduleState} in (${completedScheduleStatesSql()}))`,
      ),
    };
  }

  /** Active child Features of an Epic. 0 for a Feature — the hierarchy is two levels. */
  private childFeatureCountSql() {
    return sql<number>`(
      select count(*)::int from ${portfolioItems} c
      where c.parent_id = ${portfolioItems.id} and c.archived_at is null
    )`;
  }

  async findById(id: string, workspaceId: string): Promise<PortfolioItem | null> {
    const rows = await this.db
      .select()
      .from(portfolioItems)
      .where(and(eq(portfolioItems.id, id), eq(portfolioItems.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async findViewById(id: string, workspaceId: string): Promise<PortfolioItemView | null> {
    const page = await this.selectViews(
      and(eq(portfolioItems.id, id), eq(portfolioItems.workspaceId, workspaceId)),
      { limit: 1, cursor: null },
    );
    return page[0] ?? null;
  }

  async listByFilter(
    workspaceId: string,
    filter: PortfolioListFilter,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<PortfolioItemView>> {
    const conditions: SQL[] = [
      eq(portfolioItems.workspaceId, workspaceId),
      eq(portfolioItems.type, filter.type),
    ];

    if (!filter.includeArchived) conditions.push(isNull(portfolioItems.archivedAt));
    if (filter.projectId) conditions.push(eq(portfolioItems.projectId, filter.projectId));
    // The authorization filter. `null` means a workspace-wide grant, so no restriction;
    // otherwise the caller sees only projects they may read. An empty list is handled by
    // the service before it gets here (it short-circuits to an empty page), so an empty
    // `inArray` — which Postgres would treat as always-false anyway — cannot arise.
    if (filter.readableProjectIds !== null) {
      conditions.push(inArray(portfolioItems.projectId, filter.readableProjectIds));
    }
    // Epic has no Team, so a team filter can only ever match Features. The service
    // returns the spec's explicit empty message rather than an empty grid.
    if (filter.teamId) conditions.push(eq(portfolioItems.teamId, filter.teamId));
    if (filter.search) {
      const like = `%${filter.search}%`;
      conditions.push(
        or(ilike(portfolioItems.name, like), ilike(portfolioItems.itemKey, like)) as SQL,
      );
    }
    // Snapshot the filters BEFORE the cursor is applied. The count must describe the
    // whole result set, not the remainder after the current page — otherwise the grid's
    // "of N" shrinks as the reader pages forward. Same split as the work-item list.
    const baseConditions = [...conditions];

    // Rank + id, matching the Backlog convention: `id` is the tiebreaker that makes
    // the order TOTAL. Without it, rows sharing a rank come back in physical-tuple
    // order, which changes whenever one of them is updated — and a keyset cursor over
    // an unstable order silently skips or repeats rows.
    if (args.cursor) {
      conditions.push(keysetCondition(portfolioItems.rank, portfolioItems.id, args.cursor));
    }

    const items = await this.selectViews(and(...conditions), args);

    // No joins: every filter above constrains `portfolio_items` alone, and the view's
    // joins are all LEFT, so they cannot change the row count. Counting the bare table
    // keeps this cheap enough to run on every page.
    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(portfolioItems)
      .where(and(...baseConditions));

    return buildPageResult(items, args.limit, (i) => [i.rank], 'asc', Number(countRow?.total ?? 0));
  }

  async rollupsFor(ids: string[], workspaceId: string): Promise<PortfolioRollupRow[]> {
    if (ids.length === 0) return [];
    const r = this.rollupSubqueries();
    const rows = await this.db
      .select({ portfolioItemId: portfolioItems.id, ...r })
      .from(portfolioItems)
      .where(and(inArray(portfolioItems.id, ids), eq(portfolioItems.workspaceId, workspaceId)));
    return rows.map((x) => this.mapRollup(x));
  }

  async listChildFeatures(epicId: string, workspaceId: string): Promise<PortfolioItemView[]> {
    return this.selectViews(
      and(
        eq(portfolioItems.parentId, epicId),
        eq(portfolioItems.workspaceId, workspaceId),
        isNull(portfolioItems.archivedAt),
      ),
      { limit: 200, cursor: null },
    );
  }

  async listChildren(
    featureId: string,
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null; search?: string },
  ): Promise<PagedResult<PortfolioChildItem>> {
    const owner = alias(users, 'wi_owner');
    const conditions: SQL[] = [
      eq(workItems.featureId, featureId),
      eq(workItems.workspaceId, workspaceId),
      isNull(workItems.deletedAt),
    ];
    if (args.search) {
      const like = `%${args.search}%`;
      conditions.push(or(ilike(workItems.title, like), ilike(workItems.itemKey, like)) as SQL);
    }
    if (args.cursor) {
      conditions.push(keysetCondition(workItems.rank, workItems.id, args.cursor));
    }

    const rows = await this.db
      .select({
        id: workItems.id,
        itemKey: workItems.itemKey,
        type: workItems.type,
        title: workItems.title,
        scheduleState: workItems.scheduleState,
        storyPoints: workItems.storyPoints,
        rank: workItems.rank,
        releaseName: releases.name,
        projectName: projects.name,
        teamName: teams.name,
        ownerName: owner.displayName,
      })
      .from(workItems)
      .leftJoin(releases, eq(releases.id, workItems.releaseId))
      .leftJoin(projects, eq(projects.id, workItems.projectId))
      .leftJoin(teams, eq(teams.id, workItems.teamId))
      .leftJoin(owner, eq(owner.id, workItems.assigneeId))
      .where(and(...conditions))
      .orderBy(asc(workItems.rank), asc(workItems.id))
      .limit(args.limit + 1);

    const items = rows.map((r) => ({
      id: r.id,
      itemKey: r.itemKey,
      // A Task is never linked to a Feature directly, so only story/defect reach here.
      type: r.type as 'story' | 'defect',
      title: r.title,
      scheduleState: r.scheduleState,
      storyPoints: r.storyPoints,
      releaseName: r.releaseName,
      projectName: r.projectName,
      teamName: r.teamName,
      ownerName: r.ownerName,
      rank: r.rank,
    }));

    return buildPageResult(items, args.limit, (i) => [i.rank]);
  }

  /** The one select every read surface shares, so the shapes cannot drift. */
  private async selectViews(
    where: SQL | undefined,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PortfolioItemView[]> {
    const owner = alias(users, 'pi_owner');
    const parent = alias(portfolioItems, 'pi_parent');
    const r = this.rollupSubqueries();

    const rows = await this.db
      .select({
        item: portfolioItems,
        ownerName: owner.displayName,
        teamName: teams.name,
        releaseName: releases.name,
        projectName: projects.name,
        parentKey: parent.itemKey,
        childFeatureCount: this.childFeatureCountSql(),
        ...r,
      })
      .from(portfolioItems)
      .leftJoin(owner, eq(owner.id, portfolioItems.ownerId))
      .leftJoin(teams, eq(teams.id, portfolioItems.teamId))
      .leftJoin(releases, eq(releases.id, portfolioItems.releaseId))
      .leftJoin(projects, eq(projects.id, portfolioItems.projectId))
      .leftJoin(parent, eq(parent.id, portfolioItems.parentId))
      .where(where)
      .orderBy(asc(portfolioItems.rank), asc(portfolioItems.id))
      .limit(args.limit + 1);

    return rows.map((row) => ({
      ...this.mapRow(row.item),
      ownerName: row.ownerName,
      teamName: row.teamName,
      releaseName: row.releaseName,
      projectName: row.projectName,
      parentKey: row.parentKey,
      childFeatureCount: Number(row.childFeatureCount ?? 0),
      rollup: this.mapRollup({ portfolioItemId: row.item.id, ...row }),
    }));
  }

  private mapRow(row: typeof portfolioItems.$inferSelect): PortfolioItem {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      itemKey: row.itemKey,
      type: row.type,
      name: row.name,
      description: row.description,
      state: row.state,
      preliminaryEstimate: row.preliminaryEstimate,
      refinedEstimate: row.refinedEstimate,
      refinedItemCountEstimate: row.refinedItemCountEstimate,
      parentId: row.parentId,
      teamId: row.teamId,
      releaseId: row.releaseId,
      ownerId: row.ownerId,
      plannedStartDate: row.plannedStartDate,
      plannedEndDate: row.plannedEndDate,
      marketReleaseDate: row.marketReleaseDate,
      rank: row.rank,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Postgres returns numeric aggregates as strings; the domain wants numbers. */
  private mapRollup(row: {
    portfolioItemId: string;
    rollupPoints: unknown;
    rollupCount: unknown;
    acceptedPoints: unknown;
    acceptedCount: unknown;
    completedPoints: unknown;
    completedCount: unknown;
  }): PortfolioRollupRow {
    return {
      portfolioItemId: row.portfolioItemId,
      rollupPoints: Number(row.rollupPoints ?? 0),
      rollupCount: Number(row.rollupCount ?? 0),
      acceptedPoints: Number(row.acceptedPoints ?? 0),
      acceptedCount: Number(row.acceptedCount ?? 0),
      completedPoints: Number(row.completedPoints ?? 0),
      completedCount: Number(row.completedCount ?? 0),
    };
  }
}
