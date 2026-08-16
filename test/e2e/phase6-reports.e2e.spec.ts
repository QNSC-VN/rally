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
import {
  iterationDailySnapshots,
  iterationTeamBaselines,
  releaseTeamTargets,
  teamMembers,
  teams,
  workItems,
} from '@db/schema/work';
import { users } from '@db/schema/identity';
import { workspaceMembers } from '@db/schema/workspace';

import { ACCESS_LEVEL_PERMISSIONS } from '@shared-kernel';
import { PAY_PROJECT_ID } from '../../db/seeds/constants';
import {
  ADMIN_USER_ID,
  WORKSPACE_ID,
  adminActor,
  bootRallyApp,
  grantProjectAccess,
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

  /** A workspace team, inserted directly — teams have no create service in this module's reach. */
  /**
   * A team plus its ROSTER. The roster row is not decoration: `updateCapacity` refuses a member who is
   * not on the selected team (§9.2:374), so a team created bare cannot be given capacity — and
   * capacity is what the Team Capacity assertions below measure.
   */
  async function newTeam(label: string, memberIds: string[] = [ADMIN_USER_ID]): Promise<string> {
    const [row] = await db
      .insert(teams)
      .values({
        workspaceId: WORKSPACE_ID,
        name: `${label} ${uniqueKey()}`,
        key: uniqueKey('T'),
        status: 'active',
      })
      .returning({ id: teams.id });
    if (memberIds.length > 0) {
      await db
        .insert(teamMembers)
        .values(memberIds.map((userId) => ({ workspaceId: WORKSPACE_ID, teamId: row.id, userId })))
        .onConflictDoNothing();
    }
    return row.id;
  }
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
    /**
     * No `iterationId`: the task takes its parent's (P1-TASK-011), which is this iteration. Passing
     * one is now a compile error, and it was always redundant here.
     *
     * And NO OWNER, deliberately — an Owner would force a Team onto this fixture, and the fixture's
     * team-LESSNESS is what the next test measures. "A named Owner must be an active member of the
     * selected Team; if `teamId` is null, `assigneeId` must also be null/Unassigned"
     * (`Phase 1/03_Work_Item_Detail/SRS.md` §7:125, `Phase 1/04:84` for a Task against its inherited
     * parent Team), so `assigneeId` here needs a Team on the Story — and the snapshot job writes ONE
     * ROW PER SCOPE (`[null, ...teamsInIterationScope]`), so any resolvable team turns the single
     * All-Teams row this iteration is asserted to have into two. `ADMIN_USER_ID` could not be that
     * owner anyway: the Owner population excludes Workspace Admins (Backlog AC-16:336).
     *
     * Nothing is lost by dropping it. The hours are what every assertion in this file reads, and an
     * unowned task still reaches both totals — Team Status buckets it under `Unassigned` and Team
     * Capacity's `getScopedTaskHours` LEFT-joins `users`, which is precisely why the two agree.
     */
    await items.createTask(admin, storyId, 'P6 task', {
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

    /**
     * Read from `iteration_team_baselines`, not `iterations.total_task_estimate_at_start`.
     *
     * IB §4 makes the baseline per TEAM with All Teams as the sum, so migration 0098 moved it to one
     * row per (iteration, team scope). The old single column could only ever hold a project-wide
     * number, which is what made a team-scoped chart plot the whole project's Ideal.
     */
    const first = await db
      .select({
        teamId: iterationTeamBaselines.teamId,
        baseline: iterationTeamBaselines.totalTaskEstimateAtStart,
        capturedAt: iterationTeamBaselines.capturedAt,
      })
      .from(iterationTeamBaselines)
      .where(eq(iterationTeamBaselines.iterationId, iterationId));
    expect(first).toHaveLength(1);
    expect(Number(first[0].baseline)).toBe(8);
    expect(first[0].capturedAt).not.toBeNull();

    // Re-estimating after the iteration started must NOT move the Ideal line (IB §5), and a second
    // tick must not re-capture — `captureTeamBaselines` uses `onConflictDoNothing` per scope, which is
    // the same guarantee the old `IS NULL` predicate gave for a single column.
    await db.update(workItems).set({ updatedAt: new Date() }).where(eq(workItems.id, storyId));
    await snapshots.takeSnapshots();

    const second = await db
      .select({
        baseline: iterationTeamBaselines.totalTaskEstimateAtStart,
        capturedAt: iterationTeamBaselines.capturedAt,
      })
      .from(iterationTeamBaselines)
      .where(eq(iterationTeamBaselines.iterationId, iterationId));
    expect(second).toHaveLength(1);
    expect(Number(second[0].baseline)).toBe(8);
    expect(second[0].capturedAt?.getTime()).toBe(first[0].capturedAt?.getTime());

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

  it('serves a TEAM-scoped burndown from per-team snapshot rows', async () => {
    /**
     * Burndown is frozen history, so a team-scoped chart cannot be recomputed on read — the grain
     * has to carry the team. It was `(iteration, date)` with no team dimension at all, so a
     * team-scoped Burndown could not be served for a shared iteration and returned `missing` while
     * the same iteration's All Teams chart was full (IB §2).
     *
     * Each scope is MEASURED independently. The All Teams row is never the sum of the team rows,
     * because a task two teams both touch would then be counted twice.
     */
    const alpha = await newTeam('P6 Burndown Alpha');
    const beta = await newTeam('P6 Burndown Beta');
    await projects.linkTeam(WORKSPACE_ID, projectId, alpha);
    await projects.linkTeam(WORKSPACE_ID, projectId, beta);

    // One shared, team-less iteration holding one story per team, each with a task.
    const shared = await iterationsSvc.createIteration(admin, projectId, 'P6 Burndown Shared', {
      state: 'committed',
      startDate: shift(localToday, -2),
      endDate: shift(localToday, 4),
    });
    for (const [team, hours] of [
      [alpha, '6'],
      [beta, '4'],
    ] as const) {
      const story = await items.createWorkItem(admin, projectId, 'story', `P6 bd ${hours}h`, {
        iterationId: shared.id,
        teamId: team,
        storyPoints: '3',
      });
      await items.createTask(admin, story.id, `P6 bd task ${hours}`, {
        estimateHours: hours,
        todoHours: hours,
      });
    }

    await snapshots.takeSnapshots();

    const todayOf = (report: { points: Array<{ date: string; remainingToDo: number | null }> }) =>
      report.points.find((p) => p.date === localToday)?.remainingToDo;

    const all = await reporting.getIterationBurndown(admin, {
      projectId,
      iterationId: shared.id,
    });
    const alphaReport = await reporting.getIterationBurndown(admin, {
      projectId,
      iterationId: shared.id,
      teamId: alpha,
    });
    const betaReport = await reporting.getIterationBurndown(admin, {
      projectId,
      iterationId: shared.id,
      teamId: beta,
    });

    // Weekends are off the axis, so today may not be plotted — in which case the rows still had
    // to be WRITTEN per scope, which is the thing under test.
    if (all.points.some((p) => p.date === localToday)) {
      expect(todayOf(all)).toBe(10);
      expect(todayOf(alphaReport)).toBe(6);
      expect(todayOf(betaReport)).toBe(4);
    }

    const written = await db
      .select({
        teamId: iterationDailySnapshots.teamId,
        todo: iterationDailySnapshots.remainingTodo,
      })
      .from(iterationDailySnapshots)
      .where(
        and(
          eq(iterationDailySnapshots.iterationId, shared.id),
          eq(iterationDailySnapshots.snapshotDate, localToday),
        ),
      );
    // Three scopes: All Teams plus one row per team WITH work — never a row of zeros for a team
    // that never touched the iteration.
    expect(written).toHaveLength(3);
    expect(new Set(written.map((r) => r.teamId))).toEqual(new Set([null, alpha, beta]));
    expect(Number(written.find((r) => r.teamId === null)?.todo)).toBe(10);
    expect(Number(written.find((r) => r.teamId === alpha)?.todo)).toBe(6);

    // Idempotent per (iteration, team, date): a second tick rewrites, never duplicates.
    await snapshots.takeSnapshots();
    const again = await db
      .select({ id: iterationDailySnapshots.id })
      .from(iterationDailySnapshots)
      .where(
        and(
          eq(iterationDailySnapshots.iterationId, shared.id),
          eq(iterationDailySnapshots.snapshotDate, localToday),
        ),
      );
    expect(again).toHaveLength(3);

    /**
     * ── the Ideal BASELINE has the same team grain as the bars ──
     *
     * This is what migration 0098 fixed. The baseline used to be one column on `iterations`, so both
     * teams' charts were drawn against the project-wide 10 while Alpha's bars were 6 and Beta's 4.
     * IB §6 compares `remainingToDo(d)` with `ideal(d)`, so the indicator read "On track" for a team
     * that had burned nothing, and could not read "Behind plan" until a team exceeded every OTHER
     * team's estimate too.
     */
    const baselines = await db
      .select({
        teamId: iterationTeamBaselines.teamId,
        total: iterationTeamBaselines.totalTaskEstimateAtStart,
      })
      .from(iterationTeamBaselines)
      .where(eq(iterationTeamBaselines.iterationId, shared.id));
    // One row per team WITH work — and no All-Teams row, because §4 makes All Teams the SUM.
    expect(new Set(baselines.map((r) => r.teamId))).toEqual(new Set([alpha, beta]));
    expect(Number(baselines.find((r) => r.teamId === alpha)?.total)).toBe(6);
    expect(Number(baselines.find((r) => r.teamId === beta)?.total)).toBe(4);

    {
      const [allTeams, alphaReport, betaReport] = await Promise.all([
        reporting.getIterationBurndown(admin, { projectId, iterationId: shared.id }),
        reporting.getIterationBurndown(admin, {
          projectId,
          iterationId: shared.id,
          teamId: alpha,
        }),
        reporting.getIterationBurndown(admin, { projectId, iterationId: shared.id, teamId: beta }),
      ]);
      // Each team is measured against its OWN plan, and All Teams is the sum of the two (§4).
      expect(alphaReport.totalTaskEstimateAtStart).toBe(6);
      expect(betaReport.totalTaskEstimateAtStart).toBe(4);
      expect(allTeams.totalTaskEstimateAtStart).toBe(10);
    }
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

  it('resolves report:view from a per-Project access level, and only on that project', async () => {
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
     * The MECHANISM under test has since moved twice and the assertion moved with it: migration
     * 0109 removed `report:view` from the Editor tier (§5 makes Reports an Admin/WA surface), and
     * migration 0105 retired `scope_type='project'` role assignments in favour of
     * `work.project_members.access_level`. So this now grants `admin` on one project through the
     * real write path and asserts the code resolves there — and, the half the old version could not
     * express, that it does NOT resolve on a project the same user holds nothing on.
     */
    const access = app.get(AccessService);
    expect(ACCESS_LEVEL_PERMISSIONS.admin, 'Admin must carry report:view (§5)').toContain(
      'report:view',
    );
    expect(ACCESS_LEVEL_PERMISSIONS.editor, 'Editor must NOT (migration 0109)').not.toContain(
      'report:view',
    );

    /**
     * A workspace MEMBER row is required now, where the old project-scoped role assignment needed
     * none: `addProjectMember` runs `assertWorkspaceMember` first, the same rule that guards a
     * project's lead and a work item's assignee. That is the point of the model — project access is
     * granted to someone who is already in the company, not as a way of joining it.
     */
    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      email: `p6-report-reader-${userId.slice(0, 8)}@qnsc.dev`,
      displayName: 'P6 report reader',
    });
    await db.insert(workspaceMembers).values({
      workspaceId: WORKSPACE_ID,
      userId,
      status: 'active',
    });
    await grantProjectAccess(app, userId, projectId, 'admin');

    // The harness's own actor builder: the permission array on it is INERT (authorization
    // resolves from the database), so this is identity only — exactly what the guard passes.
    const reader = makeActor(userId);
    await expect(access.hasProjectPermission(reader, projectId, 'report:view')).resolves.toBe(true);

    // Scoped, not global: the same principal on the seed's second project has nothing.
    await expect(access.hasProjectPermission(reader, PAY_PROJECT_ID, 'report:view')).resolves.toBe(
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

  it("scopes a SHARED iteration by the WORK's team, not by the timebox", async () => {
    /**
     * The defect this exists for. Every report filtered `iterations.team_id`, and an iteration
     * only OPTIONALLY names a team — 195 of 206 in the local database name none — so selecting a
     * Team returned `iterationCount: 0`, empty bars and zero capacity while Team Status showed the
     * hours. Velocity meanwhile had no team predicate on the WORK at all, so whatever team the
     * timebox happened to name owned every point in it.
     *
     * Contract §3: "Selected Team — include only records belonging to that Team", and TC §3 scopes
     * tasks by the parent's team. So: the timebox says which window, the work says whose it is.
     */
    const alpha = await newTeam('P6 Alpha');
    const beta = await newTeam('P6 Beta');
    await projects.linkTeam(WORKSPACE_ID, projectId, alpha);
    await projects.linkTeam(WORKSPACE_ID, projectId, beta);

    // ONE shared, team-LESS iteration, already finished — the shape that used to return nothing.
    const shared = await iterationsSvc.createIteration(admin, projectId, 'P6 Shared Sprint', {
      state: 'committed',
      startDate: shift(localToday, -18),
      endDate: shift(localToday, -8),
    });

    for (const [team, points] of [
      [alpha, '5'],
      [beta, '3'],
    ] as const) {
      const story = await items.createWorkItem(admin, projectId, 'story', `P6 ${points}pt`, {
        iterationId: shared.id,
        teamId: team,
        storyPoints: points,
      });
      await items.updateWorkItem(admin, story.id, { scheduleState: 'accepted' });
      /**
       * Backdated INTO the window, because the trigger stamps `accepted_date` with now().
       *
       * Accepting today is `acceptedAfter` for a sprint that ended eight days ago — correctly, and
       * that is what this assertion first caught. During/After is a property of WHEN, so a During
       * fixture has to say when.
       */
      await db
        .update(workItems)
        .set({ acceptedDate: new Date(`${shift(localToday, -10)}T09:00:00Z`) })
        .where(eq(workItems.id, story.id));
    }

    const barFor = (report: { bars: Array<{ name: string; acceptedDuring: number }> }) =>
      report.bars.find((b) => b.name === 'P6 Shared Sprint');

    // All Teams: both teams' points, measured over one population.
    const all = await reporting.getVelocity(admin, { projectId, window: 10 });
    expect(barFor(all)?.acceptedDuring).toBe(8);

    // Each team sees ITS OWN points — not zero, and not the other team's.
    const alphaReport = await reporting.getVelocity(admin, {
      projectId,
      window: 10,
      teamId: alpha,
    });
    expect(barFor(alphaReport)?.acceptedDuring).toBe(5);
    const betaReport = await reporting.getVelocity(admin, { projectId, window: 10, teamId: beta });
    expect(barFor(betaReport)?.acceptedDuring).toBe(3);
  });

  it("reports capacity hours for a real team, and only that team's", async () => {
    /**
     * Capacity was never actually asserted: the existing projection test wrapped its
     * `updateCapacity` call in `if (teamId)` against a team-LESS fixture iteration, so the write
     * never ran and `totals.capacityHours` was never checked — TC §3's Capacity measure had no
     * end-to-end coverage at all.
     */
    const team = await newTeam('P6 Capacity');
    await projects.linkTeam(WORKSPACE_ID, projectId, team);
    const other = await newTeam('P6 Capacity Other');
    await projects.linkTeam(WORKSPACE_ID, projectId, other);

    await teamStatus.updateCapacity(admin, {
      projectId,
      teamId: team,
      iterationId,
      userId: ADMIN_USER_ID,
      capacityHours: 40,
    });

    const scoped = await reporting.getTeamCapacity(admin, { projectId, iterationId, teamId: team });
    expect(scoped.totals.capacityHours).toBe(40);
    expect(scoped.context.teamName).toContain('P6 Capacity');

    // The other team has no capacity record: an explicit zero, not the first team's hours.
    const otherReport = await reporting.getTeamCapacity(admin, {
      projectId,
      iterationId,
      teamId: other,
    });
    expect(otherReport.totals.capacityHours).toBe(0);
  });

  it('404s an unknown team instead of relabelling it All Teams', async () => {
    // `teamName ?? ALL_TEAMS_LABEL` claimed a project-wide aggregate while the queries stayed
    // narrowed to an id that matched nothing — a header that contradicted its own numbers.
    await expect(
      reporting.getVelocity(admin, { projectId, window: 5, teamId: randomUUID() }),
    ).rejects.toThrow(/TEAM_NOT_FOUND|not found/i);
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

  it('pages the active bucket without moving a summary count or a total', async () => {
    const release = await releases.createRelease(admin, projectId, 'P6 Release Paged', {
      startDate: shift(localToday, -5),
      releaseDate: shift(localToday, 5),
    });

    // Seven Features directly in the release, so a page size of 3 yields 3 pages.
    const created = [];
    for (let i = 1; i <= 7; i += 1) {
      created.push(
        await portfolio.createItem(admin, {
          projectId,
          type: 'feature',
          name: `Paged Feature ${i}`,
          releaseId: release.id,
        }),
      );
    }

    const unpaged = await reporting.getReleaseTracking(admin, {
      projectId,
      releaseId: release.id,
      bucket: 'direct',
      pageSize: 100,
    });
    expect(unpaged.rows).toHaveLength(7);

    const first = await reporting.getReleaseTracking(admin, {
      projectId,
      releaseId: release.id,
      bucket: 'direct',
      page: 1,
      pageSize: 3,
    });
    const last = await reporting.getReleaseTracking(admin, {
      projectId,
      releaseId: release.id,
      bucket: 'direct',
      page: 3,
      pageSize: 3,
    });

    expect(first.rows).toHaveLength(3);
    expect(last.rows).toHaveLength(1);
    expect(first.page).toEqual({ page: 1, pageSize: 3, total: 7, pageCount: 3 });

    // The whole point: a page bounds the ROWS, never the measured numbers. Classification and
    // the Preliminary total run over the full population before the slice is taken.
    expect(first.summary).toEqual(unpaged.summary);
    expect(first.summary.direct).toBe(7);
    expect(first.totals).toEqual(unpaged.totals);
    expect(last.summary).toEqual(unpaged.summary);
    expect(last.totals).toEqual(unpaged.totals);

    // Rank is the absolute position in the bucket, so page 3 continues at 7 rather than
    // restarting at 1 (RT-AC-04).
    expect(first.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(last.rows.map((r) => r.rank)).toEqual([7]);

    // Pages are disjoint and together cover the bucket exactly once.
    const second = await reporting.getReleaseTracking(admin, {
      projectId,
      releaseId: release.id,
      bucket: 'direct',
      page: 2,
      pageSize: 3,
    });
    const walked = [...first.rows, ...second.rows, ...last.rows].map((r) => r.id);
    expect(new Set(walked).size).toBe(7);
    expect(walked).toEqual(unpaged.rows.map((r) => r.id));

    // A stale page number past the end clamps to the last page instead of erroring — the row
    // count shifts under the reader as work is reassigned.
    const overshoot = await reporting.getReleaseTracking(admin, {
      projectId,
      releaseId: release.id,
      bucket: 'direct',
      page: 99,
      pageSize: 3,
    });
    expect(overshoot.page.page).toBe(3);
    expect(overshoot.rows.map((r) => r.id)).toEqual(last.rows.map((r) => r.id));
    expect(created).toHaveLength(7);
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
     * the same rule `captureTeamBaselines` enforces for the iteration baseline.
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

  it('captures the release Ideal target per TEAM, summed for All Teams', async () => {
    /**
     * The mirror of the baseline test above, for the Burnup.
     *
     * The target used to be two columns on `releases`, so it had no team dimension at all while
     * `getReleaseBurnupRows` correctly narrowed the measured series to the selected team: Alpha's 6
     * accepted points were drawn against the whole release's 10, and every team looked permanently
     * behind. RT §7's acceptance example 7 recomputes the entire Burnup from the selected Team's scope,
     * and the Ideal is inside that definition — so migration 0099 moved it to one row per (release,
     * team scope), like `iteration_team_baselines`.
     *
     * `team_id IS NULL` in this table is the MEASURED All Teams row, as in `release_daily_snapshots` and
     * unlike `iteration_team_baselines`: RT §4.1 measures All Teams because a Feature whose children
     * span two teams sits in both teams' derived buckets, so a sum would count it twice.
     */
    const alpha = await newTeam('P6 Burnup Alpha');
    const beta = await newTeam('P6 Burnup Beta');
    await projects.linkTeam(WORKSPACE_ID, projectId, alpha);
    await projects.linkTeam(WORKSPACE_ID, projectId, beta);

    const release = await releases.createRelease(admin, projectId, `P6 Release Targets`, {
      startDate: shift(localToday, -1),
      releaseDate: shift(localToday, 10),
    });
    for (const [team, points] of [
      [alpha, '6'],
      [beta, '4'],
    ] as const) {
      await items.createWorkItem(admin, projectId, 'story', `P6 bu ${points}pt`, {
        releaseId: release.id,
        teamId: team,
        storyPoints: points,
      });
    }

    await snapshots.takeSnapshots();

    const targets = await db
      .select({
        teamId: releaseTeamTargets.teamId,
        points: releaseTeamTargets.idealTargetPoints,
        count: releaseTeamTargets.idealTargetCount,
      })
      .from(releaseTeamTargets)
      .where(eq(releaseTeamTargets.releaseId, release.id));
    // One row per team WITH work, plus the measured All Teams row — three scopes, matching the three
    // snapshot rows written for the same day.
    expect(new Set(targets.map((r) => r.teamId))).toEqual(new Set([null, alpha, beta]));
    expect(Number(targets.find((r) => r.teamId === null)?.points)).toBe(10);
    expect(Number(targets.find((r) => r.teamId === alpha)?.points)).toBe(6);
    expect(targets.find((r) => r.teamId === alpha)?.count).toBe(1);
    expect(Number(targets.find((r) => r.teamId === beta)?.points)).toBe(4);

    const [allTeams, alphaReport, betaReport] = await Promise.all([
      reporting.getReleaseBurnup(admin, { projectId, releaseId: release.id }),
      reporting.getReleaseBurnup(admin, { projectId, releaseId: release.id, teamId: alpha }),
      reporting.getReleaseBurnup(admin, { projectId, releaseId: release.id, teamId: beta }),
    ]);
    // All Teams measured over the whole release — 10 — and each team races its own goal.
    expect(allTeams.idealTarget).toBe(10);
    expect(alphaReport.idealTarget).toBe(6);
    expect(betaReport.idealTarget).toBe(4);
    // The Ideal is actually plotted per scope, not merely reported in the header.
    expect(alphaReport.points.some((p) => p.ideal !== null)).toBe(true);

    // Item counts follow the same grain, because `Chart Unit` is a display switch over one population.
    const alphaByCount = await reporting.getReleaseBurnup(admin, {
      projectId,
      releaseId: release.id,
      teamId: alpha,
      unit: 'count',
    });
    expect(alphaByCount.idealTarget).toBe(1);

    /**
     * Capture-once PER SCOPE. Alpha's scope grows; a later tick must move neither Alpha's target nor
     * the All Teams sum that contains it (RT-BR-09).
     */
    await items.createWorkItem(admin, projectId, 'story', 'P6 bu alpha creep', {
      releaseId: release.id,
      teamId: alpha,
      storyPoints: '8',
    });
    await snapshots.takeSnapshots();

    const [allAfter, alphaAfter] = await Promise.all([
      reporting.getReleaseBurnup(admin, { projectId, releaseId: release.id }),
      reporting.getReleaseBurnup(admin, { projectId, releaseId: release.id, teamId: alpha }),
    ]);
    expect(alphaAfter.points.find((p) => p.date === localToday)?.planned).toBe(14);
    expect(alphaAfter.idealTarget).toBe(6);
    expect(allAfter.idealTarget).toBe(10);

    const rowsAgain = await db
      .select({ id: releaseTeamTargets.id })
      .from(releaseTeamTargets)
      .where(eq(releaseTeamTargets.releaseId, release.id));
    expect(rowsAgain).toHaveLength(3);
  });

  it('validates the SCOPE on the burnup route, which returns no context', async () => {
    /**
     * Four of the five report routes build a `context` and get the project/team existence checks with
     * it. `getReleaseBurnup` returns no context, so it skipped them entirely: an unknown `teamId`
     * narrowed every query to nothing and still answered 200, and a soft-deleted project served a
     * burnup. The release check it did have proves the release belongs to the project — not that the
     * project is still there.
     */
    const release = await releases.createRelease(admin, projectId, `Scope ${uniqueKey()}`, {
      startDate: localToday,
      releaseDate: shift(localToday, 7),
    });

    await expect(
      reporting.getReleaseBurnup(admin, {
        projectId,
        releaseId: release.id,
        teamId: randomUUID(),
      }),
    ).rejects.toThrow(/TEAM_NOT_FOUND|not found/i);

    // And an unknown project is refused before the release is even looked up.
    await expect(
      reporting.getReleaseBurnup(admin, { projectId: randomUUID(), releaseId: release.id }),
    ).rejects.toThrow(/PROJECT_NOT_FOUND|not found/i);
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
