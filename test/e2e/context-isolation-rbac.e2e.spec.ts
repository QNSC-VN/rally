/**
 * BA business-flow E2E — context isolation + read-only RBAC.
 *
 * Encodes flows E2E-008 (project context isolation) and E2E-009 (read-only user
 * behaviour) from
 * product-docs/projects/mini-rally/testing/E2E_BUSINESS_FLOW_COVERAGE.md,
 * driving the REAL application services against the seeded DB.
 */
import type { ExecutionContext } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProjectsService } from '@modules/projects';
import { WorkItemsService } from '@modules/work-items';
import type { WorkItemFilters } from '@modules/work-items';
import { PolicyGuard, RequirePermission } from '@modules/access';
import type { JwtPayload } from '@platform';

import { ALL, adminActor, bootRallyApp, uniqueKey, viewerActor } from './support/flow-harness';

/**
 * Since P2 the per-route project authorization lives in the PolicyGuard, not in
 * the work-items service. This service-level harness cannot mint an authenticated
 * HTTP request, so we exercise the REAL guard directly: a probe class carries the
 * exact `@RequirePermission` metadata each route declares, and we ask the real
 * PolicyGuard (resolving the project from the seeded DB via AccessService) whether
 * a given actor may act. This is the production decision path end-to-end.
 */
class WorkItemPolicyProbe {
  @RequirePermission('work_item:view', { resource: 'work_item', from: 'param', field: 'id' })
  view(): void {}
  @RequirePermission('work_item:edit', { resource: 'work_item', from: 'param', field: 'id' })
  edit(): void {}
  @RequirePermission('work_item:create', { from: 'body', field: 'projectId' })
  create(): void {}
}

function policyContext(
  handler: (...args: unknown[]) => unknown,
  actor: JwtPayload,
  req: { params?: Record<string, string>; query?: Record<string, unknown>; body?: Record<string, unknown> },
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => WorkItemPolicyProbe,
    switchToHttp: () => ({
      getRequest: () => ({ user: actor, params: {}, query: {}, body: {}, ...req }),
    }),
  } as unknown as ExecutionContext;
}

const NO_WI_FILTERS = {} as WorkItemFilters;

describe('BA flows: context isolation + read-only RBAC (real AppModule + seeded DB)', () => {
  let app: NestFastifyApplication;
  let projects: ProjectsService;
  let workItems: WorkItemsService;
  let policy: PolicyGuard;
  const admin = adminActor();
  const viewer = viewerActor();

  beforeAll(async () => {
    app = await bootRallyApp();
    projects = app.get(ProjectsService);
    workItems = app.get(WorkItemsService);
    policy = app.get(PolicyGuard);
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

  // ── E2E-009: Read-only user behaviour (enforced by the PolicyGuard) ──────────
  describe('E2E-009 read-only user', () => {
    it('lets a viewer read but blocks create and edit', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'Viewer Project',
      });
      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Read-only target');

      // Viewer CAN view — the guard resolves the item's project and finds
      // work_item:view in the viewer's effective project permissions.
      await expect(
        policy.canActivate(
          policyContext(WorkItemPolicyProbe.prototype.view, viewer, { params: { id: story.id } }),
        ),
      ).resolves.toBe(true);

      // Viewer CANNOT create — no work_item:create on the project.
      await expect(
        policy.canActivate(
          policyContext(WorkItemPolicyProbe.prototype.create, viewer, {
            body: { projectId: project.id },
          }),
        ),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });

      // Viewer CANNOT edit — no work_item:edit on the item's project.
      await expect(
        policy.canActivate(
          policyContext(WorkItemPolicyProbe.prototype.edit, viewer, { params: { id: story.id } }),
        ),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });

      // And an admin (workspace:*) fast-paths every project-tier check.
      await expect(
        policy.canActivate(
          policyContext(WorkItemPolicyProbe.prototype.edit, admin, { params: { id: story.id } }),
        ),
      ).resolves.toBe(true);
    });
  });
});
