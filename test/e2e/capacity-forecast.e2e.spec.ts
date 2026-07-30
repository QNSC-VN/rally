/**
 * Capacity forecast E2E — the history query, against real SQL.
 *
 * The Monte Carlo arithmetic is pure and covered by `capacity-forecast.spec.ts` (22 cases).
 * What only a database can prove is the SAMPLE SET, and every rule in it is a filter that a
 * unit test with hand-written samples would simply assume:
 *
 *   • ACCEPTED states only, not completed — the D1 distinction. Forecasting from `completed`
 *     would predict capacity from work nobody signed off.
 *   • attributed by the STORY's `team_id`, not the iteration's, so a shared iteration feeds
 *     each team that worked in it and a team-less iteration still counts.
 *   • FINISHED iterations only (`end_date < current_date`), so the sprint in flight does not
 *     enter as a half-empty sample and drag the forecast down.
 *   • inside the 52-week window, and scoped to the plan's project and workspace.
 *
 * Prereqs: docker deps up + `pnpm db:migrate` (see flow-harness).
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CapacityPlansService } from '@modules/capacity';
import { IterationsService } from '@modules/iterations';
import { ProjectsService } from '@modules/projects';
import { ReleasesService } from '@modules/releases';
import { WorkItemsService } from '@modules/work-items';
import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { teams } from '@db/schema/work';

import { WORKSPACE_ID, adminActor, bootRallyApp, uniqueKey } from './support/flow-harness';

/** `YYYY-MM-DD`, `days` before today. */
function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

