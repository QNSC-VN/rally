/**
 * BA business-flow E2E — Phase 4.1 Notifications.
 *
 * Encodes the P4.1 acceptance rules from the Phase 4 development pack
 * (product-docs/projects/mini-rally/04_Developement_tracking/Phase 4/
 *  PHASE4_DEVELOPMENT_TRACKING.md — tasks P4-NOTIF-04/07/08/11) as the
 * cross-phase flow E2E-017:
 *   - Assigning a US/DE to another user enqueues exactly ONE assignment
 *     notification for the assignee — and none for a self-assignment.
 *   - The Notification Center read model (list, unread count, category filters,
 *     mark-read, mark-all-read) behaves as the mockup specifies.
 *   - A user only ever sees / can act on their OWN notifications.
 *
 * Architecture note — the notification pipeline is a transactional outbox:
 * producers (WorkItemsService) enqueue into `messaging.notification_outbox`
 * inside their business transaction; the Worker relay later renders and writes
 * `notifications.in_app_notifications`, which NotificationsService reads. This
 * suite boots only the API AppModule (no Worker), so it proves each half at its
 * real seam: the producer contract at the outbox, and the read model by driving
 * NotificationsService directly (its own `send()` is the same call the relay
 * makes). Nothing is stubbed.
 *
 * Drives the REAL application services against the seeded DB.
 */
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotificationsService } from '@modules/notifications';
import { ProjectsService } from '@modules/projects';
import { WorkItemsService } from '@modules/work-items';
import { DRIZZLE, type DrizzleDB } from '@platform';

import { notificationOutbox } from '../../db/schema/messaging';
import {
  DEVELOPER_ID,
  WORKSPACE_ID,
  adminActor,
  bootRallyApp,
  uniqueKey,
} from './support/flow-harness';

/** A synthetic recipient id — the read model keys on recipientId (no FK), so a
 * fresh uuid isolates each assertion from seed data and prior runs. */
const freshRecipient = () => randomUUID();

