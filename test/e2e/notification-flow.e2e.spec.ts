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
import type { TestingModule } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotificationsService, NotificationPreferencesService } from '@modules/notifications';
import { ProjectsService } from '@modules/projects';
import { WorkItemsService } from '@modules/work-items';
import { DRIZZLE, type DrizzleDB } from '@platform';

import { notificationOutbox, emailOutbox } from '../../db/schema/messaging';
import { inAppNotifications } from '../../db/schema/notifications';
import type { NotificationRelayService } from '../../apps/worker/src/notifications/notification-relay.service';
import type { EmailRelayService } from '../../apps/worker/src/email/email-relay.service';
import {
  DEVELOPER_ID,
  WORKSPACE_ID,
  adminActor,
  bootRallyApp,
  bootRallyWorkerRelays,
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

  // ── E2E-017d: FR-019 recipient access gating ────────────────────────────────
  describe('E2E-017d notifications reach only users allowed to access the item', () => {
    it('drops mentioned users without project access (FR-019)', async () => {
      const project = await projects.createProject(admin, {
        key: uniqueKey(),
        name: 'FR-019 Project',
      });
      const story = await workItems.createWorkItem(admin, project.id, 'story', 'Mention gating');
      // DEVELOPER_ID holds a workspace-scoped role → access to every project.
      // A fresh uuid has no role assignment → no access, must be filtered out.
      const outsider = randomUUID();

      await workItems.notifyCommentAdded(admin, story.id, [DEVELOPER_ID, outsider]);

      const rows = await db
        .select()
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.resourceId, story.id),
            eq(notificationOutbox.type, 'WORK_ITEM_MENTIONED'),
          ),
        );
      const recipients = rows.map((r) => r.recipientId);
      expect(recipients).toContain(DEVELOPER_ID);
      expect(recipients).not.toContain(outsider);
    });
  });
});

