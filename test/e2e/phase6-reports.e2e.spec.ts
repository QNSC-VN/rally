/**
 * Phase 6 Reports, end to end against the real database.
 *
 * The pure formulas are covered by unit specs; what only a real database can prove is the
 * part the SRS puts on DEV rather than on the BA (P6-RPT-05):
 *
 *   • the snapshot job captures the Ideal baseline exactly once and is idempotent per day;
 *   • Burndown serves STORED history and reports a gap as a gap;
 *   • Velocity classifies from the persisted `acceptedDate` — which the database trigger, not
 *     the service, is responsible for setting;
 *   • Team Capacity reads the same `member_capacity` + `tasks` rows Team Status does;
 *   • Release Tracking's three buckets come out mutually exclusive over real rows.
 *
 * Its own project fixture, because several existing specs mutate the seeded US-1/DE-1 and this
 * suite is order-dependent (`fullyParallel: false`).
 *
 * Prereqs: docker deps up + `pnpm db:migrate` (see flow-harness).
 */
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';

import { AccessService } from '@modules/access';
import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { IterationsService } from '@modules/iterations';
import { PortfolioItemsService } from '@modules/portfolio';
import { ProjectsService } from '@modules/projects';
import { ReleasesService } from '@modules/releases';
import { ReportSnapshotService, ReportingService } from '@modules/reporting';
import { TeamStatusService } from '@modules/team-status';
import { WorkItemsService } from '@modules/work-items';
import { iterationDailySnapshots, iterations, workItems } from '@db/schema/work';
import { users } from '@db/schema/identity';

import {
  ADMIN_USER_ID,
  WORKSPACE_ID,
  adminActor,
  bootRallyApp,
  makeActor,
  uniqueKey,
} from './support/flow-harness';

