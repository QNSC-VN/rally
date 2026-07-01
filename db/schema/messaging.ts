/**
 * messaging schema — outbox_events, email_outbox, notification_outbox
 * Canonical DDL: 05_Architecture/DATABASE_SCHEMA.md §9
 */
import {
  pgSchema,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { outboxStatusEnum, emailJobStatusEnum, notificationJobStatusEnum } from './enums';

export const messagingSchema = pgSchema('messaging');

export const outboxEvents = messagingSchema.table(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    eventType: varchar('event_type', { length: 255 }).notNull(),
    version: integer('version').notNull().default(1),
    aggregateType: varchar('aggregate_type', { length: 100 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Partition column — see DATABASE_SCHEMA.md §8 for monthly range partitioning
    partitionKey: timestamp('partition_key', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('ix_outbox_status')
      .on(t.status, t.createdAt)
      .where(sql`status = 'pending'`),
    tenantIdx: index('ix_outbox_tenant').on(t.tenantId),
    eventIdIdx: index('ix_outbox_event_id').on(t.eventId),
  }),
);

/**
 * email_outbox — transactional email job queue.
 *
 * API-side services INSERT rows in the SAME DB transaction that writes the
 * business data (e.g. password_reset_tokens). The worker EmailRelayService
 * polls this table, renders the named template, and dispatches via
 * IEmailProvider. Guarantees at-least-once delivery with no dual-write.
 *
 *   template — key into EmailTemplateRegistry ('password-reset', 'workspace-invitation', …)
 *   vars     — opaque JSONB passed to the template renderer
 *   attempts — incremented on send failure; relay stops at MAX_ATTEMPTS
 */
export const emailOutbox = messagingSchema.table(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Recipient address (RFC 5321 max 320 chars). */
    to: varchar('to', { length: 320 }).notNull(),
    template: varchar('template', { length: 100 }).notNull(),
    vars: jsonb('vars').notNull().default({}),
    status: emailJobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Caller-supplied deduplication key (nullable for legacy rows).
     * UNIQUE constraint prevents the same business event from producing two
     * email_outbox rows even under concurrent API retries.
     *
     * Convention:
     *   password-reset       → sha256('password-reset:' + tokenHash)
     *   workspace-invitation → invitation.id
     *   future notifications → notification.id
     *
     * Insert uses ON CONFLICT (idempotency_key) DO NOTHING so a duplicate
     * schedule() call is silently swallowed within the same DB transaction.
     */
    idempotencyKey: varchar('idempotency_key', { length: 255 }).unique(),
    /**
     * Optional: the internal user ID this email was scheduled for.
     * Populated for notification emails (e.g. access_request.approved).
     * NULL for transactional emails without a known recipient user
     * (e.g. password reset sent to an external address).
     * Used by EmailRelayService to check notification_preferences.
     */
    recipientId: uuid('recipient_id'),
    tenantId: uuid('tenant_id'),
  },
  (t) => ({
    statusIdx: index('ix_email_outbox_status')
      .on(t.status, t.scheduledAt)
      .where(sql`status = 'pending'`),
  }),
);

/**
 * notification_outbox — transactional outbox for in-app notifications.
 *
 * API-side services INSERT rows in the SAME DB transaction as their business
 * data (NotificationSchedulerService). The worker NotificationRelayService
 * polls this table, renders the notification template, and dispatches via
 * NotificationsService.send() → in_app_notifications.
 *
 * Guarantees at-least-once delivery, no dual-write, deduplication via
 * idempotency_key + source_event_id on the in_app_notifications table.
 *
 *   type     — key into NotificationTemplateRegistry ('WORKSPACE_INVITATION', …)
 *   vars     — opaque JSONB passed to the template renderer
 *   resource_id — UUID of the resource this notification links to (nullable)
 */
export const notificationOutbox = messagingSchema.table(
  'notification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    actorId: uuid('actor_id'),
    type: varchar('type', { length: 100 }).notNull(),
    vars: jsonb('vars').notNull().default({}),
    /** UUID of the resource this notification links to (work item, workspace, etc.) */
    resourceId: uuid('resource_id'),
    status: notificationJobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Caller-supplied deduplication key (nullable for rows without a stable key).
     * UNIQUE constraint prevents duplicate outbox rows for the same business event.
     *
     * Convention (mirror of email_outbox):
     *   workspace-invitation → invitation.id
     *   work-item-assigned   → sha256('assigned:' + assignmentId)
     *
     * This same value is passed as sourceEventId to in_app_notifications for
     * end-to-end idempotency across relay retries.
     */
    idempotencyKey: varchar('idempotency_key', { length: 255 }).unique(),
  },
  (t) => ({
    statusIdx: index('ix_notification_outbox_status')
      .on(t.status, t.scheduledAt)
      .where(sql`status = 'pending'`),
  }),
);
