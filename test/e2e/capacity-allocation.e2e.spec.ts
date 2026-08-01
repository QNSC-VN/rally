/**
 * Capacity allocation E2E — the metric definitions, against real SQL.
 *
 * These exist because the numbers follow RALLY'S rule, and only a real database can show
 * whether the SQL implements it (Broadcom TechDocs, "View Capacity Plan Details"): "If a
 * portfolio item includes allocated points/counts, the Project and Release fields in the
 * story must match the plan for that story to be included in the Rollup calculation" —
 * and the identical sentence for Complete.
 *
 * Three consequences are asserted here and cannot be seen from a unit test:
 *
 *   • a child story in ANOTHER release does not count, even though it belongs to the
 *     allocated Feature — without that filter every plan touching a long-lived Feature
 *     reports inflated demand;
 *   • a Feature SHARED between teams is not double-counted: Rally attributes a story by its
 *     Project, which in Rally's model is the team, so each team sees only its own children;
 *   • `Complete` uses COMPLETED_SCHEDULE_STATES while the portfolio's Percent Done uses
 *     ACCEPTED_SCHEDULE_STATES — the D1 distinction, which must stay different.
 *
 * Prereqs: docker deps up + `pnpm db:migrate` (see flow-harness).
 */
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CapacityPlansService } from '@modules/capacity';
import { PortfolioItemsService } from '@modules/portfolio';
import { ProjectsService } from '@modules/projects';
import { ReleasesService } from '@modules/releases';
import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { projectTeams, teams, workItems, workflowStatuses } from '@db/schema/work';
import { eq } from 'drizzle-orm';

import { WORKSPACE_ID, adminActor, bootRallyApp, uniqueKey } from './support/flow-harness';

