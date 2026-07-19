/**
 * BA business-flow E2E — context isolation + read-only RBAC.
 *
 * Encodes flows E2E-008 (project context isolation) and E2E-009 (read-only user
 * behaviour) from
 * product-docs/projects/mini-rally/testing/E2E_BUSINESS_FLOW_COVERAGE.md,
 * driving the REAL application services against the seeded DB.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProjectsService } from '@modules/projects';
import { WorkItemsService } from '@modules/work-items';
import type { WorkItemFilters } from '@modules/work-items';

import { ALL, adminActor, bootRallyApp, uniqueKey, viewerActor } from './support/flow-harness';

const NO_WI_FILTERS = {} as WorkItemFilters;

describe('BA flows: context isolation + read-only RBAC (real AppModule + seeded DB)', () => {
  let app: NestFastifyApplication;
  let projects: ProjectsService;
  let workItems: WorkItemsService;
  const admin = adminActor();
  const viewer = viewerActor();

  beforeAll(async () => {
    app = await bootRallyApp();
    projects = app.get(ProjectsService);
    workItems = app.get(WorkItemsService);
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── E2E-008: Project context isolation ──────────────────────────────────────
  describe('E2E-008 context isolation', () => {
    it('does not leak project A work items into project B listings', async () => {
      const projectA = await projects.createProject(admin, { key: uniqueKey(), name: 'Project A' });
      const projectB = await projects.createProject(admin, { key: uniqueKey(), name: 'Project B' });

      const storyA = await workItems.createWorkItem(admin, projectA.id, 'story', 'A-only story');
      const storyB = await workItems.createWorkItem(admin, projectB.id, 'story', 'B-only story');

      const listA = await workItems.listWorkItems(admin, projectA.id, NO_WI_FILTERS, ALL);
      const idsA = listA.data.map((w) => w.id);
      expect(idsA).toContain(storyA.id);
      expect(idsA).not.toContain(storyB.id);

      const listB = await workItems.listWorkItems(admin, projectB.id, NO_WI_FILTERS, ALL);
      const idsB = listB.data.map((w) => w.id);
      expect(idsB).toContain(storyB.id);
      expect(idsB).not.toContain(storyA.id);
    });

    it('rejects cross-project parenting (a defect cannot parent onto another project)', async () => {
      const projectA = await projects.createProject(admin, { key: uniqueKey(), name: 'Cross A' });
      const projectB = await projects.createProject(admin, { key: uniqueKey(), name: 'Cross B' });
      const storyA = await workItems.createWorkItem(admin, projectA.id, 'story', 'A story');

      await expect(
        workItems.createWorkItem(admin, projectB.id, 'defect', 'Cross defect', {
          parentId: storyA.id,
        }),
      ).rejects.toMatchObject({ code: 'WORK_ITEM_PARENT_SCOPE_MISMATCH' });
    });
  });

  // ── E2E-009: Read-only user behaviour ───────────────────────────────────────
  describe('E2E-009 read-only user', () => {
    it('lets a viewer read but blocks create and edit', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'Viewer Project',
      });
      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Read-only target');

      // Viewer CAN view.
      const viewed = await workItems.getWorkItemForView(viewer, story.id);
      expect(viewed.id).toBe(story.id);

      // Viewer CANNOT create.
      await expect(
        workItems.createWorkItem(viewer, project.id, 'story', 'Blocked create'),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });

      // Viewer CANNOT edit.
      await expect(
        workItems.updateWorkItem(viewer, story.id, { description: 'nope' }),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });
    });
  });
});