// ── E2E-017e: the Worker relay half of the pipeline ─────────────────────────
//
// The suite above proves the producer contract (API → notification_outbox)
// and the read model (in_app_notifications → NotificationsService). This
// block proves the middle: the real NotificationRelayService/EmailRelayService
// fetchBatch → processRow → markSent/markFailed cycle, preference suppression
// at delivery time, the notification→email cascade, and retry/backoff on a
// forced failure — none of which the producer-only suite above can reach
// (the "P4.1 notifications" suite header explicitly scoped this out).
describe('BA flows: Worker relay — real fetchBatch/processRow/markSent/markFailed', () => {
  let workerModule: TestingModule;
  let notificationRelay: NotificationRelayService;
  let emailRelay: EmailRelayService;
  let prefs: NotificationPreferencesService;
  let db: DrizzleDB;
  const admin = adminActor();

  beforeAll(async () => {
    const worker = await bootRallyWorkerRelays();
    workerModule = worker.module;
    notificationRelay = worker.notificationRelay;
    emailRelay = worker.emailRelay;
    prefs = workerModule.get(NotificationPreferencesService);
    db = workerModule.get<DrizzleDB>(DRIZZLE);
  });

  afterAll(async () => {
    await workerModule?.close();
  });

  const freshRecipient = () => randomUUID();

  /**
   * PostCommitTask (SSE push + email scheduling) runs fire-and-forget AFTER
   * the relay's transaction commits (see AbstractOutboxRelay.relay() — "run
   * post-commit tasks (fire-and-forget, non-critical)"), so `await relay()`
   * resolving does not guarantee the cascade's email_outbox insert has
   * landed yet. Poll briefly instead of asserting immediately.
   */
  async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 2000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await check();
      if (result !== undefined) return result;
      if (Date.now() > deadline) throw new Error(`waitFor() timed out after ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it('delivers a pending outbox row to in_app_notifications and marks it sent', async () => {
    const recipientId = freshRecipient();
    const [row] = await db
      .insert(notificationOutbox)
      .values({
        workspaceId: WORKSPACE_ID,
        recipientId,
        actorId: admin.sub,
        type: 'WORK_ITEM_ASSIGNED',
        vars: { itemKey: 'NXP-900', itemTitle: 'Relay smoke test', projectId: randomUUID() },
        resourceId: randomUUID(),
      })
      .returning();

    await notificationRelay.relay();

    const [after] = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, row.id));
    expect(after?.status).toBe('sent');
    expect(after?.dispatchedAt).not.toBeNull();

    const delivered = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.recipientId, recipientId));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.type).toBe('WORK_ITEM_ASSIGNED');
    expect(delivered[0]?.title).toContain('NXP-900');
  });

  it('honours an in-app opt-out: the row is marked sent but no in_app_notifications row is written', async () => {
    const recipientId = freshRecipient();
    // Wildcard opt-out — the relay checks this at delivery time (not schedule
    // time), so it applies even though the row was already queued.
    await prefs.upsert({ workspaceId: WORKSPACE_ID, userId: recipientId, type: '*', inApp: false });

    await db.insert(notificationOutbox).values({
      workspaceId: WORKSPACE_ID,
      recipientId,
      actorId: admin.sub,
      type: 'WORK_ITEM_ASSIGNED',
      vars: { itemKey: 'NXP-901', itemTitle: 'Opted out', projectId: randomUUID() },
      resourceId: randomUUID(),
    });

    await notificationRelay.relay();

    const delivered = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.recipientId, recipientId));
    expect(delivered).toHaveLength(0);

    await prefs.reset(WORKSPACE_ID, recipientId, '*');
  });

  it('cascades to a scheduled email when the recipient has email enabled (default)', async () => {
    // The relay looks up an email address from identity.users — target the
    // seeded admin (a real user row) so the lookup inside
    // scheduleNotificationEmail() succeeds instead of skipping with "recipient
    // not found".
    const [row] = await db
      .insert(notificationOutbox)
      .values({
        workspaceId: WORKSPACE_ID,
        recipientId: admin.sub,
        actorId: admin.sub,
        type: 'WORK_ITEM_COMMENTED',
        vars: { itemKey: 'NXP-902', itemTitle: 'Cascade test', projectId: randomUUID() },
        resourceId: randomUUID(),
      })
      .returning();

    await notificationRelay.relay();

    // The cascade's email idempotency key is scoped to the resulting
    // in_app_notifications.id (a freshly-generated uuidv7), NOT the outbox
    // row's own id — resolve it via sourceEventId, which the relay sets to
    // the outbox row's id when no custom idempotencyKey was supplied.
    const [delivered] = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.sourceEventId, row.id));
    expect(delivered).toBeDefined();

    // Both relays are booted with their Valkey wake-signal subscriptions live
    // (see bootRallyWorkerRelays()), so EmailSchedulerService.schedule()'s
    // wake publish can trigger the email relay to drain this row before this
    // test's own explicit emailRelay.relay() call below runs — status may
    // already be 'sent' by the time we observe it. That race is itself a
    // reflection of the real system (the whole point of the wake signal is
    // near-instant delivery), so assert only what's deterministic: the
    // cascade produced the right row, in a non-terminal-failure state.
    const emailRow = await waitFor(async () => {
      const rows = await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.idempotencyKey, `notification-email:${delivered.id}`));
      return rows[0];
    });
    expect(emailRow.template).toBe('notification');
    expect(['pending', 'sent']).toContain(emailRow.status);

    // Drain the email relay too (a no-op if the wake signal already did) —
    // proves the cascade is delivered end-to-end either way. EMAIL_PROVIDER=dev
    // (see vitest.e2e.config.ts) so this logs instead of actually sending.
    await emailRelay.relay();

    // POLL for the terminal state rather than reading once. The wake signal can
    // have a concurrent relay pass already holding this row claimed-but-not-yet
    // -marked; our explicit relay() then finds nothing to claim and returns
    // immediately, so a single read observes 'pending' and the assertion fails.
    // Measured at roughly 1 run in 10 before this change — enough to train
    // people to re-run a red build instead of reading it.
    //
    // Waiting for 'sent' asserts the same guarantee (the cascade IS delivered)
    // without depending on which pass gets there first.
    const afterEmail = await waitFor(async () => {
      const [r] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, emailRow.id));
      return r?.status === 'sent' ? r : undefined;
    });
    expect(afterEmail.status).toBe('sent');
  });

  it('does NOT cascade to email when the recipient has email disabled for this type', async () => {
    const recipientId = freshRecipient();
    await prefs.upsert({
      workspaceId: WORKSPACE_ID,
      userId: recipientId,
      type: 'WORK_ITEM_COMMENTED',
      email: false,
    });

    const [row] = await db
      .insert(notificationOutbox)
      .values({
        workspaceId: WORKSPACE_ID,
        recipientId,
        actorId: admin.sub,
        type: 'WORK_ITEM_COMMENTED',
        vars: { itemKey: 'NXP-903', itemTitle: 'No email', projectId: randomUUID() },
        resourceId: randomUUID(),
      })
      .returning();

    await notificationRelay.relay();

    const emailRows = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.idempotencyKey, `notification-email:${row.id}`));
    expect(emailRows).toHaveLength(0);

    await prefs.reset(WORKSPACE_ID, recipientId, 'WORK_ITEM_COMMENTED');
  });

  it('retries a failing row with backoff instead of exhausting all attempts immediately', async () => {
    // renderNotification()'s exhaustiveness guard throws for any type outside
    // NotificationTemplateName — the real, catchable failure mode processRow()
    // can hit (a missing var, by contrast, just renders as `undefined` in the
    // template string; it does not throw). Bypasses the DB enum type (raw SQL)
    // since notification_outbox.type is a plain varchar, not a Postgres enum.
    const badType = 'NOT_A_REAL_TEMPLATE';
    const [row] = await db
      .insert(notificationOutbox)
      .values({
        workspaceId: WORKSPACE_ID,
        recipientId: admin.sub,
        actorId: admin.sub,
        type: badType,
        vars: { itemKey: 'NXP-904' },
        resourceId: randomUUID(),
      })
      .returning();

    const before = Date.now();
    await notificationRelay.relay();

    // A single read is safe here: AbstractOutboxRelay.relay() now guarantees
    // that by the time its promise resolves, a pass that started at or after
    // THIS call has completed and processed whatever was pending at that
    // point — including this row, inserted above. (Previously relay() could
    // no-op with an immediate return while another pass was in flight, so a
    // racing call's promise could resolve before any pass had touched this
    // row at all; that's fixed at the source, not worked around here.)
    const [after] = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, row.id));
    expect(after?.status).toBe('pending'); // attempt 1/5 — not yet terminal
    expect(after?.attempts).toBe(1);
    expect(after?.lastError).toBeTruthy();
    // Backoff pushed scheduledAt forward — NOT immediately re-eligible.
    expect(after?.scheduledAt.getTime()).toBeGreaterThan(before + 20_000);

    // A relay tick right now must NOT re-process it (scheduledAt is in the future).
    await notificationRelay.relay();
    const [stillOne] = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, row.id));
    expect(stillOne?.attempts).toBe(1);
  });
});
