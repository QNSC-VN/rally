/**
 * Two rules the BA states as INVARIANTS, held against writes that used to bypass them.
 *
 * Both were specified as conditions rather than as event hooks, and both were implemented as hooks on
 * one particular write — so a different write reaching the same state left the rule unsatisfied:
 *
 *   • "A non-empty Iteration auto-changes to `Accepted` when all ASSIGNED Story/Defect items are
 *     `Accepted`" (BUSINESS_BASELINE:12, BR-IT-02). Keyed on *assigned* — which a scope change alters.
 *   • "Target Start Date EQUALS the earliest `startDate` among linked Releases and Target End Date
 *     EQUALS the latest `releaseDate`" (P3-MS-FR-011/012, Milestones SRS §73). An equality, not a
 *     recalculation step.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { WorkItemsService } from '@modules/work-items';
import { IterationsService } from '@modules/iterations';
import { MilestonesService } from '@modules/milestones';
import { ReleasesService } from '@modules/releases';

import { SEEDED, ALL, adminActor, bootRallyApp, uniqueKey } from './support/flow-harness';

describe('derived invariants (e2e)', () => {
  let app: NestFastifyApplication;
  let db: DrizzleDB;
  let items: WorkItemsService;
  let iterations: IterationsService;
  let milestones: MilestonesService;
  let releases: ReleasesService;
  const actor = adminActor();

  beforeAll(async () => {
    app = await bootRallyApp();
    db = app.get<DrizzleDB>(DRIZZLE);
    items = app.get(WorkItemsService);
    iterations = app.get(IterationsService);
    milestones = app.get(MilestonesService);
    releases = app.get(ReleasesService);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function iterationState(id: string): Promise<string> {
    const rows = await db.execute<{ state: string }>(
      sql`select state from work.iterations where id = ${id}::uuid`,
    );
    return rows.rows[0].state;
  }

  /** A committed iteration holding one accepted and one open story. */
  async function committedIterationWithMixedScope() {
    const iteration = await iterations.createIteration(
      actor,
      SEEDED.nxp.projectId,
      `Invariant sprint ${uniqueKey()}`,
      { state: 'planning', startDate: '2026-03-02', endDate: '2026-03-13' },
    );
    const accepted = await items.createWorkItem(
      actor,
      SEEDED.nxp.projectId,
      'story',
      `Accepted ${uniqueKey()}`,
      { iterationId: iteration.id, storyPoints: '3' },
    );
    const open = await items.createWorkItem(
      actor,
      SEEDED.nxp.projectId,
      'story',
      `Open ${uniqueKey()}`,
      { iterationId: iteration.id, storyPoints: '2' },
    );
    await iterations.updateIteration(actor, iteration.id, { state: 'committed' });
    await items.updateWorkItem(actor, accepted.id, { scheduleState: 'accepted' });

    // Still committed: one item is open, so the rule is not yet satisfied.
    expect(await iterationState(iteration.id)).toBe('committed');
    return { iterationId: iteration.id, openId: open.id };
  }

  it('auto-accepts when the last OPEN item is moved OUT of the iteration', async () => {
    /**
     * The gate required a `scheduleState` transition into an accepted state, so a SCOPE change that
     * satisfied the same condition never re-evaluated it. Moving the one remaining open Story out
     * leaves a non-empty iteration whose every assigned item is Accepted — the rule's exact wording —
     * with the iteration still Committed. Visible as Timeboxes saying Committed while the Iteration
     * Status tile says ACCEPTED 100%.
     */
    const { iterationId, openId } = await committedIterationWithMixedScope();

    await items.updateWorkItem(actor, openId, { iterationId: null });

    expect(await iterationState(iterationId)).toBe('accepted');
  });

  it('auto-accepts when an already-accepted item is bulk-assigned IN', async () => {
    // The other reachable hole: `assignIterationBulk` never called the check at all, so filling an
    // empty iteration with accepted work left it Committed.
    const iteration = await iterations.createIteration(
      actor,
      SEEDED.nxp.projectId,
      `Bulk invariant ${uniqueKey()}`,
      { state: 'planning', startDate: '2026-04-06', endDate: '2026-04-17' },
    );
    await iterations.updateIteration(actor, iteration.id, { state: 'committed' });

    const story = await items.createWorkItem(
      actor,
      SEEDED.nxp.projectId,
      'story',
      `Bulk accepted ${uniqueKey()}`,
      { storyPoints: '5' },
    );
    await items.updateWorkItem(actor, story.id, { scheduleState: 'accepted' });

    await items.bulkAssignIteration(actor, SEEDED.nxp.projectId, [story.id], iteration.id);

    expect(await iterationState(iteration.id)).toBe('accepted');
  });

  it('never auto-REVERSES an accepted iteration when open work is added', async () => {
    // "the system does not auto-reverse it" (BUSINESS_BASELINE:12). Re-evaluating on scope change must
    // only ever move toward accepted, or adding one story would un-accept a closed sprint.
    const { iterationId, openId } = await committedIterationWithMixedScope();
    await items.updateWorkItem(actor, openId, { iterationId: null });
    expect(await iterationState(iterationId)).toBe('accepted');

    const fresh = await items.createWorkItem(
      actor,
      SEEDED.nxp.projectId,
      'story',
      `Late arrival ${uniqueKey()}`,
      { iterationId, storyPoints: '1' },
    );
    expect(fresh.id).toBeTruthy();
    expect(await iterationState(iterationId)).toBe('accepted');
  });

  it("keeps a milestone's derived window correct after a linked Release's dates change", async () => {
    /**
     * `recalcTargetDates` ran on create, on update, on a link write — and on `getMilestone`, a
     * read-path repair. It never ran when a linked Release's own dates were edited, and
     * `listMilestones` reads the persisted columns. So the detail page self-healed on read while the
     * LIST showed the old window, which is also why nobody noticed.
     */
    const release = await releases.createRelease(
      actor,
      SEEDED.nxp.projectId,
      `Inv release ${uniqueKey()}`,
      {
        startDate: '2026-05-04',
        releaseDate: '2026-05-29',
      },
    );
    const milestone = await milestones.createMilestone(
      actor,
      SEEDED.nxp.projectId,
      `Inv milestone ${uniqueKey()}`,
      { releaseIds: [release.id] },
    );

    // Derived from the link, before anything moves.
    let row = await db.execute<{ target_start_date: string; target_end_date: string }>(
      sql`select target_start_date, target_end_date from work.milestones where id = ${milestone.id}::uuid`,
    );
    expect(row.rows[0].target_start_date).toBe('2026-05-04');

    // Now move the Release. The milestone's window has to move with it.
    await releases.updateRelease(actor, release.id, {
      startDate: '2026-05-11',
      releaseDate: '2026-06-19',
    });

    row = await db.execute<{ target_start_date: string; target_end_date: string }>(
      sql`select target_start_date, target_end_date from work.milestones where id = ${milestone.id}::uuid`,
    );
    expect(row.rows[0].target_start_date).toBe('2026-05-11');
    expect(row.rows[0].target_end_date).toBe('2026-06-19');

    // And the LIST agrees, without anyone opening the detail page first.
    const page = await milestones.listMilestones(actor, SEEDED.nxp.projectId, ALL);
    const listed = page.data.find((m) => m.id === milestone.id);
    expect(listed?.targetStartDate).toBe('2026-05-11');
    expect(listed?.targetEndDate).toBe('2026-06-19');
  });

  it('leaves a milestone with NO linked release manually dated', async () => {
    // §75: with no link the dates are user-managed and "the system does not infer a replacement date".
    // A trigger that maintains the derived window must not reach these.
    const milestone = await milestones.createMilestone(
      actor,
      SEEDED.nxp.projectId,
      `Manual milestone ${uniqueKey()}`,
      { targetStartDate: '2026-09-01', targetEndDate: '2026-09-30' },
    );
    const row = await db.execute<{ target_start_date: string; target_end_date: string }>(
      sql`select target_start_date, target_end_date from work.milestones where id = ${milestone.id}::uuid`,
    );
    expect(row.rows[0].target_start_date).toBe('2026-09-01');
    expect(row.rows[0].target_end_date).toBe('2026-09-30');
  });
});