describe('Phase 6 reports (e2e)', () => {
  let app: NestFastifyApplication;
  let db: DrizzleDB;
  let projects: ProjectsService;
  let items: WorkItemsService;
  let iterationsSvc: IterationsService;
  let releases: ReleasesService;
  let portfolio: PortfolioItemsService;
  let teamStatus: TeamStatusService;
  let reporting: ReportingService;
  let snapshots: ReportSnapshotService;

  const admin = adminActor();
  let projectId: string;
  let iterationId: string;
  let storyId: string;

  /** Today in the workspace's own calendar — what the job writes and the report reads. */
  let localToday: string;

  beforeAll(async () => {
    app = await bootRallyApp();
    db = app.get<DrizzleDB>(DRIZZLE);
    projects = app.get(ProjectsService);
    items = app.get(WorkItemsService);
    iterationsSvc = app.get(IterationsService);
    releases = app.get(ReleasesService);
    portfolio = app.get(PortfolioItemsService);
    teamStatus = app.get(TeamStatusService);
    reporting = app.get(ReportingService);
    snapshots = app.get(ReportSnapshotService);

    const project = await projects.createProject(admin, {
      key: uniqueKey(),
      name: 'Phase 6 reporting fixture',
    });
    projectId = project.id;

    // An iteration whose window contains today, committed so the job treats it as active.
    // The workspace's own calendar date, asked of Postgres so the test and the job agree.
    const todayResult = await db.execute<{ today: string }>(
      sql`select to_char(now() at time zone (select timezone from workspace.workspace_settings limit 1), 'YYYY-MM-DD') as today`,
    );
    localToday = todayResult.rows[0].today;
    const iteration = await iterationsSvc.createIteration(admin, projectId, 'P6 Sprint', {
      state: 'committed',
      startDate: shift(localToday, -3),
      endDate: shift(localToday, 3),
    });
    iterationId = iteration.id;

    const story = await items.createWorkItem(admin, projectId, 'story', 'P6 story', {
      iterationId,
      storyPoints: '5',
    });
    storyId = story.id;
    await items.createTask(admin, storyId, 'P6 task', {
      iterationId,
      assigneeId: ADMIN_USER_ID,
      estimateHours: '8',
      todoHours: '6',
      actualHours: '2',
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── the snapshot job ──────────────────────────────────────────────────────

  it('captures the Ideal baseline once and writes one row per local day', async () => {
    await snapshots.takeSnapshots();

    const [afterFirst] = await db
      .select({
        baseline: iterations.totalTaskEstimateAtStart,
        capturedAt: iterations.totalTaskEstimateCapturedAt,
      })
      .from(iterations)
      .where(eq(iterations.id, iterationId));
    expect(Number(afterFirst.baseline)).toBe(8);
    expect(afterFirst.capturedAt).not.toBeNull();

    // Re-estimating after the iteration started must NOT move the Ideal line (IB §5), and a
    // second tick must not re-capture — `captureStartBaseline` only writes when the column is
    // still null.
    await db.update(workItems).set({ updatedAt: new Date() }).where(eq(workItems.id, storyId));
    await snapshots.takeSnapshots();

    const [afterSecond] = await db
      .select({
        baseline: iterations.totalTaskEstimateAtStart,
        capturedAt: iterations.totalTaskEstimateCapturedAt,
      })
      .from(iterations)
      .where(eq(iterations.id, iterationId));
    expect(Number(afterSecond.baseline)).toBe(8);
    expect(afterSecond.capturedAt?.getTime()).toBe(afterFirst.capturedAt?.getTime());

    // Idempotent per (iteration, date): two ticks, one row.
    const rows = await db
      .select({
        date: iterationDailySnapshots.snapshotDate,
        todo: iterationDailySnapshots.remainingTodo,
      })
      .from(iterationDailySnapshots)
      .where(eq(iterationDailySnapshots.iterationId, iterationId));
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe(localToday);
    expect(Number(rows[0].todo)).toBe(6);
  });

  it('serves the stored history and reports the days it does not have', async () => {
    const report = await reporting.getIterationBurndown(admin, { projectId, iterationId });

    expect(report.context.projectName).toBe('Phase 6 reporting fixture');
    expect(report.context.teamName).toBe('All Teams');
    expect(report.totalTaskEstimateAtStart).toBe(8);

    /**
     * Both branches assert. Today may be a weekend, in which case it is deliberately absent from
     * the working-day axis — but "absent from the axis" is itself a rule worth pinning, and the
     * row must still be STORED for audit.
     *
     * This used to be `if (today) { ... }` with `measured.length` only bounded ABOVE, so on a
     * Saturday or Sunday the test asserted nothing at all about the stored history: it passed
     * even if the report had returned an all-null series. It ran that way for real — the audit
     * that found it was run on a Sunday.
     */
    const today = report.points.find((p) => p.date === localToday);
    const measured = report.points.filter((p) => p.remainingToDo !== null);

    if (today) {
      expect(today.remainingToDo).toBe(6);
      expect(today.ideal).not.toBeNull();
      // Exactly one measured day out of a multi-working-day window: partial, never fabricated.
      expect(measured).toHaveLength(1);
      expect(report.historyState).toBe('partial');
    } else {
      // A weekend. The snapshot exists in the table…
      const stored = await db
        .select({ date: iterationDailySnapshots.snapshotDate })
        .from(iterationDailySnapshots)
        .where(
          and(
            eq(iterationDailySnapshots.iterationId, iterationId),
            eq(iterationDailySnapshots.snapshotDate, localToday),
          ),
        );
      expect(stored).toHaveLength(1);
      // …and is deliberately NOT plotted, so the axis carries no measurement at all.
      expect(measured).toHaveLength(0);
      expect(report.historyState).toBe('missing');
    }

    expect(report.hasScheduledWork).toBe(true);
  });

  it('reports NO WINDOW for a dateless iteration instead of failing', async () => {
    /**
     * `startDate ?? ''` used to reach `workingDaysBetween`, where `'' < ''` slipped past the
     * inverted-range guard and `addDays('')` threw `RangeError: Invalid time value` — an HTTP 500,
     * reproduced against 99 of 206 iterations in the local database. "Add the dates first" and
     * "wait for the job to run" are different instructions, so this is its own state.
     */
    const dateless = await iterationsSvc.createIteration(admin, projectId, 'P6 No Dates', {
      state: 'planning',
    });

    const report = await reporting.getIterationBurndown(admin, {
      projectId,
      iterationId: dateless.id,
    });
    expect(report.historyState).toBe('no-window');
    expect(report.points).toEqual([]);
    expect(report.status).toBe('unknown');
  });

  it('resolves report:view for a WORKSPACE-SCOPED project_member role', async () => {
    /**
     * The permission that makes every report reachable at all.
     *
     * Phase 6 added `report:view` to PROJECT_ADMIN and PROJECT_MEMBER in
     * `db/permissions.catalog.ts`, but the catalogue only reaches a workspace through
     * `db/seeds/bootstrap.ts`, whose upsert is `set: { name }` so it cannot clobber an admin's
     * edits. Every workspace created before Phase 6 therefore kept its old permission array and
     * answered 403 on all five report routes to everyone except Workspace Admin — whose grant is
     * the global immutable anchor and hid the fault. Migration 0092 backfills it.
     *
     * Asserted through the workspace-scoped role row that `PolicyGuard` actually resolves, not
     * through the global template, because the template was never the one that was wrong.
     */
    const access = app.get(AccessService);
    const roles = await access.listRoles(WORKSPACE_ID);
    const member = roles.find((r) => r.slug === 'project_member' && r.workspaceId !== null);
    expect(member, 'workspace-scoped project_member role must exist').toBeDefined();
    expect(member?.permissions).toContain('report:view');

    // `identity.users` is workspace-agnostic — membership comes from the role ASSIGNMENT below,
    // which is what carries the workspace and the project scope.
    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      email: `p6-report-reader-${userId.slice(0, 8)}@qnsc.dev`,
      displayName: 'P6 report reader',
    });
    await access.assignRole(admin, userId, member!.id, 'project', projectId);

    // The harness's own actor builder: the permission array on it is INERT (authorization
    // resolves from the database), so this is identity only — exactly what the guard passes.
    const reader = makeActor(userId);
    await expect(access.hasProjectPermission(reader, projectId, 'report:view')).resolves.toBe(true);
    // Still a reader: the grant is view-only, so a write permission must not come with it.
    await expect(access.hasProjectPermission(reader, projectId, 'capacity:manage')).resolves.toBe(
      false,
    );
  });

  // ── Velocity ──────────────────────────────────────────────────────────────

  it('classifies from the acceptedDate the DATABASE set, not from the current state alone', async () => {
    const past = await iterationsSvc.createIteration(admin, projectId, 'P6 Past Sprint', {
      state: 'committed',
      startDate: shift(localToday, -20),
      endDate: shift(localToday, -10),
    });
    const onTime = await items.createWorkItem(admin, projectId, 'story', 'accepted on time', {
      iterationId: past.id,
      storyPoints: '5',
    });
    const late = await items.createWorkItem(admin, projectId, 'story', 'accepted late', {
      iterationId: past.id,
      storyPoints: '3',
    });
    await items.createWorkItem(admin, projectId, 'story', 'never accepted', {
      iterationId: past.id,
      storyPoints: '8',
    });

    // The trigger stamps `now()` on entry, which is AFTER this iteration ended — so both are
    // "accepted after" until the timestamps are moved. That is itself the proof that the
    // service does not have to remember to set the column.
    await items.updateWorkItem(admin, onTime.id, { scheduleState: 'accepted' });
    await items.updateWorkItem(admin, late.id, { scheduleState: 'accepted' });
    const [stamped] = await db
      .select({ acceptedDate: workItems.acceptedDate })
      .from(workItems)
      .where(eq(workItems.id, onTime.id));
    expect(stamped.acceptedDate).not.toBeNull();

    await db
      .update(workItems)
      .set({ acceptedDate: new Date(`${shift(localToday, -11)}T09:00:00Z`) })
      .where(eq(workItems.id, onTime.id));

    const report = await reporting.getVelocity(admin, { projectId, window: 5 });
    const bar = report.bars.find((b) => b.name === 'P6 Past Sprint');
    expect(bar).toBeDefined();
    expect(bar!.acceptedDuring).toBe(5);
    expect(bar!.acceptedAfter).toBe(3);
    expect(bar!.notAccepted).toBe(8);
    // Only During feeds the averages.
    expect(report.averages.trend).toBe(5);

    // Reopening clears the timestamp, so the item leaves both accepted segments entirely.
    await items.updateWorkItem(admin, onTime.id, { scheduleState: 'in_progress' });
    const reopened = await reporting.getVelocity(admin, { projectId, window: 5 });
    const afterReopen = reopened.bars.find((b) => b.name === 'P6 Past Sprint');
    expect(afterReopen!.acceptedDuring).toBe(0);
    expect(afterReopen!.notAccepted).toBe(13);
  });

  it('excludes an iteration that has not ended and one with no scheduled work', async () => {
    const empty = await iterationsSvc.createIteration(admin, projectId, 'P6 Empty Past', {
      state: 'committed',
      startDate: shift(localToday, -20),
      endDate: shift(localToday, -10),
    });
    const report = await reporting.getVelocity(admin, { projectId, window: 10 });
    // The current iteration has not ended; the empty one has nothing assigned.
    expect(report.bars.map((b) => b.name)).not.toContain('P6 Sprint');
    expect(report.bars.map((b) => b.name)).not.toContain('P6 Empty Past');
    expect(empty.id).toBeTruthy();
  });

  // ── Team Capacity ─────────────────────────────────────────────────────────

  it('projects the same capacity and task hours Team Status reads', async () => {
    const teamStatusView = await teamStatus.getTeamStatus(admin, projectId, undefined, iterationId);
    const teamId = teamStatusView.teamId ?? undefined;

    if (teamId) {
      await teamStatus.updateCapacity(admin, {
        projectId,
        teamId,
        iterationId,
        userId: ADMIN_USER_ID,
        capacityHours: 40,
      });
    }

    const report = await reporting.getTeamCapacity(admin, { projectId, iterationId });
    // Same hour totals as the Team Status read-model for the same iteration — the SRS's
    // "Totals use the same Team Status source" in the only form that can be verified.
    expect(report.totals.estimateHours).toBe(teamStatusView.totals.estimateHours);
    expect(report.totals.todoHours).toBe(teamStatusView.totals.todoHours);
    expect(report.totals.actualHours).toBe(teamStatusView.totals.actualHours);
    // ToDo is independent, never estimate - actual.
    expect(report.totals.todoHours).toBe(6);
    expect(report.totals.estimateHours).toBe(8);
  });

  // ── Release Tracking ──────────────────────────────────────────────────────

  it('splits Direct, Derived and Unparented into three disjoint buckets', async () => {
    const releaseA = await releases.createRelease(admin, projectId, 'P6 Release A', {
      startDate: shift(localToday, -5),
      releaseDate: shift(localToday, 25),
    });
    const releaseB = await releases.createRelease(admin, projectId, 'P6 Release B', {
      startDate: shift(localToday, 26),
      releaseDate: shift(localToday, 60),
    });

    const direct = await portfolio.createItem(admin, {
      projectId,
      type: 'feature',
      name: 'P6 direct feature',
      releaseId: releaseA.id,
    });
    const derived = await portfolio.createItem(admin, {
      projectId,
      type: 'feature',
      name: 'P6 derived feature',
      releaseId: releaseB.id,
    });

    // A child of the DERIVED feature sits in release A — that is what derives it.
    const cause = await items.createWorkItem(admin, projectId, 'story', 'derives A', {
      releaseId: releaseA.id,
      storyPoints: '2',
    });
    await items.updateWorkItem(admin, cause.id, { featureId: derived.id });

    // A child of the DIRECT feature pointing at another release is a mismatch ISSUE, not a
    // reclassification.
    const mismatched = await items.createWorkItem(admin, projectId, 'story', 'mismatch', {
      releaseId: releaseB.id,
      storyPoints: '1',
    });
    await items.updateWorkItem(admin, mismatched.id, { featureId: direct.id });

    // Release-assigned with no Feature parent → Unparented.
    await items.createWorkItem(admin, projectId, 'defect', 'orphan defect', {
      releaseId: releaseA.id,
      storyPoints: '4',
    });

    const report = await reporting.getReleaseTracking(admin, {
      projectId,
      releaseId: releaseA.id,
      unit: 'points',
      bucket: 'direct',
    });

    expect(report.summary).toEqual({ direct: 1, derived: 1, unparented: 1 });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].id).toBe(direct.id);
    // Rank is sequential inside the bucket, not the stored lexorank.
    expect(report.rows[0].rank).toBe(1);
    expect(report.rows[0].mismatches.map((m) => m.childId)).toEqual([mismatched.id]);
    // Every release-assigned child of this Feature points elsewhere.
    expect(report.rows[0].fullMismatch).toBe(true);

    // Tracked leaves for release A: the derived cause (2) + the orphan defect (4). The
    // mismatched child belongs to release B and is not tracked here.
    expect(report.totals.planned).toBe(6);
    expect(report.totals.accepted).toBe(0);

    const derivedView = await reporting.getReleaseTracking(admin, {
      projectId,
      releaseId: releaseA.id,
      bucket: 'derived',
    });
    expect(derivedView.rows.map((r) => r.id)).toEqual([derived.id]);
    // A Derived row shows a ratio with no percentage.
    expect(derivedView.rows[0].status.percent).toBeNull();

    const unparentedView = await reporting.getReleaseTracking(admin, {
      projectId,
      releaseId: releaseA.id,
      bucket: 'unparented',
    });
    expect(unparentedView.rows.map((r) => r.name)).toEqual(['orphan defect']);

    // Count switches every numerator and denominator; the bucket totals do not move.
    const counted = await reporting.getReleaseTracking(admin, {
      projectId,
      releaseId: releaseA.id,
      unit: 'count',
    });
    expect(counted.summary).toEqual(report.summary);
    expect(counted.totals.planned).toBe(2);
  });

  it('writes a burnup row per team scope and reports missing history honestly', async () => {
    const release = await releases.createRelease(admin, projectId, 'P6 Release C', {
      startDate: shift(localToday, -1),
      releaseDate: shift(localToday, 10),
    });
    await items.createWorkItem(admin, projectId, 'story', 'burnup story', {
      releaseId: release.id,
      storyPoints: '13',
    });

    const before = await reporting.getReleaseBurnup(admin, { projectId, releaseId: release.id });
    // Nothing captured yet, and no persisted Ideal target: reported, not drawn. `historyState`
    // describes the SNAPSHOTS (none), and `idealTarget` separately says there is no target — the
    // old single enum could only report `no-baseline` while nothing was measured, so a release
    // with history and no target was indistinguishable from one with a gap.
    expect(before.points.every((p) => p.accepted === null)).toBe(true);
    expect(before.points.every((p) => p.ideal === null)).toBe(true);
    expect(before.historyState).toBe('missing');
    expect(before.idealTarget).toBeNull();

    await snapshots.takeSnapshots();

    const after = await reporting.getReleaseBurnup(admin, { projectId, releaseId: release.id });
    const today = after.points.find((p) => p.date === localToday);
    expect(today?.planned).toBe(13);
    expect(today?.accepted).toBe(0);
    // One captured day inside a multi-day window.
    expect(after.historyState).toBe('partial');

    /**
     * The Ideal target was CAPTURED on this first snapshot day, from the planned scope.
     *
     * `ideal_target_points` / `ideal_target_count` had no writer anywhere in the codebase, so the
     * Ideal line could never be drawn for any release — the column existed, the DTO carried it,
     * and every point came back null forever.
     */
    expect(after.idealTarget).toBe(13);
    expect(after.points.some((p) => p.ideal !== null)).toBe(true);

    // Idempotent: a second tick rewrites the same (release, scope, date) row.
    await snapshots.takeSnapshots();
    const counted = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from work.release_daily_snapshots
          where release_id = ${release.id}::uuid and snapshot_date = ${localToday}::date
            and team_id is null`,
    );
    expect(counted.rows[0].n).toBe(1);

    /**
     * And the target is captured ONCE. Scope grows by 8 points, a later tick runs, and the target
     * must not follow it — RT-BR-09 forbids an Ideal that redraws whenever scope changes, which is
     * the same rule `captureStartBaseline` enforces for the iteration baseline.
     */
    await items.createWorkItem(admin, projectId, 'story', 'burnup scope creep', {
      releaseId: release.id,
      storyPoints: '8',
    });
    await snapshots.takeSnapshots();
    const later = await reporting.getReleaseBurnup(admin, { projectId, releaseId: release.id });
    expect(later.points.find((p) => p.date === localToday)?.planned).toBe(21);
    expect(later.idealTarget).toBe(13);
  });

  it('refuses an iteration from another project even with a project the caller can read', async () => {
    const other = await projects.createProject(admin, {
      key: uniqueKey(),
      name: 'P6 other project',
    });
    const foreign = await iterationsSvc.createIteration(admin, other.id, 'foreign', {
      startDate: localToday,
      endDate: localToday,
    });
    // `report:view` is checked against the projectId in the query, so the service has to
    // re-check that the iteration actually belongs to it.
    await expect(
      reporting.getIterationBurndown(admin, { projectId, iterationId: foreign.id }),
    ).rejects.toThrow(/ITERATION_NOT_FOUND|not found/i);
  });

  it('finalizes a closed local day so it can no longer be rewritten', async () => {
    // Plant a row for yesterday, then run the job: it writes only today, and marks the older
    // day finalized.
    await db.insert(iterationDailySnapshots).values({
      workspaceId: admin.workspaceId,
      iterationId,
      snapshotDate: shift(localToday, -1),
      remainingTodo: '99',
      acceptedPoints: '0',
    });

    await snapshots.takeSnapshots();

    const [yesterday] = await db
      .select({
        finalized: iterationDailySnapshots.finalized,
        todo: iterationDailySnapshots.remainingTodo,
      })
      .from(iterationDailySnapshots)
      .where(
        and(
          eq(iterationDailySnapshots.iterationId, iterationId),
          eq(iterationDailySnapshots.snapshotDate, shift(localToday, -1)),
        ),
      );
    expect(yesterday.finalized).toBe(true);
    // Untouched by today's tick — history is frozen.
    expect(Number(yesterday.todo)).toBe(99);
  });
});

/** Shift a `YYYY-MM-DD` date by whole days, staying in the calendar. */
function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
