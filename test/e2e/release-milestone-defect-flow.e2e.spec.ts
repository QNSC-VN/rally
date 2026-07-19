/**
 * BA business-flow E2E — release + milestone artifact assignment + defect lifecycle.
 *
 * Encodes flows E2E-013 (a Story/Defect has a single active Release assignment and
 * reassignment moves it, using existing work items — no clone), E2E-014 (Milestone
 * artifacts are independent from Release/Iteration assignment and reject out-of-scope
 * items) and E2E-015 (Quality Defect shares the Backlog source, optional parent,
 * valid state machine, delete forbidden) from
 * product-docs/projects/mini-rally/testing/E2E_BUSINESS_FLOW_COVERAGE.md.
 *
 * Drives the REAL application services against the seeded DB.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IterationsService } from '@modules/iterations';
import { MilestonesService } from '@modules/milestones';
import { ProjectsService } from '@modules/projects';
import { ReleasesService } from '@modules/releases';
import { WorkItemsService } from '@modules/work-items';

import { ALL, adminActor, bootRallyApp, uniqueKey } from './support/flow-harness';

describe('BA flows: releases + milestones + defect lifecycle (real AppModule + seeded DB)', () => {
  let app: NestFastifyApplication;
  let projects: ProjectsService;
  let workItems: WorkItemsService;
  let releases: ReleasesService;
  let milestones: MilestonesService;
  let iterations: IterationsService;
  const actor = adminActor();

  beforeAll(async () => {
    app = await bootRallyApp();
    projects = app.get(ProjectsService);
    workItems = app.get(WorkItemsService);
    releases = app.get(ReleasesService);
    milestones = app.get(MilestonesService);
    iterations = app.get(IterationsService);
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── E2E-013: single active release assignment; reassignment moves the item ──
  describe('E2E-013 release artifact assignment', () => {
    it('assigns an existing work item to one release and moves it on reassignment', async () => {
      const project = await projects.createProject(actor, {
        key: uniqueKey(),
        name: 'Release Project',
      });
      const releaseA = await releases.createRelease(actor, project.id, 'Release A');
      const releaseB = await releases.createRelease(actor, project.id, 'Release B');
      const story = await workItems.createWorkItem(actor, project.id, 'story', 'Shippable story');

      // Assign to A — appears under A only, no clone.
      await workItems.updateWorkItem(actor, story.id, { releaseId: releaseA.id });
      let artifactsA = await releases.listReleaseArtifacts(actor, releaseA.id, ALL);
      let artifactsB = await releases.listReleaseArtifacts(actor, releaseB.id, ALL);
      expect(artifactsA.data.some((a) => a.id === story.id)).toBe(true);
      expect(artifactsB.data.some((a) => a.id === story.id)).toBe(false);

      // Reassign to B — the single releaseId column moves the item off A.
      await workItems.updateWorkItem(actor, story.id, { releaseId: releaseB.id });
      artifactsA = await releases.listReleaseArtifacts(actor, releaseA.id, ALL);
      artifactsB = await releases.listReleaseArtifacts(actor, releaseB.id, ALL);
      expect(artifactsA.data.some((a) => a.id === story.id)).toBe(false);
      expect(artifactsB.data.some((a) => a.id === story.id)).toBe(true);
    });

    it('rejects assigning a work item to a release in a different project', async () => {
      const projectA = await projects.createProject(actor, {
        key: uniqueKey(),
        name: 'Rel Scope A',
      });
      const projectB = await projects.createProject(actor, {
        key: uniqueKey(),
        name: 'Rel Scope B',
      });
      const releaseB = await releases.createRelease(actor, projectB.id, 'Foreign Release');
      const story = await workItems.createWorkItem(actor, projectA.id, 'story', 'A story');

      await expect(
        workItems.updateWorkItem(actor, story.id, { releaseId: releaseB.id }),
      ).rejects.toMatchObject({ code: 'RELEASE_PROJECT_MISMATCH' });
    });
  });

  // ── E2E-014: milestone artifacts are independent from release/iteration ──────
  describe('E2E-014 milestone artifact assignment', () => {
    it('adds/removes a milestone artifact without mutating release or iteration', async () => {
      const project = await projects.createProject(actor, {
        key: uniqueKey(),
        name: 'Milestone Project',
      });
      const release = await releases.createRelease(actor, project.id, 'MS Release');
      const iteration = await iterations.createIteration(actor, project.id, 'MS Sprint');
      const milestone = await milestones.createMilestone(actor, project.id, 'GA Milestone');
      const story = await workItems.createWorkItem(actor, project.id, 'story', 'Tracked story');

      // Give the story a release + iteration first, to prove independence.
      await workItems.updateWorkItem(actor, story.id, {
        releaseId: release.id,
        iterationId: iteration.id,
      });

      // Assign the milestone artifact.
      await workItems.setWorkItemMilestones(actor, story.id, [milestone.id]);
      const linked = await workItems.getWorkItemMilestones(actor, story.id);
      expect(linked.some((m) => m.id === milestone.id)).toBe(true);

      // Release + iteration assignment are untouched by the milestone write.
      const afterAdd = await workItems.getWorkItem(actor.workspaceId, story.id);
      expect(afterAdd.releaseId).toBe(release.id);
      expect(afterAdd.iterationId).toBe(iteration.id);

      // Removing the milestone likewise leaves release + iteration intact.
      await workItems.setWorkItemMilestones(actor, story.id, []);
      expect(await workItems.getWorkItemMilestones(actor, story.id)).toHaveLength(0);
      const afterRemove = await workItems.getWorkItem(actor.workspaceId, story.id);
      expect(afterRemove.releaseId).toBe(release.id);
      expect(afterRemove.iterationId).toBe(iteration.id);
    });

    it('rejects a milestone artifact outside the work item project scope', async () => {
      const projectA = await projects.createProject(actor, {
        key: uniqueKey(),
        name: 'MS Scope A',
      });
      const projectB = await projects.createProject(actor, {
        key: uniqueKey(),
        name: 'MS Scope B',
      });
      const milestoneB = await milestones.createMilestone(actor, projectB.id, 'Foreign MS');
      const story = await workItems.createWorkItem(actor, projectA.id, 'story', 'A story');

      await expect(
        workItems.setWorkItemMilestones(actor, story.id, [milestoneB.id]),
      ).rejects.toMatchObject({ code: 'MILESTONE_PROJECT_MISMATCH' });
    });

    it('rejects an out-of-scope work item on the milestone-side artifact write', async () => {
      // Symmetric guard: PUT /milestones/:id/artifacts must also reject items
      // that do not belong to the milestone's project (FR-023 / AC12).
      const projectA = await projects.createProject(actor, {
        key: uniqueKey(),
        name: 'MS Side A',
      });
      const projectB = await projects.createProject(actor, {
        key: uniqueKey(),
        name: 'MS Side B',
      });
      const milestoneA = await milestones.createMilestone(actor, projectA.id, 'Scoped MS');
      const inScope = await workItems.createWorkItem(actor, projectA.id, 'story', 'In-scope story');
      const outOfScope = await workItems.createWorkItem(
        actor,
        projectB.id,
        'story',
        'Foreign story',
      );

      // A foreign work item is rejected — no partial write.
      await expect(
        milestones.setMilestoneArtifacts(actor, milestoneA.id, [inScope.id, outOfScope.id]),
      ).rejects.toMatchObject({ code: 'MILESTONE_PROJECT_MISMATCH' });
      expect(await milestones.getMilestoneArtifacts(actor, milestoneA.id)).toHaveLength(0);

      // An in-scope work item is accepted.
      const linked = await milestones.setMilestoneArtifacts(actor, milestoneA.id, [inScope.id]);
      expect(linked).toContain(inScope.id);
    });
  });

  // ── E2E-015: quality defect lifecycle shares the backlog source ─────────────
  describe('E2E-015 defect lifecycle', () => {
    it('creates a parentless defect, walks the valid state machine, and forbids delete', async () => {
      const project = await projects.createProject(actor, {
        key: uniqueKey(),
        name: 'Defect Lifecycle',
      });
      const defect = await workItems.createWorkItem(
        actor,
        project.id,
        'defect',
        'Standalone defect',
      );
      expect(defect.type).toBe('defect');
      expect(defect.parentId ?? null).toBeNull();

      // Same source: the defect is in the Backlog.
      const backlog = await workItems.listBacklog(actor, project.id, {}, ALL);
      expect(backlog.data.some((w) => w.id === defect.id)).toBe(true);

      // Valid state walk: submitted → open → fixed → closed.
      await workItems.updateWorkItem(actor, defect.id, { defectState: 'submitted' });
      await workItems.updateWorkItem(actor, defect.id, { defectState: 'open' });
      await workItems.updateWorkItem(actor, defect.id, { defectState: 'fixed' });
      const closed = await workItems.updateWorkItem(actor, defect.id, { defectState: 'closed' });
      expect(closed.defectState).toBe('closed');

      // Invalid transition: closed → fixed (closed may only reopen to open).
      await expect(
        workItems.updateWorkItem(actor, defect.id, { defectState: 'fixed' }),
      ).rejects.toMatchObject({ code: 'WORK_ITEM_INVALID_TRANSITION' });

      // Defects cannot be deleted — they are resolved via state.
      await expect(workItems.deleteWorkItem(actor, defect.id)).rejects.toMatchObject({
        code: 'DEFECT_DELETE_FORBIDDEN',
      });
    });
  });
});
