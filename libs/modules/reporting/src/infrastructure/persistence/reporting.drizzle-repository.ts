import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import {
  iterationDailySnapshots,
  iterations,
  memberCapacity,
  portfolioItems,
  projects,
  releaseDailySnapshots,
  releases,
  tasks,
  teams,
  workItems,
} from '../../../../../../db/schema/work';
import { users } from '../../../../../../db/schema/identity';
import { workspaceSettings } from '../../../../../../db/schema/workspace';
import { acceptedScheduleStatesSql } from '../../../../../../db/schema/enums';
import type { StoredSnapshot } from '../../domain/burndown';
import type { ReleaseChild, ReleaseFeature, StoredBurnupRow } from '../../domain/release-tracking';
import { DEFAULT_WORKING_DAYS, isEndOfDayCapture, type TeamScope } from '../../domain/report-scope';
import type { CapacityRecord, ScopedTaskHours } from '../../domain/team-capacity';
import type { VelocityItem } from '../../domain/velocity';
import {
  IReportingRepository,
  type ActiveIterationRow,
  type ActiveReleaseRow,
  type IterationRow,
  type IterationSnapshotWrite,
  type ReleaseRow,
  type ReleaseSnapshotWrite,
  type TimeboxGroup,
  type WorkspaceReportSettings,
} from '../../domain/ports/reporting.repository';

/** Story and Defect only. Features are portfolio items; Tasks live in `tasks`. */
const LEAF_TYPES = ['story', 'defect'] as const;

const num = (v: string | null): number => (v === null ? 0 : Number(v));
const nullableNum = (v: string | null): number | null => (v === null ? null : Number(v));

