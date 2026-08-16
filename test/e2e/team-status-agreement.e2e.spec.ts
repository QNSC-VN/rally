/**
 * Team Status and the Phase 6 Team Capacity report must report the SAME hours.
 *
 * Both surfaces answer one question — "what is this team committed to in this iteration" — from the
 * same `work.tasks` rows, and the Team Capacity SRS says so twice: the scoped Task set comes from
 * "the Task's PARENT Story/Defect Project, Team and Iteration assignment", and Capacity "must use the
 * same source/table/API domain as `Track > Team Status`". They did not agree, in three independent
 * ways, each of which is exercised below against real rows.
 *
 * Latent rather than visible on the seeded fixture — every seeded task is uniformly team-tagged and no
 * parent is deleted — so the divergences are built here on purpose. That is the point: a test that
 * only reads the happy fixture is what let three of these ship.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { WorkItemsService } from '@modules/work-items';
import { TeamStatusService } from '@modules/team-status';
import { ReportingService } from '@modules/reporting';

import { SEEDED, adminActor, bootRallyApp, uniqueKey } from './support/flow-harness';

describe('Team Status agrees with Team Capacity (e2e)', () => {
  let app: NestFastifyApplication;
  let db: DrizzleDB;
  let items: WorkItemsService;
  let teamStatus: TeamStatusService;
  let reporting: ReportingService;
  const actor = adminActor();
  const iterationId = SEEDED.nxp.iterationCurrentId;
  const teamId = SEEDED.nxp.teamAlphaId;

  /** Sum of a scope's task hours as TEAM STATUS reports them. */
  async function teamStatusHours(scopeTeamId: string | null) {
    // Signature is (actor, projectId, teamId, iterationId) — team before iteration.
    const view = await teamStatus.getTeamStatus(
      actor,
      SEEDED.nxp.projectId,
      scopeTeamId,
      iterationId,
    );
    // The response's own totals row — the number the screen prints, not one this test re-derives.
    return {
      estimate: view.totals.estimateHours,
      todo: view.totals.todoHours,
      actual: view.totals.actualHours,
    };
  }

  /** The same scope as the TEAM CAPACITY report reports it. */
  async function capacityHours(scopeTeamId: string | undefined) {
    const report = await reporting.getTeamCapacity(actor, {
      projectId: SEEDED.nxp.projectId,
      iterationId,
      teamId: scopeTeamId,
    });
    return {
      estimate: report.totals.estimateHours,
      todo: report.totals.todoHours,
      actual: report.totals.actualHours,
    };
  }

  beforeAll(async () => {
    app = await bootRallyApp();
    db = app.get<DrizzleDB>(DRIZZLE);
    items = app.get(WorkItemsService);
    teamStatus = app.get(TeamStatusService);
    reporting = app.get(ReportingService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('counts a task whose team is INHERITED from its parent, not carried on the row', async () => {
    /**
     * The team half of the scope used to be a strict `tasks.team_id = ?`.
     *
     * A task's team only DEFAULTS to its parent's (SRS P1-04), so a Story that carries the team while
     * its task does not is an ordinary shape — and SQL equality never matches NULL. Team Status
     * dropped those tasks; Team Capacity kept them via the parent/iteration tiers. Same iteration,
     * same team, two different totals.
     */
    const story = await items.createWorkItem(
      actor,
      SEEDED.nxp.projectId,
      'story',
      `Inherited team ${uniqueKey()}`,
      { iterationId, teamId },
    );
    const task = await items.createTask(actor, story.id, `Inherited team task ${uniqueKey()}`, {
      estimateHours: '6',
      todoHours: '4',
      actualHours: '2',
    });
    // The shape the service cannot produce but a Story-first workflow arrives at: the parent owns the
    // team, the task does not.
    await db.execute(sql`update work.tasks set team_id = null where id = ${task.id}::uuid`);

    const status = await teamStatusHours(teamId);
    const capacity = await capacityHours(teamId);
    expect(status).toEqual(capacity);
    // And it is actually counted, rather than both being wrong in the same direction.
    expect(status.estimate).toBeGreaterThanOrEqual(6);
  });

  it('excludes tasks whose parent was soft-deleted, on BOTH surfaces', async () => {
    /**
     * A soft delete stamps `deleted_at` on the one row and never cascades to `work.tasks`. Team Status
     * LEFT-joined the parent, so those orphans still matched on `tasks.iteration_id` and were counted
     * with a blank Work Product column, while Iteration Status and the Phase 6 projection inner-join
     * and exclude them. Deleting a Story moved the two screens apart.
     */
    const story = await items.createWorkItem(
      actor,
      SEEDED.nxp.projectId,
      'story',
      `Orphan parent ${uniqueKey()}`,
      { iterationId, teamId },
    );
    await items.createTask(actor, story.id, `Orphan task ${uniqueKey()}`, {
      estimateHours: '11',
      todoHours: '11',
      actualHours: '0',
    });

    const before = await teamStatusHours(teamId);
    await items.deleteWorkItem(actor, story.id);
    const after = await teamStatusHours(teamId);

    // The 11 hours leave Team Status when their parent does.
    expect(after.estimate).toBe(before.estimate - 11);
    expect(after).toEqual(await capacityHours(teamId));
  });

  it('agrees under All Teams too', async () => {
    expect(await teamStatusHours(null)).toEqual(await capacityHours(undefined));
  });

  it('does NOT overwrite To Do when only the Estimate is edited', async () => {
    /**
     * The Team Status edit path used to set `todoHours` to the new estimate whenever the caller had not
     * sent one. That defined the field before `WorkItemsService` saw it, so the copy happened on EVERY
     * estimate edit, moving the Iteration Status total with it.
     *
     * Driven through `WorkItemsService` now, because Team Status no longer edits hours at all: the SRS
     * makes Estimate/ToDo/Actuals reads on that screen (§9.3 patches `title`/`state`; §11's editable
     * columns are Capacity, Task Name, Task State), and the Task Dashboard — Work Item Detail › Tasks
     * tab, FR-038 — is the surface that writes them, through this path.
     *
     * The assertion is unchanged; its REASON narrowed. It used to hold because of a once-only gate
     * (`item.todoHours === null`); it now holds because the update path derives nothing at all —
     * `Phase 1/04_Task_Management/SRS.md:127`, "this copy is **not repeated on later edits**".
     */
    const story = await items.createWorkItem(
      actor,
      SEEDED.nxp.projectId,
      'story',
      `Estimate edit ${uniqueKey()}`,
      { iterationId, teamId },
    );
    const task = await items.createTask(actor, story.id, `Estimate edit task ${uniqueKey()}`, {
      estimateHours: '5',
      todoHours: '2',
    });

    await items.updateWorkItem(actor, task.id, { estimateHours: '9' });

    const rows = await db.execute<{ estimate_hours: string; todo_hours: string }>(
      sql`select estimate_hours, todo_hours from work.tasks where id = ${task.id}::uuid`,
    );
    expect(Number(rows.rows[0].estimate_hours)).toBe(9);
    // Untouched — 2, not 9.
    expect(Number(rows.rows[0].todo_hours)).toBe(2);
  });

  /**
   * INVERTED. This used to assert that a first Estimate typed onto an existing task copied itself
   * into a blank To Do.
   *
   * The BA scoped that copy to create: "**On create only**, when Estimate is entered and To Do is
   * blank, the system copies Estimate to To Do once" (`Phase 1/04_Task_Management/SRS.md:26`), and
   * `:127` — "this copy is **not repeated on later edits**". A blank To Do therefore stays blank,
   * which is the case the old behaviour existed for and is now the one that proves it is gone.
   */
  it('does NOT copy an estimate into a blank To Do on a later edit', async () => {
    const story = await items.createWorkItem(
      actor,
      SEEDED.nxp.projectId,
      'story',
      `First estimate ${uniqueKey()}`,
      { iterationId, teamId },
    );
    const task = await items.createTask(actor, story.id, `First estimate task ${uniqueKey()}`);
    await db.execute(
      sql`update work.tasks set estimate_hours = null, todo_hours = null where id = ${task.id}::uuid`,
    );

    await items.updateWorkItem(actor, task.id, { estimateHours: '7' });

    const rows = await db.execute<{ estimate_hours: string; todo_hours: string | null }>(
      sql`select estimate_hours, todo_hours from work.tasks where id = ${task.id}::uuid`,
    );
    expect(Number(rows.rows[0].estimate_hours)).toBe(7);
    expect(rows.rows[0].todo_hours).toBeNull();
  });

  /**
   * INVERTED, and it is the change with the widest reach: completing a task used to write
   * `todoHours = 0`, so the Team Status / Team Capacity To Do total fell as work finished.
   *
   * "**Completing or reopening a Task does not change any of the three values.**"
   * (`Phase 1/04:27`, restated at `Phase 1/05_Time_Tracking/SRS.md:91` and
   * `Phase 6/04_Team_Capacity/SRS.md:52` + AC-8:134 — "Completing or reopening a Task does not alter
   * the report's Estimate, ToDo or Actual values unless a user explicitly edits those fields").
   *
   * `accepted` and `release` are in the loop because the removed gate was `isCompletedScheduleState`,
   * which covers all three — the auto-zero fired on three transitions, not one.
   */
  it.each(['completed', 'accepted', 'release'] as const)(
    'leaves To Do alone when a task moves to %s, and Team Status agrees',
    async (state) => {
      const story = await items.createWorkItem(
        actor,
        SEEDED.nxp.projectId,
        'story',
        `Complete ${uniqueKey()}`,
        { iterationId, teamId },
      );
      const task = await items.createTask(actor, story.id, `Complete task ${uniqueKey()}`, {
        estimateHours: '6',
        todoHours: '4',
        actualHours: '2',
      });

      const before = await teamStatusHours(teamId);
      await items.updateWorkItem(actor, task.id, { scheduleState: state });

      const rows = await db.execute<{ todo_hours: string }>(
        sql`select todo_hours from work.tasks where id = ${task.id}::uuid`,
      );
      expect(Number(rows.rows[0].todo_hours)).toBe(4);
      // The two surfaces are ONE population, so the retained 4 has to be visible on both.
      const after = await teamStatusHours(teamId);
      expect(after.todo).toBe(before.todo);
      expect(after).toEqual(await capacityHours(teamId));
    },
  );
});
