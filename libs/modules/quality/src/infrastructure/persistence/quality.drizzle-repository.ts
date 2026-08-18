import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import { workItems, iterations, releases } from '../../../../../../db/schema/work';
import {
  isCompletedScheduleState,
  isOpenDefectScheduleState,
} from '../../../../../../db/schema/enums';
import type {
  DefectSeverity,
  DefectEnvironment,
  DefectRootCause,
  DefectResolution,
  DefectState,
  WorkItemPriority,
  WorkItemScheduleState,
} from '../../../../../../db/schema/enums';
import type {
  DefectMetrics,
  DefectRow,
  ListDefectsOptions,
  QualitySortBy,
} from '../../domain/quality.types';
import { IQualityRepository } from '../../domain/ports/quality.repository';
import { scopeIsEmpty, type TeamReadScope } from '../../domain/team-read-scope';

/** What an out-of-scope caller measures: nothing. Never `undefined` — the strip still renders. */
const NO_METRICS: DefectMetrics = {
  openDefects: 0,
  critical: 0,
  inProgress: 0,
  verifiedAccepted: 0,
  reopened: 0,
  blockers: 0,
};

@Injectable()
export class QualityDrizzleRepository implements IQualityRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  /**
   * The team predicate for a defect — a WORK ROW, so `team_id IN (…)` and NO `OR IS NULL`.
   *
   * A defect carrying no team belongs to the PROJECT BACKLOG, which the BA ruling of 2026-08-17 makes
   * readable by a Workspace Admin or Project Admin only, so an absent team EXCLUDES the row. Note this
   * is the opposite of the rule for a timebox (`teamOrSharedTimebox` in the iterations module): a
   * team-less ITERATION is a shared sprint and stays visible. Both predicates read a nullable
   * `team_id`; only the timebox one may treat NULL as "everyone's".
   *
   * Its OWN `team_id`, not `coalesce(…)`: the three-tier resolve exists for a TASK, whose team defaults
   * to its parent's. A defect is a Work Product and carries its own — the same reason
   * `assertTeamInScope` is handed `workItem.teamId` verbatim on the write side.
   *
   * `undefined` for an unrestricted caller, so the condition list is literally unchanged rather than
   * carrying a tautology. The empty scope is short-circuited by the callers, never rendered as
   * `IN ()`.
   */
  private teamScope(scope: TeamReadScope): SQL | undefined {
    if (scope.unrestricted) return undefined;
    return inArray(workItems.teamId, scope.teamIds);
  }

  async listDefects(
    workspaceId: string,
    projectId: string,
    opts: ListDefectsOptions = {},
    // No default, deliberately: an implicit `{ unrestricted: true }` is a fail-open path that a caller
    // can reach by forgetting an argument. `opts` keeps its default because omitting a filter is
    // meaningless, not dangerous.
    scope: TeamReadScope,
  ): Promise<{ rows: DefectRow[]; total: number }> {
    // An editor with no active Team in this project reaches no defect at all. Short-circuited rather
    // than filtered, because `IN ()` is not portable as "match nothing" and flattening `[]` into "no
    // filter" would hand them the whole project.
    if (scopeIsEmpty(scope)) return { rows: [], total: 0 };

    const conditions = [
      eq(workItems.workspaceId, workspaceId),
      eq(workItems.projectId, projectId),
      eq(workItems.type, 'defect'),
      isNull(workItems.deletedAt),
    ];
    // Pushed into the SHARED `conditions` array, so the page, the "of N" count below and every column
    // filter narrow together — the footer total cannot outgrow the rows it counts.
    const team = this.teamScope(scope);
    if (team) conditions.push(team);

    if (opts.severity && opts.severity !== 'all') {
      conditions.push(eq(workItems.severity, opts.severity as DefectSeverity));
    }
    if (opts.environment && opts.environment !== 'all') {
      conditions.push(eq(workItems.foundInEnvironment, opts.environment as DefectEnvironment));
    }
    if (opts.priority && opts.priority !== 'all') {
      conditions.push(eq(workItems.priority, opts.priority as WorkItemPriority));
    }
    if (opts.scheduleState && opts.scheduleState !== 'all') {
      conditions.push(eq(workItems.scheduleState, opts.scheduleState as WorkItemScheduleState));
    }
    if (opts.assigneeId) {
      conditions.push(eq(workItems.assigneeId, opts.assigneeId));
    }
    if (opts.releaseId) {
      conditions.push(eq(workItems.releaseId, opts.releaseId));
    }
    if (opts.rootCause && opts.rootCause !== 'all') {
      conditions.push(eq(workItems.rootCause, opts.rootCause as DefectRootCause));
    }
    if (opts.resolution === 'unresolved') {
      conditions.push(isNull(workItems.resolution));
    } else if (opts.resolution && opts.resolution !== 'all') {
      conditions.push(eq(workItems.resolution, opts.resolution as DefectResolution));
    }
    if (opts.defectState && opts.defectState !== 'all') {
      conditions.push(eq(workItems.defectState, opts.defectState as DefectState));
    }
    if (opts.search) {
      conditions.push(sql`work_items.title ILIKE ${`%${opts.search}%`}`);
    }

    const limit = Math.min(opts.limit ?? 100, 200);
    const offset = opts.offset ?? 0;

    // Sortable columns → SQL expression. Enum columns sort by their semantic
    // Postgres declaration order; joined columns (names/parent) sort by the
    // joined value. Keyed by the FE column id so the two stay in lock-step.
    const sortColumns: Record<QualitySortBy, SQLWrapper> = {
      rank: workItems.rank,
      id: workItems.itemKey,
      name: workItems.title,
      userStory: sql`parent_wi.item_key`,
      severity: workItems.severity,
      priority: workItems.priority,
      state: workItems.defectState,
      scheduleState: workItems.scheduleState,
      fixedInBuild: workItems.fixedInBuild,
      iteration: iterations.name,
      submittedBy: sql`creator_user.display_name`,
      owner: sql`assignee_user.display_name`,
    };
    const dir = opts.sortDirection === 'desc' ? desc : asc;
    // Default (no explicit sort) keeps the natural backlog rank order; an
    // explicit sort leads, with rank as a stable tie-breaker.
    // Both branches end on `id`. Without it the order is only partial: `rank` is
    // unique only within one scope (a project's top-level items, or one parent's
    // children), and this list spans scopes, so ties are normal. Tied defects
    // would then come back in physical-tuple order, reshuffling on any write
    // and — because this list is paged with limit/offset — dropping or repeating
    // rows between pages.
    const orderBy: SQL[] = opts.sortBy
      ? [dir(sortColumns[opts.sortBy]), asc(workItems.rank), asc(workItems.id)]
      : [asc(workItems.rank), asc(workItems.createdAt), asc(workItems.id)];

    const rows = await this.db
      .select({
        id: workItems.id,
        itemKey: workItems.itemKey,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
        severity: workItems.severity,
        foundInEnvironment: workItems.foundInEnvironment,
        rootCause: workItems.rootCause,
        resolution: workItems.resolution,
        foundInReleaseId: workItems.foundInReleaseId,
        assigneeId: workItems.assigneeId,
        teamId: workItems.teamId,
        scheduleState: workItems.scheduleState,
        iterationId: workItems.iterationId,
        releaseId: workItems.releaseId,
        parentId: workItems.parentId,
        isBlocked: workItems.isBlocked,
        rank: workItems.rank,
        defectState: workItems.defectState,
        fixedInBuild: workItems.fixedInBuild,
        createdById: workItems.createdBy,
        createdAt: workItems.createdAt,
        updatedAt: workItems.updatedAt,
        iterationName: iterations.name,
        releaseName: releases.name,
        foundInReleaseName: sql<string>`found_in_release.name`,
        parentKey: sql<string>`parent_wi.item_key`,
        parentTitle: sql<string>`parent_wi.title`,
        assigneeName: sql<string | null>`assignee_user.display_name`,
        createdByName: sql<string | null>`creator_user.display_name`,
      })
      .from(workItems)
      .leftJoin(iterations, eq(workItems.iterationId, iterations.id))
      .leftJoin(releases, eq(workItems.releaseId, releases.id))
      .leftJoin(
        sql`work.releases found_in_release`,
        sql`found_in_release.id = work_items.found_in_release_id`,
      )
      .leftJoin(sql`work.work_items parent_wi`, sql`parent_wi.id = work_items.parent_id`)
      .leftJoin(sql`identity.users assignee_user`, sql`assignee_user.id = work_items.assignee_id`)
      .leftJoin(sql`identity.users creator_user`, sql`creator_user.id = work_items.created_by`)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const data: DefectRow[] = rows.map((r) => ({
      id: r.id,
      itemKey: r.itemKey,
      title: r.title,
      type: r.type,
      priority: r.priority,
      severity: r.severity,
      foundInEnvironment: r.foundInEnvironment,
      rootCause: r.rootCause,
      resolution: r.resolution,
      foundInReleaseId: r.foundInReleaseId,
      foundInReleaseName: r.foundInReleaseName,
      assigneeId: r.assigneeId,
      teamId: r.teamId,
      assigneeName: r.assigneeName,
      scheduleState: r.scheduleState,
      iterationId: r.iterationId,
      iterationName: r.iterationName,
      releaseId: r.releaseId,
      releaseName: r.releaseName,
      parentId: r.parentId,
      parentKey: r.parentKey,
      parentTitle: r.parentTitle,
      isBlocked: r.isBlocked,
      rank: r.rank,
      defectState: r.defectState,
      fixedInBuild: r.fixedInBuild,
      createdById: r.createdById,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    /**
     * Rows matching the filters, ignoring the window — the footer's "of N".
     *
     * Counted with the SAME `conditions` and the SAME parent join, because `userStory` is a
     * sortable/filterable column resolved through `parent_wi`: counting without the join would
     * disagree with the page whenever a condition touches it.
     */
    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(workItems)
      .leftJoin(sql`work.work_items parent_wi`, sql`parent_wi.id = work_items.parent_id`)
      .where(and(...conditions));

    return { rows: data, total: Number(countRow?.total ?? 0) };
  }

  async computeMetrics(
    workspaceId: string,
    projectId: string,
    scope: TeamReadScope,
  ): Promise<DefectMetrics> {
    // The same short-circuit as the list: six zeroed cards, not the project's six numbers.
    if (scopeIsEmpty(scope)) return NO_METRICS;

    const rows = await this.db
      .select({
        scheduleState: workItems.scheduleState,
        severity: workItems.severity,
        isBlocked: workItems.isBlocked,
        resolution: workItems.resolution,
        createdAt: workItems.createdAt,
        updatedAt: workItems.updatedAt,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.workspaceId, workspaceId),
          eq(workItems.projectId, projectId),
          eq(workItems.type, 'defect'),
          isNull(workItems.deletedAt),
          // The SAME predicate the page uses, from the one helper. These metrics ignore the caller's
          // filters by design (they count the project, not the page), which is exactly why the team
          // predicate must not be forgotten here: the strip would have kept reporting every team's
          // defects above a correctly narrowed grid.
          this.teamScope(scope),
        ),
      );

    let openDefects = 0;
    let critical = 0;
    let inProgress = 0;
    let verifiedAccepted = 0;
    let reopened = 0;
    let blockers = 0;

    // Open = actionable in-flight defect states (excludes `idea` backlog and
    // completed/accepted). Canonical set lives in db/schema/enums.ts.
    const isOpen = isOpenDefectScheduleState;
    const isCompleted = isCompletedScheduleState;

    for (const r of rows) {
      if (isOpen(r.scheduleState)) openDefects++;
      if (r.severity === 'critical') critical++;
      if (r.scheduleState === 'in_progress') inProgress++;
      if (isCompleted(r.scheduleState)) verifiedAccepted++;
      if (r.isBlocked) blockers++;

      // Reopened heuristic: has a resolution set but is back in an open state.
      if (r.resolution && isOpen(r.scheduleState)) reopened++;
    }

    return { openDefects, critical, inProgress, verifiedAccepted, reopened, blockers };
  }
}