describe('BA flows: Phase 4.1 notifications (real AppModule + seeded DB)', () => {
  let app: NestFastifyApplication;
  let projects: ProjectsService;
  let workItems: WorkItemsService;
  let notifications: NotificationsService;
  let db: DrizzleDB;
  const admin = adminActor();

  beforeAll(async () => {
    app = await bootRallyApp();
    projects = app.get(ProjectsService);
    workItems = app.get(WorkItemsService);
    notifications = app.get(NotificationsService);
    db = app.get<DrizzleDB>(DRIZZLE);
  });

  afterAll(async () => {
    await app?.close();
  });

  const outboxFor = (resourceId: string) =>
    db
      .select()
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.resourceId, resourceId),
          eq(notificationOutbox.type, 'WORK_ITEM_ASSIGNED'),
        ),
      );

  // ── E2E-017a: assignment producer contract ──────────────────────────────────
  describe('E2E-017a assignment enqueues one notification for the assignee', () => {
    it('enqueues a WORK_ITEM_ASSIGNED notification for a new assignee', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'Notify Project',
      });
      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Assign me');

      await workItems.updateWorkItem(admin, story.id, { assigneeId: DEVELOPER_ID });

      const rows = await outboxFor(story.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.recipientId).toBe(DEVELOPER_ID);
      expect(rows[0]?.actorId).toBe(admin.sub);
      expect(rows[0]?.workspaceId).toBe(WORKSPACE_ID);
      // Deep-link contract: the producer threads the owning project id + item key
      // into vars so the relay can stamp metadata the client uses to open the item
      // in its OWN project context (notifications are workspace-wide).
      expect(rows[0]?.vars).toMatchObject({ itemKey: story.itemKey, projectId: project.id });
    });

    it('does NOT notify the actor when they assign the item to themselves', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'Self Assign Project',
      });
      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Mine');

      await workItems.updateWorkItem(admin, story.id, { assigneeId: admin.sub });

      const rows = await outboxFor(story.id);
      expect(rows).toHaveLength(0);
    });
  });

  // ── E2E-017b: Notification Center read model ────────────────────────────────
  describe('E2E-017b notification center list, count, filters and read state', () => {
    it('lists, counts, filters by category and clears unread state', async () => {
      const recipient = freshRecipient();
      const reader = { ...admin, sub: recipient };

      const assigned = await notifications.send({
        workspaceId: WORKSPACE_ID,
        recipientId: recipient,
        actorId: admin.sub,
        type: 'WORK_ITEM_ASSIGNED',
        title: 'You were assigned NXP-1',
      });
      const mention = await notifications.send({
        workspaceId: WORKSPACE_ID,
        recipientId: recipient,
        actorId: admin.sub,
        type: 'WORK_ITEM_MENTIONED',
        title: 'You were mentioned on NXP-2',
      });
      expect(assigned).not.toBeNull();
      expect(mention).not.toBeNull();

      // All → both; unread count → 2.
      const all = await notifications.listNotifications(reader, { unreadOnly: false });
      expect(all.map((n) => n.id).sort()).toEqual([assigned!.id, mention!.id].sort());
      expect(await notifications.getUnreadCount(reader)).toBe(2);

      // Category tabs map to template types (single source of truth).
      const assignedTab = await notifications.listNotifications(reader, {
        unreadOnly: false,
        category: 'assigned',
      });
      expect(assignedTab.map((n) => n.id)).toEqual([assigned!.id]);

      const mentionsTab = await notifications.listNotifications(reader, {
        unreadOnly: false,
        category: 'mentions',
      });
      expect(mentionsTab.map((n) => n.id)).toEqual([mention!.id]);

      // Read one → count drops; Unread tab excludes it.
      await notifications.markRead(reader, assigned!.id);
      expect(await notifications.getUnreadCount(reader)).toBe(1);
      const unread = await notifications.listNotifications(reader, { unreadOnly: true });
      expect(unread.map((n) => n.id)).toEqual([mention!.id]);

      // Mark all as read → count zero.
      await notifications.markAllRead(reader);
      expect(await notifications.getUnreadCount(reader)).toBe(0);
    });

    it('round-trips deep-link metadata through the read model', async () => {
      const recipient = freshRecipient();
      const reader = { ...admin, sub: recipient };
      const metadata = { itemKey: 'NXP-42', projectId: randomUUID() };

      const sent = await notifications.send({
        workspaceId: WORKSPACE_ID,
        recipientId: recipient,
        actorId: admin.sub,
        type: 'WORK_ITEM_ASSIGNED',
        title: 'You were assigned NXP-42',
        resourceType: 'work_item',
        metadata,
      });
      expect(sent).not.toBeNull();
      expect(sent!.metadata).toMatchObject(metadata);

      // The list read model exposes it too — this is what the client deep-links on.
      const [listed] = await notifications.listNotifications(reader, { unreadOnly: false });
      expect(listed?.metadata).toMatchObject(metadata);
    });
  });

  // ── E2E-017c: recipient isolation ───────────────────────────────────────────
  describe('E2E-017c a user only sees and acts on their own notifications', () => {
    it('never leaks another user notification and blocks cross-user mark-read', async () => {
      const owner = freshRecipient();
      const other = freshRecipient();

      const ownerNote = await notifications.send({
        workspaceId: WORKSPACE_ID,
        recipientId: owner,
        actorId: admin.sub,
        type: 'WORK_ITEM_ASSIGNED',
        title: 'Owner-only notification',
      });
      expect(ownerNote).not.toBeNull();

      // The other user's list never contains it.
      const otherReader = { ...admin, sub: other };
      const otherList = await notifications.listNotifications(otherReader, { unreadOnly: false });
      expect(otherList.map((n) => n.id)).not.toContain(ownerNote!.id);

      // …and they cannot mark it read.
      await expect(notifications.markRead(otherReader, ownerNote!.id)).rejects.toMatchObject({
        code: 'NOTIFICATION_NOT_FOUND',
      });

      // The rightful owner still sees it unread.
      const ownerReader = { ...admin, sub: owner };
      expect(await notifications.getUnreadCount(ownerReader)).toBe(1);
    });
  });
});
