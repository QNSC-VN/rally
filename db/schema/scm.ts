/**
 * scm schema — source-control "Connections" (Pull Requests) and Changesets
 * (commits) linked to work items, plus the repo→project mapping and a durable
 * webhook inbox.
 *
 * Link model (Rally-faithful): the work-item formatted key (e.g. US-1) embedded
 * in a PR title / branch name / commit message is what associates an SCM
 * artifact to a work item. A webhook carries the repository, so `repositories`
 * maps a repo to the project(s) whose keys it may reference; resolution is then
 * (key + project) → work item (work.work_items is unique on (project_id, item_key)).
 *
 * Ingestion is async: the API persists raw webhook events to `webhook_inbox`
 * (fast 202) and a worker relay parses + links them with retry/backoff. Dedup
 * is by unique constraints (delivery id; (work_item_id, external_id) for
 * connections; (work_item_id, revision) for changesets) so at-least-once
 * delivery never produces duplicates.
 *
 * Enum-like columns are `varchar` (mirrors work.iteration_activity_logs.action)
 * so the migration is self-contained with no CREATE TYPE. Workspace isolation is
 * enforced in the app layer (RLS dropped in migration 0025).
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const scmSchema = pgSchema('scm');

/** One change entry inside a changeset's `changes` array. */
export type ScmChange = { action: 'A' | 'M' | 'D'; path: string };

// ── repositories — SCM repo identity + the mapping side of repo↔project ──────

export const scmRepositories = scmSchema.table(
  'repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    /** 'github' (github.com) | 'ghe' (GitHub Enterprise); provider-tagged for future SCMs. */
    provider: varchar('provider', { length: 20 }).notNull(),
    /** owner/name, e.g. "DT-SFI/dt". */
    fullName: varchar('full_name', { length: 255 }).notNull(),
    /** Base web URL of the SCM host, e.g. "https://ghe.coxautoinc.com" (for building links). */
    baseUrl: varchar('base_url', { length: 512 }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_scm_repositories_workspace').on(t.workspaceId),
    fullNameIdx: uniqueIndex('uq_scm_repositories_workspace_full_name').on(
      t.workspaceId,
      t.provider,
      t.fullName,
    ),
  }),
);

/** Many-to-many repo↔project: a repo may serve several projects (monorepo). */
export const scmRepositoryProjects = scmSchema.table(
  'repository_projects',
  {
    repositoryId: uuid('repository_id').notNull(),
    projectId: uuid('project_id').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.repositoryId, t.projectId] }),
    projectIdx: index('ix_scm_repository_projects_project').on(t.projectId),
  }),
);

// ── webhook_inbox — durable raw events (async ingestion) ─────────────────────

export const scmWebhookInbox = scmSchema.table(
  'webhook_inbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 20 }).notNull(),
    /** Provider delivery id (GitHub X-GitHub-Delivery) — dedup key against redelivery. */
    deliveryId: varchar('delivery_id', { length: 255 }).notNull(),
    /** Provider event name (GitHub X-GitHub-Event): 'pull_request' | 'push' | … */
    eventType: varchar('event_type', { length: 60 }).notNull(),
    payload: jsonb('payload').notNull(),
    /** 'pending' | 'processed' | 'ignored' | 'failed'. */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deliveryIdx: uniqueIndex('uq_scm_inbox_delivery').on(t.provider, t.deliveryId),
    pendingIdx: index('ix_scm_inbox_pending')
      .on(t.status, t.scheduledAt)
      .where(sql`status = 'pending'`),
  }),
);

// ── connections — Pull Requests (and future builds/branches) ─────────────────

export const scmConnections = scmSchema.table(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),
    provider: varchar('provider', { length: 20 }).notNull(),
    /** 'pull_request' | 'build' | 'branch'. */
    type: varchar('type', { length: 20 }).notNull(),
    /** Stable external identity, e.g. "DT-SFI/dt#28743" — dedup key per work item. */
    externalId: varchar('external_id', { length: 255 }).notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    /** PR state: 'open' | 'closed' | 'merged' (nullable for non-PR types). */
    state: varchar('state', { length: 20 }),
    authorName: varchar('author_name', { length: 255 }),
    /** Artifact's own creation time at the source (PR createdAt). */
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workItemIdx: index('ix_scm_connections_work_item').on(t.workItemId),
    workspaceIdx: index('ix_scm_connections_workspace').on(t.workspaceId),
    dedupIdx: uniqueIndex('uq_scm_connections_item_external').on(t.workItemId, t.externalId),
  }),
);

// ── changesets — commits ─────────────────────────────────────────────────────

export const scmChangesets = scmSchema.table(
  'changesets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),
    provider: varchar('provider', { length: 20 }).notNull(),
    /** Full commit SHA. */
    revision: varchar('revision', { length: 64 }).notNull(),
    /** Display name, e.g. "dt:5fda056a" (repoShort:shortSha). */
    name: varchar('name', { length: 128 }).notNull(),
    message: text('message'),
    uri: text('uri'),
    authorName: varchar('author_name', { length: 255 }),
    authorEmail: varchar('author_email', { length: 320 }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    /** Per-file changes: [{ action:'A'|'M'|'D', path }]. */
    changes: jsonb('changes').$type<ScmChange[]>().notNull().default([]),
    repositoryFullName: varchar('repository_full_name', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workItemIdx: index('ix_scm_changesets_work_item').on(t.workItemId),
    workspaceIdx: index('ix_scm_changesets_workspace').on(t.workspaceId),
    dedupIdx: uniqueIndex('uq_scm_changesets_item_revision').on(t.workItemId, t.revision),
  }),
);
