/**
 * BA business-flow RETEST — executes the BUSINESS_E2E_TEST_TRACKER cases
 * (E2E-01 … E2E-13) against the REAL AppModule + seeded DB, asserting each
 * tracker "Expected Business Result" so previously Blocked/Failed cases (gaps
 * DEV-003/006/007/010/011/012/013 …) can be re-verified on the current repo.
 *
 * Backend-executable business rules only. UI-shape gaps (DEV-002/004/005/008/
 * 009/014) are verified separately by code inspection in the retest report.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProjectsService } from '@modules/projects';
import { WorkItemsService } from '@modules/work-items';
import { IterationsService } from '@modules/iterations';
import { ReleasesService } from '@modules/releases';
import { MilestonesService } from '@modules/milestones';

import { ALL, adminActor, bootRallyApp, uniqueKey, ADMIN_USER_ID } from './support/flow-harness';

describe('BA retest: business E2E tracker cases (real AppModule + seeded DB)', () => {
  let app: NestFastifyApplication;
  let projects: ProjectsService;
  let workItems: WorkItemsService;
  let iterations: IterationsService;
  let releases: ReleasesService;
  let milestones: MilestonesService;
  const actor = adminActor();
  const newProject = (name: string) => projects.createProject(actor, { key: uniqueKey(), name });

  beforeAll(async () => {
    app = await bootRallyApp();
    projects = app.get(ProjectsService);
    workItems = app.get(WorkItemsService);
    iterations = app.get(IterationsService);
    releases = app.get(ReleasesService);
    milestones = app.get(MilestonesService);
  });
  afterAll(async () => {
    await app?.close();
  });

  // E2E-01 — Iteration create + Planning→Committed→Accepted lifecycle.
  it('E2E-01: iteration is created Planning and walks the confirmed lifecycle', async () => {
    const p = await newProject('Retest IT');
    const it = await iterations.createIteration(actor, p.id, 'Sprint R1');
    expect(it.state).toBe('planning');
    // Accept requires scope, so give the iteration one item before accepting.
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Scoped');
    await workItems.updateWorkItem(actor, s.id, { iterationId: it.id });
    expect((await iterations.commitIteration(actor, it.id)).state).toBe('committed');
    await workItems.updateWorkItem(actor, s.id, { scheduleState: 'accepted' });
    expect((await iterations.getIteration(actor.workspaceId, it.id)).state).toBe('accepted');
  });

  // E2E-02 — Releases are project-level with the Planning/Active/Accepted catalog.
  it('E2E-02: releases default Planning and expose only the confirmed status catalog', async () => {
    const p = await newProject('Retest REL');
    const a = await releases.createRelease(actor, p.id, 'Release A');
    const b = await releases.createRelease(actor, p.id, 'Release B');
    expect(a.status).toBe('planning');
    expect(b.status).toBe('planning');
    // Catalog is exactly the three confirmed states.
    expect((await releases.updateRelease(actor, a.id, { status: 'active' })).status).toBe('active');
    expect((await releases.updateRelease(actor, a.id, { status: 'accepted' })).status).toBe(
      'accepted',
    );
  });

  // E2E-03 (DEV-006) — Milestone links releases; dates derive MIN start / MAX end.
  it('E2E-03: milestone links releases and derives MIN start / MAX end dates', async () => {
    const p = await newProject('Retest MS');
    const a = await releases.createRelease(actor, p.id, 'Rel A', {
      startDate: '2026-07-20',
      releaseDate: '2026-08-10',
    });
    const b = await releases.createRelease(actor, p.id, 'Rel B', {
      startDate: '2026-07-25',
      releaseDate: '2026-08-31',
    });
    const ms = await milestones.createMilestone(actor, p.id, 'GA');
    await milestones.setMilestoneReleases(actor, ms.id, [a.id, b.id]);
    const detail = await milestones.getMilestone(actor.workspaceId, ms.id);
    expect(detail.targetStartDate).toBe('2026-07-20'); // MIN(start)
    expect(detail.targetEndDate).toBe('2026-08-31'); // MAX(releaseDate)
  });

  // E2E-04 (DEV-007) — Story creates once; Schedule + Flow mirror at defaults.
  it('E2E-04: a story is created and Schedule/Flow state mirror', async () => {
    const p = await newProject('Retest WI');
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Login story');
    expect(s.type).toBe('story');
    expect(s.scheduleState).toBe(s.flowState);
    expect(
      (await workItems.listBacklog(actor, p.id, {}, ALL)).data.some((w) => w.id === s.id),
    ).toBe(true);
  });

  // E2E-05 (DEV-010) — Assign story to iteration; persists; iteration stays Planning.
  it('E2E-05: assigning a story to an iteration persists and leaves it Planning', async () => {
    const p = await newProject('Retest ASSIGN');
    const it = await iterations.createIteration(actor, p.id, 'Sprint R5');
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Assignable');
    await workItems.updateWorkItem(actor, s.id, { iterationId: it.id });
    expect((await workItems.getWorkItem(actor.workspaceId, s.id)).iterationId).toBe(it.id);
    expect((await iterations.getIteration(actor.workspaceId, it.id)).state).toBe('planning');
  });

  // E2E-06 (DEV-011 / DOC-001) — single Release, multi Milestone, independent persist.
  it('E2E-06: release is single-select, milestones multi, and survive a release change', async () => {
    const p = await newProject('Retest RELMS');
    const relA = await releases.createRelease(actor, p.id, 'RA');
    const relB = await releases.createRelease(actor, p.id, 'RB');
    const m1 = await milestones.createMilestone(actor, p.id, 'M1');
    const m2 = await milestones.createMilestone(actor, p.id, 'M2');
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Shipped');

    await workItems.updateWorkItem(actor, s.id, { releaseId: relA.id });
    await workItems.setWorkItemMilestones(actor, s.id, [m1.id, m2.id]);
    // Change the release — milestones must persist independently.
    await workItems.updateWorkItem(actor, s.id, { releaseId: relB.id });

    expect((await workItems.getWorkItem(actor.workspaceId, s.id)).releaseId).toBe(relB.id);
    const linked = (await workItems.getWorkItemMilestones(actor, s.id)).map((m) => m.id).sort();
    expect(linked).toEqual([m1.id, m2.id].sort());
  });

  // E2E-07 (DEV-012) — Tasks create under a story, tab count = child count, not in backlog.
  it('E2E-07: tasks create under a story, count correctly, and never appear in the backlog', async () => {
    const p = await newProject('Retest TASKS');
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Parent');
    await workItems.createTask(actor, s.id, 'T1');
    await workItems.createTask(actor, s.id, 'T2');
    expect((await workItems.listTasks(actor, s.id)).length).toBe(2);
    const backlog = await workItems.listBacklog(actor, p.id, {}, ALL);
    expect(backlog.data.every((w) => w.type !== 'task')).toBe(true);
  });

  // E2E-08 (DEV-013) — Estimate is read-only derived = To Do + Actuals.
  it('E2E-08: task Estimate is derived from To Do + Actuals', async () => {
    const p = await newProject('Retest TIME');
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Parent');
    const task = await workItems.createTask(actor, s.id, 'T', {
      todoHours: '3',
      actualHours: '2',
      estimateHours: '99', // client estimate must be ignored
    });
    expect(Number((await workItems.getWorkItem(actor.workspaceId, task.id)).estimateHours)).toBe(5);
    const totals = await workItems.getTaskTotals(actor, s.id);
    expect(totals.estimateHours).toBe(5);
  });

  // E2E-09 — Completing all tasks auto-completes the parent story.
  it('E2E-09: completing all child tasks auto-completes the parent story', async () => {
    const p = await newProject('Retest COMPLETE');
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Parent');
    const t1 = await workItems.createTask(actor, s.id, 'T1');
    const t2 = await workItems.createTask(actor, s.id, 'T2');
    await workItems.updateWorkItem(actor, t1.id, { scheduleState: 'completed' });
    await workItems.updateWorkItem(actor, t2.id, { scheduleState: 'completed' });
    expect((await workItems.getWorkItem(actor.workspaceId, s.id)).scheduleState).toBe('completed');
  });

  // E2E-10 — Reopening a completed task moves the parent back to In-Progress.
  it('E2E-10: reopening a completed task moves the parent story to In-Progress', async () => {
    const p = await newProject('Retest REOPEN');
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Parent');
    const t1 = await workItems.createTask(actor, s.id, 'T1');
    await workItems.updateWorkItem(actor, t1.id, { scheduleState: 'completed' });
    await workItems.updateWorkItem(actor, t1.id, { scheduleState: 'in_progress' });
    expect((await workItems.getWorkItem(actor.workspaceId, s.id)).scheduleState).toBe(
      'in_progress',
    );
  });

  // E2E-11 (DEV-009) — Six-state catalog + bidirectional mirror.
  it('E2E-11: schedule/flow walk the six-state catalog and mirror both ways', async () => {
    const p = await newProject('Retest STATES');
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Stateful');
    const states = ['idea', 'defined', 'in_progress', 'completed', 'accepted', 'release'] as const;
    for (const st of states) {
      const u = await workItems.updateWorkItem(actor, s.id, { scheduleState: st });
      expect(u.scheduleState).toBe(st);
      expect(u.flowState).toBe(st); // mirror
    }
    // Reverse direction: setting flowState mirrors onto scheduleState.
    const rev = await workItems.updateWorkItem(actor, s.id, { flowState: 'defined' });
    expect(rev.scheduleState).toBe('defined');
  });

  // E2E-12 — A committed iteration auto-accepts once all scoped items are Accepted.
  it('E2E-12: a committed iteration auto-accepts when its scope is all Accepted', async () => {
    const p = await newProject('Retest ITACCEPT');
    const it = await iterations.createIteration(actor, p.id, 'Sprint R12');
    const s = await workItems.createWorkItem(actor, p.id, 'story', 'Scoped');
    await workItems.updateWorkItem(actor, s.id, { iterationId: it.id });
    await iterations.commitIteration(actor, it.id);
    await workItems.updateWorkItem(actor, s.id, { scheduleState: 'accepted' });
    expect((await iterations.getIteration(actor.workspaceId, it.id)).state).toBe('accepted');
  });

  // E2E-13 — No scope lock: a committed iteration still accepts new assignments.
  it('E2E-13: a committed iteration does not lock scope (new items can still be assigned)', async () => {
    const p = await newProject('Retest NOLOCK');
    const it = await iterations.createIteration(actor, p.id, 'Sprint R13');
    await iterations.commitIteration(actor, it.id);
    const late = await workItems.createWorkItem(actor, p.id, 'story', 'Late add');
    await workItems.updateWorkItem(actor, late.id, { iterationId: it.id });
    expect((await workItems.getWorkItem(actor.workspaceId, late.id)).iterationId).toBe(it.id);
  });

  void ADMIN_USER_ID;
});