describe('capacity forecast (e2e)', () => {
  let app: NestFastifyApplication;
  let capacity: CapacityPlansService;
  let iterations: IterationsService;
  let workItems: WorkItemsService;
  let projects: ProjectsService;
  let releases: ReleasesService;
  let db: DrizzleDB;

  const admin = adminActor();
  let projectId: string;
  let teamAId: string;
  let teamBId: string;
  let planId: string;

  async function newTeam(label: string): Promise<string> {
    const [row] = await db
      .insert(teams)
      .values({
        workspaceId: WORKSPACE_ID,
        name: `${label} ${uniqueKey()}`,
        key: uniqueKey('T'),
        status: 'active',
      })
      .returning({ id: teams.id });
    return row.id;
  }

  /**
   * A finished iteration holding one accepted story of `points` for `teamId`.
   *
   * The iteration itself is created WITHOUT a team, which is the harder case: attribution
   * has to come from the story.
   */
  async function finishedIteration(opts: {
    endedDaysAgo: number;
    lengthDays: number;
    teamId: string;
    points: number;
    scheduleState?: 'accepted' | 'completed' | 'in_progress';
  }): Promise<string> {
    const iteration = await iterations.createIteration(admin, projectId, `Sprint ${uniqueKey()}`, {
      startDate: daysAgo(opts.endedDaysAgo + opts.lengthDays - 1),
      endDate: daysAgo(opts.endedDaysAgo),
      state: 'accepted',
    });
    const story = await workItems.createWorkItem(admin, projectId, 'story', `S ${uniqueKey()}`, {
      storyPoints: String(opts.points),
    });
    await workItems.updateWorkItem(admin, story.id, {
      iterationId: iteration.id,
      teamId: opts.teamId,
      scheduleState: opts.scheduleState ?? 'accepted',
    });
    return iteration.id;
  }

  const forecast = (teamId: string) =>
    capacity.forecastTeamCapacity(admin, planId, teamId, {
      availabilityPct: 100,
      complexity: 'typical',
    });

  beforeAll(async () => {
    app = await bootRallyApp();
    capacity = app.get(CapacityPlansService);
    iterations = app.get(IterationsService);
    workItems = app.get(WorkItemsService);
    projects = app.get(ProjectsService);
    releases = app.get(ReleasesService);
    db = app.get<DrizzleDB>(DRIZZLE);

    const project = await projects.createProject(admin, {
      key: uniqueKey(),
      name: 'Forecast Project',
    });
    projectId = project.id;
    teamAId = await newTeam('Forecast A');
    teamBId = await newTeam('Forecast B');
    // A story's team must be LINKED to its project (`PROJECT_TEAM_LINK_NOT_FOUND`), so the
    // fixtures have to establish the link before any story can name a team.
    await projects.linkTeam(WORKSPACE_ID, projectId, teamAId);
    await projects.linkTeam(WORKSPACE_ID, projectId, teamBId);

    const release = await releases.createRelease(admin, projectId, `Rel ${uniqueKey()}`, {});
    const plan = await capacity.createPlan(admin, {
      projectId,
      releaseId: release.id,
      name: 'Forecast plan',
      unit: 'points',
      // A 28-day window: two iterations of the 14-day cadence the fixtures establish.
      plannedStartDate: daysAgo(-1),
      plannedEndDate: daysAgo(-28),
    });
    planId = plan.id;
    await capacity.addTeam(admin, planId, teamAId);
    await capacity.addTeam(admin, planId, teamBId);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports no history for a team that has finished nothing', async () => {
    // Asserted BEFORE any fixture exists for team B, so this is a genuine empty set rather
    // than a filter accidentally excluding everything.
    const result = await forecast(teamBId);
    expect(result.insufficientData).toBe('no_history');
    expect(result.samplesUsed).toBe(0);
    expect(result.median).toBe(0);
  });

  it('samples accepted work from finished iterations, attributed by the STORY’s team', async () => {
    // Three steady iterations of 20 points, all owned by team A through the story.
    for (const endedDaysAgo of [20, 40, 60]) {
      await finishedIteration({ endedDaysAgo, lengthDays: 14, teamId: teamAId, points: 20 });
    }

    const result = await forecast(teamAId);
    expect(result.samplesUsed).toBe(3);
    expect(result.historyDays).toBe(42);
    expect(result.insufficientData).toBeNull();
    // 28-day window ÷ 14-day cadence = 2 iterations at 20 points each.
    expect(result.iterationsModelled).toBe(2);
    expect(result.median).toBe(40);
  });

  it('does NOT credit team A with another team’s work in the same iteration', async () => {
    // The reason attribution follows the story: this iteration is shared, and only team B's
    // half belongs to team B.
    const before = await forecast(teamAId);

    const iteration = await iterations.createIteration(admin, projectId, `Shared ${uniqueKey()}`, {
      startDate: daysAgo(27),
      endDate: daysAgo(14),
      state: 'accepted',
    });
    const story = await workItems.createWorkItem(admin, projectId, 'story', `B ${uniqueKey()}`, {
      storyPoints: '13',
    });
    await workItems.updateWorkItem(admin, story.id, {
      iterationId: iteration.id,
      teamId: teamBId,
      scheduleState: 'accepted',
    });

    // Team A gained nothing.
    expect((await forecast(teamAId)).samplesUsed).toBe(before.samplesUsed);
    // Team B now has exactly that one iteration — 14 days, which is the minimum, so it
    // forecasts rather than refusing.
    const b = await forecast(teamBId);
    expect(b.samplesUsed).toBe(1);
    expect(b.insufficientData).toBeNull();
    expect(b.median).toBe(26); // 13 points × 2 iterations
  });

  it('ignores COMPLETED-but-unaccepted work — the D1 distinction, in SQL', async () => {
    const before = await forecast(teamAId);

    // `completed` is in COMPLETED_SCHEDULE_STATES but NOT in ACCEPTED_SCHEDULE_STATES.
    // Forecasting from it would predict capacity from work nobody signed off.
    await finishedIteration({
      endedDaysAgo: 30,
      lengthDays: 14,
      teamId: teamAId,
      points: 99,
      scheduleState: 'completed',
    });

    const after = await forecast(teamAId);
    expect(after.samplesUsed).toBe(before.samplesUsed);
    expect(after.median).toBe(before.median);
  });

  it('ignores the iteration currently IN FLIGHT', async () => {
    const before = await forecast(teamAId);

    // Ends in the future: a half-delivered sprint is not a velocity sample, and counting it
    // would drag every forecast down by however early in the sprint the planner looked.
    const live = await iterations.createIteration(admin, projectId, `Live ${uniqueKey()}`, {
      startDate: daysAgo(3),
      endDate: daysAgo(-10),
      state: 'committed',
    });
    const story = await workItems.createWorkItem(admin, projectId, 'story', `L ${uniqueKey()}`, {
      storyPoints: '2',
    });
    await workItems.updateWorkItem(admin, story.id, {
      iterationId: live.id,
      teamId: teamAId,
      scheduleState: 'accepted',
    });

    expect((await forecast(teamAId)).samplesUsed).toBe(before.samplesUsed);
  });

  it('ignores history older than 52 weeks', async () => {
    const before = await forecast(teamAId);

    await finishedIteration({
      endedDaysAgo: 500,
      lengthDays: 14,
      teamId: teamAId,
      points: 80,
    });

    expect((await forecast(teamAId)).samplesUsed).toBe(before.samplesUsed);
  });

  it('is deterministic across calls on unchanged history', async () => {
    // Seeded from (plan, team) rather than from a clock or Math.random, so a planner who
    // reruns the forecast sees the same number.
    expect(await forecast(teamAId)).toEqual(await forecast(teamAId));
  });

  it('scales by availability and complexity, and never goes negative', async () => {
    const base = await capacity.forecastTeamCapacity(admin, planId, teamAId, {
      availabilityPct: 100,
      complexity: 'typical',
    });
    const halved = await capacity.forecastTeamCapacity(admin, planId, teamAId, {
      availabilityPct: 50,
      complexity: 'many_unknowns',
    });

    // Half the team on work with many unknowns: base × 0.5 × 0.5.
    expect(halved.median).toBeCloseTo(base.median * 0.25, 1);
    expect(halved.median).toBeGreaterThanOrEqual(0);
  });

  it('refuses a team that is not on the plan', async () => {
    const stranger = await newTeam('Not on plan');
    await expect(forecast(stranger)).rejects.toMatchObject({ code: 'CAPACITY_TEAM_NOT_FOUND' });
  });
});
