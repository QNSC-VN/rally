/**
 * Capacity publish E2E — the one write in Phase 5 that reaches outside its own tables.
 *
 * Real SQL because the whole point is what lands on `work.portfolio_items`, and nothing else
 * can prove it:
 *
 *   • the plan's window is written onto every ASSIGNED Feature, and the Release only when the
 *     window does not span outside the release (Rally's rule);
 *   • "Publish Without Updating Fields" leaves every column untouched;
 *   • revert does NOT roll the written values back — Rally's documented behaviour, and the
 *     one that would be most damaging to assume the other way round;
 *   • the status flip and the field writes share one transaction.
 *
 * Prereqs: docker deps up + `pnpm db:migrate` (see flow-harness).
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { CapacityPlansService } from '@modules/capacity';
import { PortfolioItemsService } from '@modules/portfolio';
import { ProjectsService } from '@modules/projects';
import { ReleasesService } from '@modules/releases';
import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { portfolioItems, teams } from '@db/schema/work';

import { WORKSPACE_ID, adminActor, bootRallyApp, uniqueKey } from './support/flow-harness';

describe('capacity publish (e2e)', () => {
  let app: NestFastifyApplication;
  let capacity: CapacityPlansService;
  let portfolio: PortfolioItemsService;
  let projects: ProjectsService;
  let releases: ReleasesService;
  let db: DrizzleDB;

  const admin = adminActor();
  let projectId: string;
  let teamId: string;

  /** The Feature's stored Release and planned window, read straight from the table. */
  async function featureRow(id: string) {
    const rows = await db
      .select({
        releaseId: portfolioItems.releaseId,
        plannedStartDate: portfolioItems.plannedStartDate,
        plannedEndDate: portfolioItems.plannedEndDate,
      })
      .from(portfolioItems)
      .where(eq(portfolioItems.id, id))
      .limit(1);
    return rows[0];
  }

  async function newFeature(): Promise<string> {
    const item = await portfolio.createItem(admin, {
      projectId,
      type: 'feature',
      name: `FE ${uniqueKey()}`,
      preliminaryEstimate: 'm',
    });
    return item.id;
  }

  /**
   * A fresh plan on a fresh release — a release may hold only one plan, so every test that
   * publishes needs its own, and `plannedStartDate`/`plannedEndDate` are what the publish
   * writes.
   */
  async function newPlan(window: { start: string | null; end: string | null }) {
    const release = await releases.createRelease(admin, projectId, `Rel ${uniqueKey()}`, {
      startDate: '2026-07-01',
      releaseDate: '2026-07-31',
    });
    const plan = await capacity.createPlan(admin, {
      projectId,
      releaseId: release.id,
      name: `Plan ${uniqueKey()}`,
      unit: 'points',
      plannedStartDate: window.start,
      plannedEndDate: window.end,
    });
    await capacity.addTeam(admin, plan.id, teamId);
    return { planId: plan.id, releaseId: release.id };
  }

  beforeAll(async () => {
    app = await bootRallyApp();
    capacity = app.get(CapacityPlansService);
    portfolio = app.get(PortfolioItemsService);
    projects = app.get(ProjectsService);
    releases = app.get(ReleasesService);
    db = app.get<DrizzleDB>(DRIZZLE);

    const project = await projects.createProject(admin, {
      key: uniqueKey(),
      name: 'Publish Project',
    });
    projectId = project.id;

    const [team] = await db
      .insert(teams)
      .values({
        workspaceId: WORKSPACE_ID,
        name: `Publish Team ${uniqueKey()}`,
        key: uniqueKey('T'),
        status: 'active',
      })
      .returning({ id: teams.id });
    teamId = team.id;
    await projects.linkTeam(WORKSPACE_ID, projectId, teamId);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('writes the window AND the Release onto an assigned Feature', async () => {
    const { planId, releaseId } = await newPlan({ start: '2026-07-05', end: '2026-07-20' });
    const featureId = await newFeature();
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId, value: 20 });

    // Untouched before the publish, so the assertion below cannot pass by accident.
    expect((await featureRow(featureId)).releaseId).toBeNull();

    const result = await capacity.publishPlan(admin, planId, { updateFields: true });

    expect(result.plan.status).toBe('published');
    expect(result.featuresUpdated).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(await featureRow(featureId)).toEqual({
      releaseId,
      plannedStartDate: '2026-07-05',
      plannedEndDate: '2026-07-20',
    });
  });

  it('writes the DATES ONLY when the plan window reaches outside its release', async () => {
    // Rally: "The Release field is only updated when the start and end dates do not span
    // releases." The dates still land — the Phase 5 spec had this as an all-or-nothing skip.
    const { planId } = await newPlan({ start: '2026-06-01', end: '2026-08-31' });
    const featureId = await newFeature();
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId, value: 20 });

    const result = await capacity.publishPlan(admin, planId, { updateFields: true });

    const row = await featureRow(featureId);
    expect(row.plannedStartDate).toBe('2026-06-01');
    expect(row.plannedEndDate).toBe('2026-08-31');
    expect(row.releaseId).toBeNull();
    expect(result.skipped).toEqual([
      {
        portfolioItemId: featureId,
        itemKey: expect.stringMatching(/^FE-/),
        reason: 'release_span_mismatch',
      },
    ]);
  });

  it('leaves an UNALLOCATED Feature alone and reports it', async () => {
    const { planId } = await newPlan({ start: '2026-07-05', end: '2026-07-20' });
    const featureId = await newFeature();
    // teamId null = the Unallocated bucket: no team, so no plan to inherit.
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId: null, value: 20 });

    const result = await capacity.publishPlan(admin, planId, { updateFields: true });

    expect(await featureRow(featureId)).toEqual({
      releaseId: null,
      plannedStartDate: null,
      plannedEndDate: null,
    });
    expect(result.featuresUpdated).toBe(0);
    expect(result.skipped[0].reason).toBe('unallocated');
  });

  it('touches nothing at all for "Publish Without Updating Fields"', async () => {
    const { planId } = await newPlan({ start: '2026-07-05', end: '2026-07-20' });
    const featureId = await newFeature();
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId, value: 20 });

    const result = await capacity.publishPlan(admin, planId, { updateFields: false });

    expect(result.plan.status).toBe('published');
    expect(result.fieldsUpdated).toBe(false);
    expect(await featureRow(featureId)).toEqual({
      releaseId: null,
      plannedStartDate: null,
      plannedEndDate: null,
    });
  });

  it('does NOT roll written values back on revert — the dangerous assumption, pinned', async () => {
    // Rally: "No changes are made to the field values in the portfolio items." Anyone reading
    // "revert" as an undo would build a UI that lies about what just happened.
    const { planId, releaseId } = await newPlan({ start: '2026-07-05', end: '2026-07-20' });
    const featureId = await newFeature();
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId, value: 20 });
    await capacity.publishPlan(admin, planId, { updateFields: true });

    const result = await capacity.revertPlan(admin, planId);

    expect(result.plan.status).toBe('draft');
    expect(result.fieldsRolledBack).toBe(false);
    // Still carrying everything the publish wrote.
    expect(await featureRow(featureId)).toEqual({
      releaseId,
      plannedStartDate: '2026-07-05',
      plannedEndDate: '2026-07-20',
    });
  });

  it('re-publishes after a revert, and a reverted plan is editable again', async () => {
    const { planId } = await newPlan({ start: '2026-07-05', end: '2026-07-20' });
    const featureId = await newFeature();
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId, value: 20 });
    await capacity.publishPlan(admin, planId, { updateFields: true });
    await capacity.revertPlan(admin, planId);

    // A draft again, so a write that `requireDraft` guards is allowed.
    await capacity.setTeamCapacity(admin, planId, teamId, '40');
    await expect(
      capacity.publishPlan(admin, planId, { updateFields: true }),
    ).resolves.toMatchObject({ featuresUpdated: 1 });
  });

  it('refuses a plan with no dates to write, but still publishes it', async () => {
    // No window means nothing to inherit and no span question to answer, so the Release is
    // skipped too — but visibility is still a legitimate thing to publish for.
    const { planId } = await newPlan({ start: null, end: null });
    const featureId = await newFeature();
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId, value: 20 });

    const result = await capacity.publishPlan(admin, planId, { updateFields: true });

    expect(result.plan.status).toBe('published');
    expect(result.skipped[0].reason).toBe('release_span_mismatch');
    expect(await featureRow(featureId)).toEqual({
      releaseId: null,
      plannedStartDate: null,
      plannedEndDate: null,
    });
  });

  it('refuses to publish an empty plan that has never been published', async () => {
    const release = await releases.createRelease(admin, projectId, `Rel ${uniqueKey()}`, {});
    const plan = await capacity.createPlan(admin, {
      projectId,
      releaseId: release.id,
      name: `Empty ${uniqueKey()}`,
      unit: 'points',
    });

    await expect(
      capacity.publishPlan(admin, plan.id, { updateFields: true }),
    ).rejects.toMatchObject({ code: 'CAPACITY_PLAN_EMPTY' });
  });

  it('refuses every draft-only write while published, and refuses a second publish', async () => {
    const { planId } = await newPlan({ start: '2026-07-05', end: '2026-07-20' });
    const featureId = await newFeature();
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId, value: 20 });
    await capacity.publishPlan(admin, planId, { updateFields: true });

    await expect(capacity.setTeamCapacity(admin, planId, teamId, '40')).rejects.toMatchObject({
      code: 'CAPACITY_PLAN_NOT_DRAFT',
    });
    await expect(capacity.publishPlan(admin, planId, { updateFields: true })).rejects.toMatchObject(
      { code: 'CAPACITY_PLAN_NOT_DRAFT' },
    );
  });

  it('stamps who published, and keeps the stamp through a revert', async () => {
    // `published_at` surviving a revert is what allows re-publishing an emptied plan.
    const { planId } = await newPlan({ start: '2026-07-05', end: '2026-07-20' });
    const featureId = await newFeature();
    await capacity.allocate(admin, planId, { portfolioItemId: featureId, teamId, value: 20 });

    const published = await capacity.publishPlan(admin, planId, { updateFields: true });
    expect(published.plan.publishedAt).not.toBeNull();
    expect(published.plan.publishedBy).toBe(admin.sub);

    const reverted = await capacity.revertPlan(admin, planId);
    expect(reverted.plan.publishedAt).not.toBeNull();
  });
});