@Injectable()
export class ReportingDrizzleRepository implements IReportingRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  // ── shared ────────────────────────────────────────────────────────────────

  async getWorkspaceSettings(workspaceId: string): Promise<WorkspaceReportSettings> {
    const rows = await this.db
      .select({ timeZone: workspaceSettings.timezone, workingDays: workspaceSettings.workingDays })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId))
      .limit(1);
    // A workspace with no settings row gets the column defaults rather than an error or an
    // empty axis: UTC and Mon–Fri behave identically to a freshly seeded workspace.
    return {
      timeZone: rows[0]?.timeZone ?? 'UTC',
      workingDays: rows[0]?.workingDays?.length ? rows[0].workingDays : [...DEFAULT_WORKING_DAYS],
    };
  }

  async getProjectName(workspaceId: string, projectId: string): Promise<string | null> {
    const rows = await this.db
      .select({ name: projects.name })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.workspaceId, workspaceId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.name ?? null;
  }

  async getTeamName(workspaceId: string, teamId: string): Promise<string | null> {
    const rows = await this.db
      .select({ name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.workspaceId, workspaceId)))
      .limit(1);
    return rows[0]?.name ?? null;
  }

  async findIteration(workspaceId: string, iterationId: string): Promise<IterationRow | null> {
    const rows = await this.db
      .select(ITERATION_COLUMNS)
      .from(iterations)
      .where(and(eq(iterations.id, iterationId), eq(iterations.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ? toIterationRow(rows[0]) : null;
  }

  async findTimeboxSiblings(
    workspaceId: string,
    projectId: string,
    timeboxGroupId: string | null,
    scope: TeamScope,
    fallbackIterationId: string,
  ): Promise<IterationRow[]> {
    // A dateless iteration belongs to no timebox, so there is nothing to fuse and the
    // selected iteration IS the scope. Grouping on a null key would pool every unscheduled
    // iteration in the project into one bar.
    const where =
      timeboxGroupId === null
        ? and(eq(iterations.id, fallbackIterationId), eq(iterations.workspaceId, workspaceId))
        : and(
            eq(iterations.workspaceId, workspaceId),
            eq(iterations.projectId, projectId),
            eq(iterations.timeboxGroupId, timeboxGroupId),
            scope.kind === 'team' ? teamOrSharedTimebox(scope.teamId) : undefined,
          );

    const rows = await this.db
      .select(ITERATION_COLUMNS)
      .from(iterations)
      .where(where)
      .orderBy(asc(iterations.name), asc(iterations.id));
    return rows.map(toIterationRow);
  }

  // ── Iteration Burndown ────────────────────────────────────────────────────

  async getIterationSnapshots(
    workspaceId: string,
    iterationIds: string[],
    scope: TeamScope,
    /** The workspace's calendar — needed to say whether a capture closed its own local day. */
    timeZone: string,
  ): Promise<StoredSnapshot[]> {
    if (iterationIds.length === 0) return [];
    const rows = await this.db
      .select({
        date: iterationDailySnapshots.snapshotDate,
        remainingToDo: iterationDailySnapshots.remainingTodo,
        acceptedPoints: iterationDailySnapshots.acceptedPoints,
        capturedAt: iterationDailySnapshots.capturedAt,
      })
      .from(iterationDailySnapshots)
      .where(
        and(
          eq(iterationDailySnapshots.workspaceId, workspaceId),
          inArray(iterationDailySnapshots.iterationId, iterationIds),
          /**
           * Exactly ONE series per iteration: the team's own rows, or the All Teams row.
           *
           * Not a filter that can match both — `team_id IS NULL` is a MEASURED total over the
           * whole scope, so including it alongside a team's rows would double every day the two
           * overlap. Team rows only exist from migration 0093 onwards, so a team-scoped chart of
           * older history is a legitimate gap rather than a silent fallback to All Teams.
           */
          scope.kind === 'team'
            ? eq(iterationDailySnapshots.teamId, scope.teamId)
            : isNull(iterationDailySnapshots.teamId),
        ),
      )
      .orderBy(asc(iterationDailySnapshots.snapshotDate), asc(iterationDailySnapshots.id));
    // One flat list across every fused iteration; `combineTeamSnapshots` sums per date.
    // Summing in SQL would hide which Teams contributed a day.
    return rows.map((r) => ({
      date: r.date,
      remainingToDo: num(r.remainingToDo),
      acceptedPoints: num(r.acceptedPoints),
      capturedAt: r.capturedAt,
      // Whether this row is the day's CLOSING figure or a reading the job left behind when it stopped
      // early. `finalizeSnapshotsBefore` freezes a closed day either way — it cannot be re-measured —
      // so the difference has to travel with the number instead of being lost.
      endOfDay: isEndOfDayCapture(r.capturedAt, r.date, timeZone),
    }));
  }

  async countScheduledWork(workspaceId: string, iterationIds: string[]): Promise<number> {
    if (iterationIds.length === 0) return 0;
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(workItems)
      .where(
        and(
          eq(workItems.workspaceId, workspaceId),
          inArray(workItems.iterationId, iterationIds),
          inArray(workItems.type, [...LEAF_TYPES]),
          isNull(workItems.deletedAt),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  // ── Velocity ──────────────────────────────────────────────────────────────

  async findEligibleTimeboxes(
    workspaceId: string,
    projectId: string,
    scope: TeamScope,
    todayLocalDate: string,
  ): Promise<TimeboxGroup[]> {
    // Eligibility is both halves of Velocity §2: the local end date is already past, AND at
    // least one Story/Defect is currently assigned. The inner join enforces the second half,
    // so an empty iteration never becomes a bar.
    //
    // Grouped by timebox_group_id so two Teams' iterations for one window collapse into ONE
    // bar — the defect the approved mockup exhibits (two adjacent bars both labelled 25.1).
    // COALESCE to the iteration id keeps an ungrouped iteration as its own bar instead of
    // pooling every ungrouped one together.
    const groupKey = sql`coalesce(${iterations.timeboxGroupId}::text, ${iterations.id}::text)`;
    const rows = await this.db
      .select({
        groupId: sql<string | null>`max(${iterations.timeboxGroupId}::text)`,
        name: sql<string>`min(${iterations.name})`,
        startDate: sql<string | null>`min(${iterations.startDate})`,
        endDate: sql<string | null>`max(${iterations.endDate})`,
        iterationIds: sql<string[]>`array_agg(distinct ${iterations.id}::text)`,
      })
      .from(iterations)
      .innerJoin(
        workItems,
        and(
          eq(workItems.iterationId, iterations.id),
          inArray(workItems.type, [...LEAF_TYPES]),
          isNull(workItems.deletedAt),
        ),
      )
      .where(
        and(
          eq(iterations.workspaceId, workspaceId),
          eq(iterations.projectId, projectId),
          sql`${iterations.endDate} < ${todayLocalDate}`,
          scope.kind === 'team' ? teamOrSharedTimebox(scope.teamId) : undefined,
        ),
      )
      .groupBy(groupKey)
      // Total order: two timeboxes can share an end date, so the tiebreaker is the smallest
      // iteration id in the group — unique per group, and stable across ticks.
      .orderBy(sql`max(${iterations.endDate}) asc`, sql`min(${iterations.id}::text) asc`);

    return rows.map((r) => ({
      timeboxGroupId: r.groupId,
      name: r.name,
      startDate: r.startDate,
      endDate: r.endDate,
      iterationIds: r.iterationIds,
    }));
  }

  async getVelocityItems(
    workspaceId: string,
    iterationIds: string[],
    scope: TeamScope,
  ): Promise<Array<VelocityItem & { iterationId: string }>> {
    if (iterationIds.length === 0) return [];
    const iteration = alias(iterations, 'velocity_iteration');
    /**
     * Whose points these are: the ITEM's team, falling back to its iteration's.
     *
     * The same two-tier rule `getScopedTaskHours` uses, and it has to be here too — this query
     * had no team predicate at all, so team scope came only from which iterations were selected.
     * That attributed work by the TIMEBOX's team, and nothing keeps the two in step: the seeded
     * database already holds Team Beta's `US-D2` sitting in Team Alpha's Sprint 26.1, counted as
     * Alpha's 8 points and absent from Beta's chart entirely.
     */
    const resolvedTeam = sql`coalesce(${workItems.teamId}, ${iteration.teamId})`;
    const rows = await this.db
      .select({
        id: workItems.id,
        iterationId: workItems.iterationId,
        planEstimate: workItems.storyPoints,
        // {accepted, release}. `Completed` is NOT accepted-equivalent.
        acceptedEquivalent: sql<boolean>`${workItems.scheduleState} in (${acceptedScheduleStatesSql()})`,
        acceptedDate: workItems.acceptedDate,
      })
      .from(workItems)
      .leftJoin(iteration, eq(iteration.id, workItems.iterationId))
      .where(
        and(
          eq(workItems.workspaceId, workspaceId),
          inArray(workItems.iterationId, iterationIds),
          inArray(workItems.type, [...LEAF_TYPES]),
          isNull(workItems.deletedAt),
          scope.kind === 'team' ? sql`${resolvedTeam} = ${scope.teamId}::uuid` : undefined,
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      iterationId: r.iterationId as string,
      planEstimate: nullableNum(r.planEstimate),
      acceptedEquivalent: r.acceptedEquivalent,
      acceptedDate: r.acceptedDate,
    }));
  }

  // ── Team Capacity ─────────────────────────────────────────────────────────

  async getCapacityRecords(
    workspaceId: string,
    projectId: string,
    iterationIds: string[],
    scope: TeamScope,
  ): Promise<CapacityRecord[]> {
    if (iterationIds.length === 0) return [];
    const rows = await this.db
      .select({
        teamId: memberCapacity.teamId,
        teamName: teams.name,
        teamStatus: teams.status,
        memberId: memberCapacity.userId,
        memberName: users.displayName,
        capacityHours: memberCapacity.capacityHours,
      })
      .from(memberCapacity)
      .innerJoin(teams, eq(teams.id, memberCapacity.teamId))
      .innerJoin(users, eq(users.id, memberCapacity.userId))
      .where(
        and(
          eq(memberCapacity.workspaceId, workspaceId),
          eq(memberCapacity.projectId, projectId),
          inArray(memberCapacity.iterationId, iterationIds),
          scope.kind === 'team' ? eq(memberCapacity.teamId, scope.teamId) : undefined,
        ),
      );
    return rows.map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName,
      teamArchived: r.teamStatus === 'archived',
      memberId: r.memberId,
      memberName: r.memberName,
      capacityHours: num(r.capacityHours),
    }));
  }

  async getScopedTaskHours(
    workspaceId: string,
    projectId: string,
    iterationIds: string[],
    scope: TeamScope,
  ): Promise<ScopedTaskHours[]> {
    if (iterationIds.length === 0) return [];
    const parent = alias(workItems, 'parent');
    const team = alias(teams, 'task_team');
    const iteration = alias(iterations, 'task_iteration');
    // Three tiers, most specific first. The iteration is the last resort because a
    // team-scoped iteration IS a statement about whose work this is — and without that tier a
    // project that assigns Teams only at the iteration level would show hours on Team Status
    // and nothing at all here, which is precisely the disagreement this projection exists to
    // prevent. Still null after all three (no Team anywhere) groups under `No Team` rather
    // than being dropped.
    const resolvedTeam = sql`coalesce(${tasks.teamId}, ${parent.teamId}, ${iteration.teamId})`;

    // The scoping predicate is Team Status's, not a new one: a task is in scope when the
    // task OR its parent Story/Defect is assigned to the iteration. The SRS requires
    // "Totals use the same Team Status source", and `TeamStatusDrizzleRepository.getTaskRows`
    // uses exactly this rule — a parent-only variant would show different totals on the two
    // screens for the same iteration, which is the one thing this projection must not do.
    //
    // Parent status does not exclude its tasks (§3): accepted or released work still
    // contributes hours while it remains assigned to the iteration.
    const rows = await this.db
      .select({
        taskId: tasks.id,
        teamId: sql<string | null>`${resolvedTeam}`,
        teamName: team.name,
        teamStatus: team.status,
        ownerId: tasks.assigneeId,
        ownerName: users.displayName,
        estimateHours: tasks.estimateHours,
        todoHours: tasks.todoHours,
        actualHours: tasks.actualHours,
      })
      .from(tasks)
      .innerJoin(parent, and(eq(parent.id, tasks.parentId), isNull(parent.deletedAt)))
      .leftJoin(
        iteration,
        sql`${iteration.id} = coalesce(${tasks.iterationId}, ${parent.iterationId})`,
      )
      .leftJoin(team, sql`${team.id} = ${resolvedTeam}`)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
          sql`(${tasks.iterationId} in ${inList(iterationIds)} or ${parent.iterationId} in ${inList(iterationIds)})`,
          scope.kind === 'team' ? sql`${resolvedTeam} = ${scope.teamId}::uuid` : undefined,
        ),
      );

    return rows.map((r) => ({
      taskId: r.taskId,
      teamId: r.teamId,
      teamName: r.teamName,
      teamArchived: r.teamStatus === 'archived',
      ownerId: r.ownerId,
      ownerName: r.ownerName,
      estimateHours: num(r.estimateHours),
      todoHours: num(r.todoHours),
      actualHours: num(r.actualHours),
    }));
  }

  // ── Release Tracking ──────────────────────────────────────────────────────

  async findRelease(workspaceId: string, releaseId: string): Promise<ReleaseRow | null> {
    const rows = await this.db
      .select({
        id: releases.id,
        workspaceId: releases.workspaceId,
        projectId: releases.projectId,
        name: releases.name,
        startDate: releases.startDate,
        releaseDate: releases.releaseDate,
        idealTargetPoints: releases.idealTargetPoints,
        idealTargetCount: releases.idealTargetCount,
      })
      .from(releases)
      .where(and(eq(releases.id, releaseId), eq(releases.workspaceId, workspaceId)))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return { ...r, idealTargetPoints: nullableNum(r.idealTargetPoints) };
  }

  async getReleaseFeatures(
    workspaceId: string,
    projectId: string,
    preliminaryPoints: (size: string) => number,
    preliminaryCount: (size: string) => number,
  ): Promise<Array<ReleaseFeature & { state: string }>> {
    const rows = await this.db
      .select({
        id: portfolioItems.id,
        itemKey: portfolioItems.itemKey,
        name: portfolioItems.name,
        state: portfolioItems.state,
        releaseId: portfolioItems.releaseId,
        teamId: portfolioItems.teamId,
        teamName: teams.name,
        rank: portfolioItems.rank,
        plannedStartDate: portfolioItems.plannedStartDate,
        plannedEndDate: portfolioItems.plannedEndDate,
        refinedPoints: portfolioItems.refinedEstimate,
        refinedCount: portfolioItems.refinedItemCountEstimate,
        preliminaryEstimate: portfolioItems.preliminaryEstimate,
      })
      .from(portfolioItems)
      .leftJoin(teams, eq(teams.id, portfolioItems.teamId))
      .where(
        and(
          eq(portfolioItems.workspaceId, workspaceId),
          eq(portfolioItems.projectId, projectId),
          eq(portfolioItems.type, 'feature'),
          // Archived Features are out of sight on every other Feature surface; a report that
          // resurrected them would contradict all of them.
          isNull(portfolioItems.archivedAt),
        ),
      )
      .orderBy(asc(portfolioItems.rank), asc(portfolioItems.itemKey), asc(portfolioItems.id));

    return rows.map((r) => ({
      id: r.id,
      itemKey: r.itemKey,
      name: r.name,
      state: r.state,
      releaseId: r.releaseId,
      teamId: r.teamId,
      teamName: r.teamName,
      rank: r.rank,
      plannedStartDate: r.plannedStartDate,
      plannedEndDate: r.plannedEndDate,
      refinedPoints: num(r.refinedPoints),
      refinedCount: r.refinedCount,
      preliminaryPoints: preliminaryPoints(r.preliminaryEstimate),
      preliminaryCount: preliminaryCount(r.preliminaryEstimate),
    }));
  }

  async getReleaseChildren(
    workspaceId: string,
    projectId: string,
    releaseId: string,
  ): Promise<ReleaseChild[]> {
    const release = alias(releases, 'child_release');
    const team = alias(teams, 'child_team');

    // Two populations in one pass, because both are needed and neither contains the other:
    //   • items assigned to THIS release — the tracked leaves, the Derived causes and the
    //     Unparented bucket;
    //   • items linked to ANY Feature in the project — a Direct Feature's Status counts every
    //     direct child, including children in another release or none (RT-BR-05).
    // Filtering to one of them would silently change a Status denominator.
    const rows = await this.db
      .select({
        id: workItems.id,
        itemKey: workItems.itemKey,
        type: workItems.type,
        title: workItems.title,
        featureId: workItems.featureId,
        releaseId: workItems.releaseId,
        releaseName: release.name,
        teamId: workItems.teamId,
        teamName: team.name,
        planEstimate: workItems.storyPoints,
        acceptedEquivalent: sql<boolean>`${workItems.scheduleState} in (${acceptedScheduleStatesSql()})`,
        scheduleState: workItems.scheduleState,
      })
      .from(workItems)
      .leftJoin(release, eq(release.id, workItems.releaseId))
      .leftJoin(team, eq(team.id, workItems.teamId))
      .where(
        and(
          eq(workItems.workspaceId, workspaceId),
          eq(workItems.projectId, projectId),
          inArray(workItems.type, [...LEAF_TYPES]),
          isNull(workItems.deletedAt),
          sql`(${workItems.releaseId} = ${releaseId}::uuid or ${workItems.featureId} is not null)`,
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      itemKey: r.itemKey,
      type: r.type as 'story' | 'defect',
      title: r.title,
      featureId: r.featureId,
      releaseId: r.releaseId,
      releaseName: r.releaseName,
      teamId: r.teamId,
      teamName: r.teamName,
      planEstimate: nullableNum(r.planEstimate),
      acceptedEquivalent: r.acceptedEquivalent,
      scheduleState: r.scheduleState,
    }));
  }

  async getReleaseBurnupRows(
    workspaceId: string,
    releaseId: string,
    scope: TeamScope,
    unit: 'points' | 'count',
  ): Promise<StoredBurnupRow[]> {
    const rows = await this.db
      .select({
        date: releaseDailySnapshots.snapshotDate,
        acceptedPoints: releaseDailySnapshots.acceptedPoints,
        acceptedCount: releaseDailySnapshots.acceptedCount,
        plannedPoints: releaseDailySnapshots.plannedPoints,
        plannedCount: releaseDailySnapshots.plannedCount,
        preliminaryPoints: releaseDailySnapshots.preliminaryPoints,
        preliminaryCount: releaseDailySnapshots.preliminaryCount,
      })
      .from(releaseDailySnapshots)
      .where(
        and(
          // Redundant with release_id in practice, and kept anyway: every read of a
          // workspace-bearing table states the workspace, so a mistaken id cannot cross a
          // tenant boundary.
          eq(releaseDailySnapshots.workspaceId, workspaceId),
          eq(releaseDailySnapshots.releaseId, releaseId),
          // The All Teams row is STORED (`team_id IS NULL`) rather than summed from the Team
          // rows: an item two Teams both touch must be counted once, which a SUM cannot do.
          scope.kind === 'team'
            ? eq(releaseDailySnapshots.teamId, scope.teamId)
            : isNull(releaseDailySnapshots.teamId),
        ),
      )
      .orderBy(asc(releaseDailySnapshots.snapshotDate), asc(releaseDailySnapshots.id));

    return rows.map((r) => ({
      date: r.date,
      accepted: unit === 'points' ? num(r.acceptedPoints) : r.acceptedCount,
      planned: unit === 'points' ? num(r.plannedPoints) : r.plannedCount,
      preliminary: unit === 'points' ? num(r.preliminaryPoints) : r.preliminaryCount,
    }));
  }

  async findIterationsInWindow(
    workspaceId: string,
    projectId: string,
    scope: TeamScope,
    startDate: string,
    endDate: string,
  ): Promise<IterationRow[]> {
    const rows = await this.db
      .select(ITERATION_COLUMNS)
      .from(iterations)
      .where(
        and(
          eq(iterations.workspaceId, workspaceId),
          eq(iterations.projectId, projectId),
          // Overlap, not containment: an iteration straddling the release start belongs under
          // the axis just as much as one fully inside it.
          sql`${iterations.startDate} <= ${endDate} and ${iterations.endDate} >= ${startDate}`,
          scope.kind === 'team' ? eq(iterations.teamId, scope.teamId) : undefined,
        ),
      )
      .orderBy(asc(iterations.startDate), asc(iterations.id));
    return rows.map(toIterationRow);
  }

  // ── the daily snapshot job ────────────────────────────────────────────────

  async findActiveIterations(): Promise<ActiveIterationRow[]> {
    const rows = await this.db
      .select({ ...ITERATION_COLUMNS, workspaceId: iterations.workspaceId })
      .from(iterations)
      // Committed only, matching what the product calls an active iteration. A `planning`
      // iteration has no execution to burn down, and an `accepted` one is finished — writing
      // rows for either would put flat lines on charts nobody is looking at.
      .where(eq(iterations.state, 'committed'));
    return rows.map((r) => ({ ...toIterationRow(r), workspaceId: r.workspaceId }));
  }

  async findActiveReleases(): Promise<ActiveReleaseRow[]> {
    const rows = await this.db
      .select({
        id: releases.id,
        workspaceId: releases.workspaceId,
        projectId: releases.projectId,
        startDate: releases.startDate,
        releaseDate: releases.releaseDate,
      })
      .from(releases)
      // A release with no window has no burnup axis, so there is nothing to snapshot against.
      // The service filters by the workspace's own local today.
      .where(sql`${releases.startDate} is not null and ${releases.releaseDate} is not null`);
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      projectId: r.projectId,
      startDate: r.startDate as string,
      releaseDate: r.releaseDate as string,
    }));
  }

  async findWorkspacesWithOpenSnapshots(): Promise<string[]> {
    /**
     * Both snapshot tables, unioned and de-duplicated.
     *
     * Asks about the ROWS rather than about what is currently active: a workspace whose last iteration
     * has closed has nothing active, so it never reappeared in the snapshot loop's workspace set and
     * its final day stayed unfinalized forever. Indexed on `finalized` in both tables, so this is a
     * partial-index scan rather than a table walk.
     */
    const [iterationRows, releaseRows] = await Promise.all([
      this.db
        .selectDistinct({ workspaceId: iterationDailySnapshots.workspaceId })
        .from(iterationDailySnapshots)
        .where(eq(iterationDailySnapshots.finalized, false)),
      this.db
        .selectDistinct({ workspaceId: releaseDailySnapshots.workspaceId })
        .from(releaseDailySnapshots)
        .where(eq(releaseDailySnapshots.finalized, false)),
    ]);

    return [...new Set([...iterationRows, ...releaseRows].map((row) => row.workspaceId))];
  }

  async sumTaskEstimate(workspaceId: string, iterationId: string): Promise<number> {
    const parent = alias(workItems, 'parent');
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${tasks.estimateHours}), 0)::float8` })
      .from(tasks)
      .innerJoin(parent, and(eq(parent.id, tasks.parentId), isNull(parent.deletedAt)))
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          isNull(tasks.deletedAt),
          sql`(${tasks.iterationId} = ${iterationId}::uuid or ${parent.iterationId} = ${iterationId}::uuid)`,
        ),
      );
    return rows[0]?.total ?? 0;
  }

  async captureStartBaseline(
    workspaceId: string,
    iterationId: string,
    totalTaskEstimate: number,
    at: Date,
  ): Promise<void> {
    // `IS NULL` in the predicate is what makes this a ONE-TIME capture: the Ideal line must
    // not move when tasks are added or re-estimated after the iteration starts, so a second
    // tick of the job matches zero rows rather than overwriting the baseline.
    await this.db
      .update(iterations)
      .set({
        totalTaskEstimateAtStart: String(totalTaskEstimate),
        totalTaskEstimateCapturedAt: at,
      })
      .where(
        and(
          eq(iterations.workspaceId, workspaceId),
          eq(iterations.id, iterationId),
          isNull(iterations.totalTaskEstimateAtStart),
        ),
      );
  }

  async captureReleaseIdealTarget(
    workspaceId: string,
    releaseId: string,
    plannedPoints: number,
    plannedCount: number,
  ): Promise<void> {
    // `isNull` on BOTH columns, mirroring `captureStartBaseline`: the write is the capture, so a
    // second tick matches zero rows instead of moving the target as scope changes. Guarding on
    // one column alone would let a half-written pair be completed on a later, different day.
    await this.db
      .update(releases)
      .set({
        idealTargetPoints: String(plannedPoints),
        idealTargetCount: Math.round(plannedCount),
      })
      .where(
        and(
          eq(releases.workspaceId, workspaceId),
          eq(releases.id, releaseId),
          isNull(releases.idealTargetPoints),
          isNull(releases.idealTargetCount),
        ),
      );
  }

  async measureIterationDay(
    workspaceId: string,
    iterationId: string,
    endOfDay: Date,
    teamId: string | null = null,
  ): Promise<{ remainingTodo: number; acceptedPoints: number }> {
    const parent = alias(workItems, 'parent');
    const iteration = alias(iterations, 'measured_iteration');
    /**
     * Whose work this is — the same two-tier rule the live reports use.
     *
     * `teamId === null` MEASURES the whole iteration scope (the All Teams row), it does not sum
     * the team rows: a task two teams both touch has to be counted once, and summing would count
     * it twice. `release_daily_snapshots` already works this way.
     */
    const taskTeam = sql`coalesce(${tasks.teamId}, ${parent.teamId}, ${iteration.teamId})`;
    const itemTeam = sql`coalesce(${workItems.teamId}, ${iteration.teamId})`;

    const [todo] = await this.db
      .select({ total: sql<number>`coalesce(sum(${tasks.todoHours}), 0)::float8` })
      .from(tasks)
      .innerJoin(parent, and(eq(parent.id, tasks.parentId), isNull(parent.deletedAt)))
      .leftJoin(
        iteration,
        sql`${iteration.id} = coalesce(${tasks.iterationId}, ${parent.iterationId})`,
      )
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          isNull(tasks.deletedAt),
          // Same scoping rule as Team Status and the Team Capacity projection.
          sql`(${tasks.iterationId} = ${iterationId}::uuid or ${parent.iterationId} = ${iterationId}::uuid)`,
          teamId === null ? undefined : sql`${taskTeam} = ${teamId}::uuid`,
        ),
      );

    const [accepted] = await this.db
      .select({ total: sql<number>`coalesce(sum(${workItems.storyPoints}), 0)::float8` })
      .from(workItems)
      .leftJoin(iteration, eq(iteration.id, workItems.iterationId))
      .where(
        and(
          eq(workItems.workspaceId, workspaceId),
          eq(workItems.iterationId, iterationId),
          inArray(workItems.type, [...LEAF_TYPES]),
          isNull(workItems.deletedAt),
          sql`${workItems.scheduleState} in (${acceptedScheduleStatesSql()})`,
          // Cumulative BY DATE (IB-BR-02): an item accepted after this day's local boundary
          // does not count towards it, even though it is accepted right now.
          sql`${workItems.acceptedDate} is not null and ${workItems.acceptedDate} <= ${endOfDay}`,
          teamId === null ? undefined : sql`${itemTeam} = ${teamId}::uuid`,
        ),
      );

    return { remainingTodo: todo?.total ?? 0, acceptedPoints: accepted?.total ?? 0 };
  }

  async teamsInIterationScope(workspaceId: string, iterationId: string): Promise<string[]> {
    /**
     * The teams that actually have work in this iteration — tasks OR leaf items.
     *
     * Snapshotting every team in the project would write a row of zeros for teams that never
     * touched the iteration, and a zero is indistinguishable from a team that delivered nothing.
     * Same rule `teamsInvolved` applies to the release burnup.
     */
    const parent = alias(workItems, 'parent');
    const iteration = alias(iterations, 'scope_iteration');
    const taskTeams = await this.db
      .selectDistinct({
        teamId: sql<string | null>`coalesce(${tasks.teamId}, ${parent.teamId}, ${iteration.teamId})`,
      })
      .from(tasks)
      .innerJoin(parent, and(eq(parent.id, tasks.parentId), isNull(parent.deletedAt)))
      .leftJoin(
        iteration,
        sql`${iteration.id} = coalesce(${tasks.iterationId}, ${parent.iterationId})`,
      )
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          isNull(tasks.deletedAt),
          sql`(${tasks.iterationId} = ${iterationId}::uuid or ${parent.iterationId} = ${iterationId}::uuid)`,
        ),
      );

    const itemTeams = await this.db
      .selectDistinct({
        teamId: sql<string | null>`coalesce(${workItems.teamId}, ${iteration.teamId})`,
      })
      .from(workItems)
      .leftJoin(iteration, eq(iteration.id, workItems.iterationId))
      .where(
        and(
          eq(workItems.workspaceId, workspaceId),
          eq(workItems.iterationId, iterationId),
          inArray(workItems.type, [...LEAF_TYPES]),
          isNull(workItems.deletedAt),
        ),
      );

    const ids = new Set<string>();
    for (const row of [...taskTeams, ...itemTeams]) {
      if (row.teamId !== null) ids.add(row.teamId);
    }
    return [...ids];
  }

  async upsertIterationSnapshot(row: IterationSnapshotWrite): Promise<void> {
    /**
     * Idempotent by (iteration, team, date): a retry, a second pod, or an extra tick rewrites the
     * same row rather than creating a duplicate (IB §4). Only TODAY's date is ever passed, so this
     * can never rewrite a closed day.
     *
     * Raw SQL, exactly like `upsertReleaseSnapshot` and for the same reason: the unique index is
     * on `(iteration_id, COALESCE(team_id, nil), snapshot_date)` — a nullable team needs the
     * COALESCE so one ON CONFLICT predicate serves the team rows AND the All Teams row — and
     * Drizzle's `onConflictDoUpdate` target accepts columns only, not an expression. Every value
     * is still a bind parameter.
     */
    await this.db.execute(sql`
      insert into "work"."iteration_daily_snapshots"
        (workspace_id, iteration_id, team_id, snapshot_date,
         remaining_todo, accepted_points, captured_at)
      values
        (${row.workspaceId}::uuid, ${row.iterationId}::uuid, ${row.teamId}::uuid,
         ${row.snapshotDate}::date, ${String(row.remainingTodo)}, ${String(row.acceptedPoints)}, now())
      on conflict (iteration_id, coalesce(team_id, ${NIL_UUID}::uuid), snapshot_date)
      do update set
        remaining_todo  = excluded.remaining_todo,
        accepted_points = excluded.accepted_points,
        captured_at     = now()
      -- Defence in depth: a finalized day stays put even if a caller passed a past date.
      where "work"."iteration_daily_snapshots".finalized = false
    `);
  }

  async upsertReleaseSnapshot(row: ReleaseSnapshotWrite): Promise<void> {
    // Raw SQL for this one write. The unique index is on
    // `(release_id, COALESCE(team_id, nil), snapshot_date)` — a nullable Team needs a COALESCE
    // so ON CONFLICT can match one predicate for both the Team rows and the All Teams row —
    // and Drizzle's `onConflictDoUpdate` target only accepts columns, not an expression.
    // Every value is still a bind parameter.
    await this.db.execute(sql`
      insert into "work"."release_daily_snapshots"
        (workspace_id, release_id, team_id, snapshot_date,
         accepted_points, accepted_count, planned_points, planned_count,
         preliminary_points, preliminary_count, captured_at)
      values
        (${row.workspaceId}::uuid, ${row.releaseId}::uuid, ${row.teamId}::uuid, ${row.snapshotDate}::date,
         ${row.acceptedPoints}, ${row.acceptedCount}, ${row.plannedPoints}, ${row.plannedCount},
         ${row.preliminaryPoints}, ${row.preliminaryCount}, now())
      on conflict (release_id, coalesce(team_id, ${NIL_UUID}::uuid), snapshot_date)
      do update set
        accepted_points    = excluded.accepted_points,
        accepted_count     = excluded.accepted_count,
        planned_points     = excluded.planned_points,
        planned_count      = excluded.planned_count,
        preliminary_points = excluded.preliminary_points,
        preliminary_count  = excluded.preliminary_count,
        captured_at        = now()
      -- Defence in depth: a finalized day stays put even if a caller passed a past date.
      where "work"."release_daily_snapshots".finalized = false
    `);
  }

  async finalizeSnapshotsBefore(workspaceId: string, localDate: string): Promise<void> {
    await Promise.all([
      this.db
        .update(iterationDailySnapshots)
        .set({ finalized: true })
        .where(
          and(
            eq(iterationDailySnapshots.workspaceId, workspaceId),
            sql`${iterationDailySnapshots.snapshotDate} < ${localDate}`,
            eq(iterationDailySnapshots.finalized, false),
          ),
        ),
      this.db
        .update(releaseDailySnapshots)
        .set({ finalized: true })
        .where(
          and(
            eq(releaseDailySnapshots.workspaceId, workspaceId),
            sql`${releaseDailySnapshots.snapshotDate} < ${localDate}`,
            eq(releaseDailySnapshots.finalized, false),
          ),
        ),
    ]);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** The nil UUID the unique index COALESCEs a null team_id to (migration 0088). */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const ITERATION_COLUMNS = {
  id: iterations.id,
  projectId: iterations.projectId,
  teamId: iterations.teamId,
  timeboxGroupId: iterations.timeboxGroupId,
  name: iterations.name,
  startDate: iterations.startDate,
  endDate: iterations.endDate,
  totalTaskEstimateAtStart: iterations.totalTaskEstimateAtStart,
} as const;

/**
 * Which iterations a TEAM-scoped report may draw on: the team's own, plus the SHARED ones.
 *
 * `iterations.team_id` is optional in this schema — an iteration needs a project and may name a
 * team (real Rally collapses the two, we do not) — so a project can run one timebox per sprint
 * that every team works inside. Matching `team_id = :team` alone therefore returned NOTHING for
 * such a project: 195 of 206 iterations in the local database are team-less, so a selected Team
 * showed `iterationCount: 0`, empty Velocity bars and zero capacity while Team Status showed the
 * hours. The inverse was just as wrong — the null-group fallback branch dropped the predicate
 * entirely, so a selected Team DID get a shared iteration's data there.
 *
 * The timebox says WHICH window; the work says WHOSE it is. So a shared window is in scope and
 * the per-item team predicate below is what narrows the numbers.
 */
function teamOrSharedTimebox(teamId: string) {
  return or(eq(iterations.teamId, teamId), isNull(iterations.teamId));
}

function toIterationRow(row: {
  id: string;
  projectId: string;
  teamId: string | null;
  timeboxGroupId: string | null;
  name: string;
  startDate: string | null;
  endDate: string | null;
  totalTaskEstimateAtStart: string | null;
}): IterationRow {
  return { ...row, totalTaskEstimateAtStart: nullableNum(row.totalTaskEstimateAtStart) };
}

/**
 * A parenthesised SQL list for a raw `in` inside a hand-written predicate.
 *
 * Drizzle's `inArray` cannot be embedded in the OR the task-scoping rule needs, and binding
 * each id separately keeps this parameterised rather than string-concatenated.
 */
function inList(ids: string[]) {
  return sql`(${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}
