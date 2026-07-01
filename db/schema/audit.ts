/**
 * audit schema — audit_logs
 * Canonical DDL: 05_Architecture/DATABASE_SCHEMA.md §9
 */
import { pgSchema, uuid, varchar, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const auditSchema = pgSchema('audit');

export const auditLogs = auditSchema.table(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    actorId: uuid('actor_id'), // null = system action
    actorEmail: varchar('actor_email', { length: 255 }),
    action: varchar('action', { length: 100 }).notNull(), // e.g. 'work_item.created'
    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    resourceId: uuid('resource_id').notNull(),
    projectId: uuid('project_id'),
    changes: jsonb('changes'), // { before, after } diff
    metadata: jsonb('metadata').notNull().default({}),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 500 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    // Populated by SQS consumer with the outbox eventId. Used for at-most-once
    // deduplication: if the same outbox event is delivered twice, the second
    // INSERT hits this unique index and is silently dropped (ON CONFLICT DO NOTHING).
    sourceEventId: uuid('source_event_id'),
  },
  (t) => ({
    tenantIdx: index('ix_audit_tenant').on(t.tenantId, t.occurredAt),
    actorIdx: index('ix_audit_actor').on(t.tenantId, t.actorId),
    resourceIdx: index('ix_audit_resource').on(t.resourceType, t.resourceId),
    projectIdx: index('ix_audit_project').on(t.projectId, t.occurredAt),
    // Partial-equivalent: Postgres allows multiple NULLs in a unique index,
    // so this only enforces uniqueness for non-NULL sourceEventId values.
    sourceEventIdx: uniqueIndex('uq_audit_source_event_id').on(t.sourceEventId),
  }),
);
