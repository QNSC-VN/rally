/**
 * BA business-flow E2E — Phase 4.2 Roles & Permissions + Phase 4.3 Settings & Audit.
 *
 * Encodes two cross-phase flows from the Phase 4 development pack
 * (product-docs/projects/mini-rally/04_Developement_tracking/Phase 4/
 *  PHASE4_DEVELOPMENT_TRACKING.md):
 *
 *   E2E-018 (P4-SET-06 Audit Log, P4-SET-01 Workspace Settings) — every
 *     administrative mutation records an audit entry, and the Audit Log read
 *     model is workspace-scoped and filterable.
 *   E2E-019 (P4-RBAC-03/04) — a read-only principal is denied destructive /
 *     governance actions the service layer enforces.
 *
 * Architecture note — administrative actions record audit entries through a
 * transactional outbox (`AuditProducer.emit` → `messaging.outbox_events`); the
 * Worker `AuditConsumer` later persists `audit.audit_logs`, which AuditService
 * reads. This suite boots only the API AppModule (no Worker), so it proves the
 * producer contract at the outbox seam and the read model by driving
 * AuditService directly (its `record()` is the same write the consumer makes).
 *
 * Drives the REAL application services against the seeded DB.
 */
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '@modules/audit';
import { ProjectsService } from '@modules/projects';
import { WorkItemsService } from '@modules/work-items';
import { WorkspaceService } from '@modules/workspace';
import { DRIZZLE, type DrizzleDB } from '@platform';

import { outboxEvents } from '../../db/schema/messaging';
import {
  WORKSPACE_ID,
  adminActor,
  bootRallyApp,
  uniqueKey,
  viewerActor,
} from './support/flow-harness';

describe('BA flows: Phase 4 governance — RBAC + audit (real AppModule + seeded DB)', () => {
  let app: NestFastifyApplication;
  let projects: ProjectsService;
  let workItems: WorkItemsService;
  let workspace: WorkspaceService;
  let audit: AuditService;
  let db: DrizzleDB;
  const admin = adminActor();
  const viewer = viewerActor();

  beforeAll(async () => {
    app = await bootRallyApp();
    projects = app.get(ProjectsService);
    workItems = app.get(WorkItemsService);
    workspace = app.get(WorkspaceService);
    audit = app.get(AuditService);
    db = app.get<DrizzleDB>(DRIZZLE);
  });

  afterAll(async () => {
    await app?.close();
  });

  const outboxRows = (eventType: string, aggregateId: string) =>
    db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.eventType, eventType), eq(outboxEvents.aggregateId, aggregateId)));

  // ── E2E-018a: audit producer contract ───────────────────────────────────────
  describe('E2E-018a administrative mutations record an audit event', () => {
    it('archiving a project emits a project.archived audit event', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'Audited Project',
      });

      await projects.updateProject(admin, project.id, { status: 'archived' });

      const rows = await outboxRows('project.archived', project.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.workspaceId).toBe(WORKSPACE_ID);
      expect((rows[0]?.payload as { actorId?: string })?.actorId).toBe(admin.sub);
    });

    it('updating workspace settings emits a workspace.settings.updated audit event', async () => {
      await workspace.updateSettings(WORKSPACE_ID, { timezone: 'Asia/Ho_Chi_Minh' }, admin.sub);

      const rows = await outboxRows('workspace.settings.updated', WORKSPACE_ID);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => r.workspaceId === WORKSPACE_ID)).toBe(true);
    });
  });

  // ── E2E-018b: audit read model ──────────────────────────────────────────────
  describe('E2E-018b the audit log is workspace-scoped and filterable', () => {
    it('returns matching entries, filters by action and never leaks other workspaces', async () => {
      const resourceId = randomUUID();
      const foreignWorkspaceId = randomUUID();

      await audit.record({
        workspaceId: WORKSPACE_ID,
        actorId: admin.sub,
        action: 'project.archived',
        resourceType: 'project',
        resourceId,
      });
      await audit.record({
        workspaceId: WORKSPACE_ID,
        actorId: admin.sub,
        action: 'project.updated',
        resourceType: 'project',
        resourceId,
      });
      // Same resource id, different workspace — must never surface for this actor.
      await audit.record({
        workspaceId: foreignWorkspaceId,
        actorId: admin.sub,
        action: 'project.archived',
        resourceType: 'project',
        resourceId,
      });

      const all = await audit.listAuditLogs(admin, { resourceId });
      expect(all.data.map((l) => l.action).sort()).toEqual(['project.archived', 'project.updated']);
      expect(all.data.every((l) => l.workspaceId === WORKSPACE_ID)).toBe(true);

      const archivedOnly = await audit.listAuditLogs(admin, {
        resourceId,
        action: 'project.archived',
      });
      expect(archivedOnly.data).toHaveLength(1);
      expect(archivedOnly.data[0]?.action).toBe('project.archived');
    });
  });

  // ── E2E-019: RBAC boundary (read-only principal) ────────────────────────────
  describe('E2E-019 a read-only principal is denied destructive and governance actions', () => {
    it('blocks a viewer from deleting a work item', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'RBAC Delete Project',
      });
      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Protected');

      await expect(workItems.deleteWorkItem(viewer, story.id)).rejects.toMatchObject({
        code: 'PROJECT_PERMISSION_DENIED',
      });
    });

    it('blocks a non-member viewer from archiving a project', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'RBAC Archive Project',
      });

      await expect(
        projects.updateProject(viewer, project.id, { status: 'archived' }),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });
    });
  });
});
