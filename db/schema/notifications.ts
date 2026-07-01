/**
 * notifications schema — in_app_notifications
 * Canonical DDL: 05_Architecture/DATABASE_SCHEMA.md §9
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const notificationsSchema = pgSchema('notifications');

export const inAppNotifications = notificationsSchema.table(
  'in_app_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    actorId: uuid('actor_id'), // who triggered the notification
    type: varchar('type', { length: 100 }).notNull(), // e.g. 'work_item.assigned'
    title: varchar('title', { length: 500 }).notNull(),
    body: text('body'),
    resourceType: varchar('resource_type', { length: 50 }), // 'work_item' | 'sprint' | etc.
    resourceId: uuid('resource_id'),
    metadata: jsonb('metadata').notNull().default({}),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Populated by SQS consumer with the outbox eventId for deduplication.
    sourceEventId: uuid('source_event_id'),
  },
  (t) => ({
    recipientIdx: index('ix_ian_recipient').on(t.tenantId, t.recipientId, t.isRead),
    createdIdx: index('ix_ian_created').on(t.recipientId, t.createdAt),
    resourceIdx: index('ix_ian_resource').on(t.resourceType, t.resourceId),
    sourceEventIdx: uniqueIndex('uq_ian_source_event_id').on(t.sourceEventId),
  }),
);

/**
 * notification_preferences — per-user, per-type channel opt-in/out.
 *
 * Defaults: both channels enabled (no row = opted in).
 * type='*' is a wildcard / master switch for all notification types.
 * A specific type row takes priority over the wildcard.
 *
 * Examples:
 *   ('*',         inApp=true,  email=false) → opt out of ALL email
 *   ('work_item.assigned', inApp=true, email=true) → re-enable email for this type
 *   ('work_item.assigned', inApp=false, email=false) → mute this type entirely
 */
export const notificationPreferences = notificationsSchema.table(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** Dot-namespaced event type or '*' for wildcard (master switch). */
    type: varchar('type', { length: 100 }).notNull(),
    /** Deliver in-app notification for this type? */
    inApp: boolean('in_app').notNull().default(true),
    /** Send email notification for this type? */
    email: boolean('email').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Primary lookup key: one row per (tenant, user, type). */
    userTypeIdx: uniqueIndex('uq_notif_pref_user_type').on(t.tenantId, t.userId, t.type),
  }),
);