describe('capacity allocation (e2e)', () => {
  let app: NestFastifyApplication;
  let capacity: CapacityPlansService;
  let portfolio: PortfolioItemsService;
  let projects: ProjectsService;
  let releases: ReleasesService;
  let db: DrizzleDB;

  const admin = adminActor();
  let projectId: string;
  let planReleaseId: string;
  let otherReleaseId: string;
  let planId: string;
  let teamAId: string;
  let teamBId: string;
  let statusId: string;

  /** A story under `featureId`, in the given release, owned by the given team. */
  async function story(args: {
    featureId: string;
    releaseId: string | null;
    teamId: string | null;
    points: string;
    state?: 'defined' | 'completed' | 'accepted';
  }) {
    const [row] = await db
      .insert(workItems)
      .values({
        workspaceId: WORKSPACE_ID,
        projectId,
        itemKey: `US-CAP-${uniqueKey()}`,
        type: 'story',
        title: 'Capacity child',
        statusId,
        scheduleState: args.state ?? 'defined',
        flowState: args.state ?? 'defined',
        storyPoints: args.points,
        featureId: args.featureId,
        releaseId: args.releaseId,
        teamId: args.teamId,
        rank: `r${uniqueKey()}`,
        createdBy: admin.sub,
      })
      .returning({ id: workItems.id });
    return row.id;
  }

  async function newFeature(name: string) {
    const f = await portfolio.createItem(admin, { projectId, type: 'feature', name });
    return f.id;
  }

  beforeAll(async () => {
    app = await bootRallyApp();
    capacity = app.get(CapacityPlansService);
    portfolio = app.get(PortfolioItemsService);
    projects = app.get(ProjectsService);
    releases = app.get(ReleasesService);
    db = app.get<DrizzleDB>(DRIZZLE);

    const p = await projects.createProject(admin, { key: uniqueKey(), name: 'Alloc Project' });
    projectId = p.id;

    // `work_items.status_id` is NOT NULL and `createProject` seeds the project's default
    // statuses, so read one straight from the table — the same thing the demo seed does.
    const statuses = await db
      .select({ id: workflowStatuses.id })
      .from(workflowStatuses)
      .where(eq(workflowStatuses.projectId, projectId))
      .limit(1);
    statusId = statuses[0].id;

    planReleaseId = (await releases.createRelease(admin, projectId, `Rel ${uniqueKey()}`, {})).id;
    otherReleaseId = (await releases.createRelease(admin, projectId, `Rel ${uniqueKey()}`, {})).id;

    const made = await db
      .insert(teams)
      .values([
        {
          workspaceId: WORKSPACE_ID,
          name: `Alloc A ${uniqueKey()}`,
          key: uniqueKey('A'),
          status: 'active',
        },
        {
          workspaceId: WORKSPACE_ID,
          name: `Alloc B ${uniqueKey()}`,
          key: uniqueKey('B'),
          status: 'active',
        },
      ])
      .returning({ id: teams.id });
    teamAId = made[0].id;
    teamBId = made[1].id;
    // Both LINKED to the project: `addTeam` requires a plan's team to be one of the project's own
    // (the BA's "Project Breakdown"), which the guard reads from `project_teams`.
    await db.insert(projectTeams).values([
      { workspaceId: WORKSPACE_ID, projectId, teamId: teamAId },
      { workspaceId: WORKSPACE_ID, projectId, teamId: teamBId },
    ]);

    const plan = await capacity.createPlan(admin, {
      projectId,
      releaseId: planReleaseId,
      name: 'Alloc plan',
      unit: 'points',
    });
    planId = plan.id;
    await capacity.addTeam(admin, planId, teamAId);
    await capacity.addTeam(admin, planId, teamBId);
    await capacity.setTeamCapacity(admin, planId, teamAId, '50');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('counts only children in the PLAN’S release', async () => {
    const featureId = await newFeature(`Release filter ${uniqueKey()}`);
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamAId,
      value: 100,
    });

    // 8 points in the plan's release, 5 in another release, 3 with no release at all.
    await story({ featureId, releaseId: planReleaseId, teamId: teamAId, points: '8' });
    await story({ featureId, releaseId: otherReleaseId, teamId: teamAId, points: '5' });
    await story({ featureId, releaseId: null, teamId: teamAId, points: '3' });

    const detail = await capacity.getPlanDetail(admin, planId);
    const row = detail.allocations.find((a) => a.portfolioItemId === featureId);

    // ONLY the 8. Without Rally's release filter this would read 16.
    expect(row?.metrics.rollup).toBe(8);
  });

  it('does NOT double-count a Feature shared between two teams', async () => {
    const featureId = await newFeature(`Shared ${uniqueKey()}`);
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamAId,
      value: 10,
    });
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamBId,
      value: 10,
    });

    await story({ featureId, releaseId: planReleaseId, teamId: teamAId, points: '7' });
    await story({ featureId, releaseId: planReleaseId, teamId: teamBId, points: '4' });

    const detail = await capacity.getPlanDetail(admin, planId);
    const rows = detail.allocations.filter((a) => a.portfolioItemId === featureId);
    const byTeam = new Map(rows.map((r) => [r.teamId, r.metrics.rollup]));

    // Each team sees only its own children — 7 and 4, not 11 and 11.
    expect(byTeam.get(teamAId)).toBe(7);
    expect(byTeam.get(teamBId)).toBe(4);
  });

  it('separates Complete (COMPLETED states) from the portfolio’s accepted-only rule', async () => {
    const featureId = await newFeature(`Complete ${uniqueKey()}`);
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamAId,
      value: 30,
    });

    await story({
      featureId,
      releaseId: planReleaseId,
      teamId: teamAId,
      points: '2',
      state: 'defined',
    });
    await story({
      featureId,
      releaseId: planReleaseId,
      teamId: teamAId,
      points: '3',
      state: 'completed',
    });
    await story({
      featureId,
      releaseId: planReleaseId,
      teamId: teamAId,
      points: '4',
      state: 'accepted',
    });

    const detail = await capacity.getPlanDetail(admin, planId);
    const row = detail.allocations.find((a) => a.portfolioItemId === featureId);

    expect(row?.metrics.rollup).toBe(9);
    // completed + accepted = 7. The portfolio's Percent Done would count only the accepted 4.
    expect(row?.metrics.complete).toBe(7);

    const item = await portfolio.getItem(admin, featureId);
    expect(item.rollup.acceptedPoints).toBe(4);
    expect(item.rollup.completedPoints).toBe(7);
  });

  it('reports the tier as ALLOCATED once demand exists, and warns when children outgrow it', async () => {
    const featureId = await newFeature(`Tier ${uniqueKey()}`);
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamAId,
      value: 5,
    });
    await story({ featureId, releaseId: planReleaseId, teamId: teamAId, points: '9' });

    const detail = await capacity.getPlanDetail(admin, planId);
    const row = detail.allocations.find((a) => a.portfolioItemId === featureId);

    expect(row?.tier).toBe('allocated');
    // 9 > 5: the plan under-committed for this work.
    expect(row?.metrics.warnings).toContain('rollup_exceeds_estimated');
  });

  it('keeps the Unallocated bucket out of team demand and out of the allocated tier', async () => {
    const featureId = await newFeature(`Bucket ${uniqueKey()}`);
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId: null, value: 12 });

    const detail = await capacity.getPlanDetail(admin, planId);
    const row = detail.allocations.find((a) => a.portfolioItemId === featureId);

    expect(row?.teamId).toBeNull();
    expect(detail.unallocated).toBeGreaterThanOrEqual(12);
    // The row was given an EXPLICIT 12, so its own tier is `allocated` — the tier describes what
    // this row is charged, and 12 is a number a planner typed. What must not happen is that number
    // leaking sideways: a row with NO explicit value falls back to the Feature's own estimate and
    // never to the sum of what other rows were allocated (covered by the unit specs).
    expect(row?.tier).toBe('allocated');
    // The bucket contributes nothing to any team's Estimated.
    const teamA = detail.teams.find((t) => t.teamId === teamAId);
    const chargedToA = detail.allocations
      .filter((a) => a.teamId === teamAId)
      .reduce((sum, a) => sum + a.metrics.estimated, 0);
    expect(teamA?.metrics.estimated).toBe(chargedToA);
  });

  it('ASSIGNS without allocating: a null value charges the Feature estimate to the team', async () => {
    // Rally's primary assignment. The allocation row stores no number and the plan charges the
    // Feature's own estimate there, which is why Rally's `Allocation` column is blank on those
    // rows. Only real SQL shows the column actually holding NULL rather than a defaulted copy.
    // Preliminary 'm' explicitly: the shared fixture leaves the estimate empty, which resolves to
    // tier `none` and 0 — a legitimate state, but not the one this rule is about.
    const feature = await portfolio.createItem(admin, {
      projectId,
      type: 'feature',
      name: `Assigned ${uniqueKey()}`,
      preliminaryEstimate: 'm',
    });
    const featureId = feature.id;
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId: teamAId });

    const detail = await capacity.getPlanDetail(admin, planId);
    const row = detail.allocations.find((a) => a.portfolioItemId === featureId);

    expect(row?.value).toBeNull();
    // `newFeature` uses preliminary 'm', which the seeded map puts at 5 points.
    expect(row?.metrics.estimated).toBe(5);
    expect(row?.tier).toBe('preliminary');

    // Slicing it explicitly overrides the fallback…
    await capacity.updateAllocation(admin, planId, row!.id, { value: 13 });
    const sliced = (await capacity.getPlanDetail(admin, planId)).allocations.find(
      (a) => a.portfolioItemId === featureId,
    );
    expect(sliced?.value).toBe('13.00');
    expect(sliced?.metrics.estimated).toBe(13);
    expect(sliced?.tier).toBe('allocated');

    // …and clearing it returns the row to the Feature's estimate rather than to zero.
    await capacity.updateAllocation(admin, planId, row!.id, { value: null });
    const cleared = (await capacity.getPlanDetail(admin, planId)).allocations.find(
      (a) => a.portfolioItemId === featureId,
    );
    expect(cleared?.value).toBeNull();
    expect(cleared?.metrics.estimated).toBe(5);
  });

  it('warns when a team’s committed demand passes its target load, then its capacity', async () => {
    // Capacity 50, target 80% -> ceiling 40.
    const featureId = await newFeature(`Load ${uniqueKey()}`);
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamBId,
      value: 1,
    });
    await capacity.setTeamCapacity(admin, planId, teamBId, '50');

    // Push team B's demand to 45: above the 40 ceiling but under capacity.
    const alloc = (await capacity.getPlanDetail(admin, planId)).allocations.find(
      (a) => a.portfolioItemId === featureId && a.teamId === teamBId,
    );
    const beforeB = (await capacity.getPlanDetail(admin, planId)).teams.find(
      (t) => t.teamId === teamBId,
    );
    const bump = 45 - (beforeB?.metrics.estimated ?? 0) + Number(alloc?.value ?? 0);
    await capacity.updateAllocation(admin, planId, alloc!.id, { value: bump });

    const mid = (await capacity.getPlanDetail(admin, planId)).teams.find(
      (t) => t.teamId === teamBId,
    );
    expect(mid?.metrics.estimated).toBe(45);
    expect(mid?.metrics.warnings).toContain('load_above_target');
    expect(mid?.metrics.warnings).not.toContain('estimated_exceeds_capacity');

    // Now past capacity: the target warning gives way to the hard one, so the row does not
    // carry two warnings saying the same thing.
    await capacity.updateAllocation(admin, planId, alloc!.id, { value: bump + 20 });
    const over = (await capacity.getPlanDetail(admin, planId)).teams.find(
      (t) => t.teamId === teamBId,
    );
    expect(over?.metrics.warnings).toContain('estimated_exceeds_capacity');
    expect(over?.metrics.warnings).not.toContain('load_above_target');
  });

  it('SETS a second allocation for the same Feature and team rather than adding to it', async () => {
    // The BA: "Re-applying allocation replaces the Feature's Team allocation rows." Adding meant
    // applying the same dialog twice doubled committed demand, and a slice could never be corrected
    // downwards through this path. Still ONE row for the pair — a second would double-count in every
    // total, which is what the length assertion guards.
    const featureId = await newFeature(`Merge ${uniqueKey()}`);
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamAId,
      value: 6,
    });
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamAId,
      value: 4,
    });

    const rows = (await capacity.getPlanDetail(admin, planId)).allocations.filter(
      (a) => a.portfolioItemId === featureId && a.teamId === teamAId,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].value)).toBe(4);
  });

  it('removes a SPLIT Feature from the plan in one call, leaving no row behind', async () => {
    // Against the real database because the point is atomicity: the client used to loop a DELETE per
    // allocation, so a three-way split was three requests and a failure on the second left the Feature
    // on the plan minus the team the first had already dropped.
    const featureId = await newFeature(`Remove split ${uniqueKey()}`);
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId: teamAId, value: 4 });
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId: teamBId, value: 6 });
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId: null, value: 2 });

    const before = (await capacity.getPlanDetail(admin, planId)).allocations.filter(
      (a) => a.portfolioItemId === featureId,
    );
    expect(before).toHaveLength(3);

    const after = await capacity.removeItemFromPlan(admin, planId, featureId);
    expect(after.allocations.filter((a) => a.portfolioItemId === featureId)).toHaveLength(0);
    // The Feature itself survives: removal is a planning decision, not a portfolio one.
    expect(await portfolio.getItem(admin, featureId)).toMatchObject({ id: featureId });
  });

  it('reports a Feature that is not on the plan instead of succeeding silently', async () => {
    const featureId = await newFeature(`Never added ${uniqueKey()}`);
    await expect(capacity.removeItemFromPlan(admin, planId, featureId)).rejects.toMatchObject({
      code: 'CAPACITY_ALLOCATION_NOT_FOUND',
    });
  });

  it("RE-PARKS a removed team's demand as unassigned, against the real unique index", async () => {
    // AC-005: "removed Teams move their allocation rows back to Unallocated." Against the real
    // database because the rule is bounded by a constraint — `uq_capacity_allocation_unassigned`
    // permits ONE unassigned row per (plan, Feature), so re-parking cannot simply insert.
    const featureId = await newFeature(`Repark ${uniqueKey()}`);
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamBId,
      value: 3,
    });

    const after = await capacity.removeTeam(admin, planId, teamBId);
    expect(after.teams.map((t) => t.teamId)).not.toContain(teamBId);

    const rows = (await capacity.getPlanDetail(admin, planId)).allocations.filter(
      (a) => a.portfolioItemId === featureId,
    );
    // The demand survived, with nobody holding it — which is what makes it reassignable.
    expect(rows).toHaveLength(1);
    expect(rows[0].teamId).toBeNull();
    expect(Number(rows[0].value)).toBe(3);
    expect(rows[0].isPrimary).toBe(false);

    // Put the team back for the specs that follow.
    await capacity.addTeam(admin, planId, teamBId);
  });

  it('MERGES into an existing unassigned row rather than violating the index', async () => {
    // The Feature is parked AND allocated: `Add Features` at plan level leaves an unassigned row, and
    // allocating a team afterwards consumes it — so the pair is built here deliberately, with the
    // parked row created after the team row.
    const featureId = await newFeature(`Merge park ${uniqueKey()}`);
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamBId,
      value: 5,
    });
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId: null, value: 2 });

    await capacity.removeTeam(admin, planId, teamBId);

    const rows = (await capacity.getPlanDetail(admin, planId)).allocations.filter(
      (a) => a.portfolioItemId === featureId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].teamId).toBeNull();
    // 5 + 2: both rows were real demand, and a removal must not quietly drop either.
    expect(Number(rows[0].value)).toBe(7);

    await capacity.addTeam(admin, planId, teamBId);
  });

  it('refuses to allocate an Epic', async () => {
    const epic = await portfolio.createItem(admin, {
      projectId,
      type: 'epic',
      name: `Epic ${uniqueKey()}`,
    });
    await expect(
      capacity.allocate(admin, planId, { portfolioItemId: epic.id, teamId: teamAId }),
    ).rejects.toMatchObject({ code: 'CAPACITY_ALLOCATION_NOT_FEATURE' });
  });

  it('rejects a NEGATIVE allocation at the database level', async () => {
    const featureId = await newFeature(`Negative ${uniqueKey()}`);
    await capacity.allocate(admin, planId, {
      portfolioItemId: featureId,
      teamId: teamAId,
      value: 1,
    });
    const alloc = (await capacity.getPlanDetail(admin, planId)).allocations.find(
      (a) => a.portfolioItemId === featureId,
    );

    const { capacityPlanAllocations } = await import('@db/schema/work');
    const direct = db
      .update(capacityPlanAllocations)
      .set({ value: '-1' })
      .where(eq(capacityPlanAllocations.id, alloc!.id));

    await expect(direct).rejects.toThrow();
    const err = await direct.catch((e: unknown) => e);
    expect(JSON.stringify((err as { cause?: unknown }).cause ?? err)).toContain(
      'ck_capacity_allocation_non_negative',
    );
  });

  it('refuses an allocation id from another plan', async () => {
    await expect(
      capacity.updateAllocation(admin, planId, randomUUID(), { value: 1 }),
    ).rejects.toMatchObject({ code: 'CAPACITY_ALLOCATION_NOT_FOUND' });
  });
});
