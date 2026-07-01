/**
 * work schema — projects, work_items, workflow_statuses, workflow_transitions,
 *               sprints, releases, project_counters, sprint_daily_snapshots,
 *               comments, attachments, custom_field_defs,
 *               time_logs, work_item_watchers
 * Canonical DDL: 05_Architecture/DATABASE_SCHEMA.md §9
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  date,
  jsonb,
  bigint,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// tsvector is not a built-in Drizzle column type — define it so the ORM can
// reference the generated column in WHERE clauses (schema-level read-only).
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
import {
  projectStatusEnum,
  projectMemberStatusEnum,
  projectTeamStatusEnum,
  workItemTypeEnum,
  workItemPriorityEnum,
  workItemScheduleStateEnum,
  workflowStatusCategoryEnum,
  sprintStatusEnum,
  releaseStatusEnum,
  teamStatusEnum,
  teamMemberStatusEnum,
} from './enums';

export const workSchema = pgSchema('work');

// ── projects ──────────────────────────────────────────────────────────────

export const projects = workSchema.table(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    key: varchar('key', { length: 10 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    leadId: uuid('lead_id'),
    status: projectStatusEnum('status').notNull().default('active'),
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('ix_projects_tenant').on(t.tenantId),
    workspaceIdx: index('ix_projects_workspace').on(t.workspaceId),
    keyIdx: uniqueIndex('uq_projects_key')
      .on(t.tenantId, t.key)
      .where(sql`deleted_at IS NULL`),
  }),
);

// ── project_counters (item_key seq) ───────────────────────────────────────

export const projectCounters = workSchema.table('project_counters', {
  projectId: uuid('project_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  lastItemNumber: integer('last_item_number').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── work_items ────────────────────────────────────────────────────────────

export const workItems = workSchema.table(
  'work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    itemKey: varchar('item_key', { length: 30 }).notNull(),
    type: workItemTypeEnum('type').notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    statusId: uuid('status_id').notNull(),
    // Sidebar "Flow State" is rendered from statusId → workflow_statuses.
    // scheduleState is the orthogonal Rally business-maturity dimension.
    scheduleState: workItemScheduleStateEnum('schedule_state').notNull().default('defined'),
    priority: workItemPriorityEnum('priority').notNull().default('none'),
    assigneeId: uuid('assignee_id'),
    reporterId: uuid('reporter_id'),
    parentId: uuid('parent_id'),
    teamId: uuid('team_id'),
    iterationId: uuid('iteration_id'),
    releaseId: uuid('release_id'),
    storyPoints: integer('story_points'),
    // Task time tracking (hours). actual is manual entry in Phase 1.
    estimateHours: numeric('estimate_hours', { precision: 8, scale: 2 }),
    todoHours: numeric('todo_hours', { precision: 8, scale: 2 }),
    actualHours: numeric('actual_hours', { precision: 8, scale: 2 }),
    acceptanceCriteria: text('acceptance_criteria'),
    // Dedicated rich-text fields (sanitized server-side), distinct from comments.
    notes: text('notes'),
    releaseNotes: text('release_notes'),
    isBlocked: boolean('is_blocked').notNull().default(false),
    blockedReason: text('blocked_reason'),
    rank: varchar('rank', { length: 255 }).notNull().default(''),
    customFields: jsonb('custom_fields').notNull().default({}),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // GENERATED ALWAYS AS (STORED) tsvector — maintained by migration 0012.
    // Read-only from the application layer; updated by Postgres on every write.
    searchVector: tsvector('search_vector'),
  },
  (t) => ({
    tenantIdx: index('ix_wi_tenant').on(t.tenantId),
    projectIdx: index('ix_wi_project').on(t.projectId),
    itemKeyIdx: uniqueIndex('uq_wi_item_key').on(t.projectId, t.itemKey),
    boardIdx: index('ix_wi_board').on(t.tenantId, t.projectId, t.statusId, t.rank),
    backlogIdx: index('ix_wi_backlog').on(t.tenantId, t.projectId, t.rank),
    // Default list/pagination path: filter (tenantId, projectId), order by createdAt,
    // excluding soft-deleted rows. Partial index keeps it lean and sort-free.
    listIdx: index('ix_wi_list')
      .on(t.tenantId, t.projectId, t.createdAt)
      .where(sql`deleted_at IS NULL`),
    // Task-list-under-parent hot path (Tasks tab + totals aggregation).
    tasksIdx: index('ix_wi_tasks')
      .on(t.parentId, t.rank)
      .where(sql`type = 'task' AND deleted_at IS NULL`),
    assigneeIdx: index('ix_wi_assignee').on(t.tenantId, t.assigneeId),
    parentIdx: index('ix_wi_parent').on(t.parentId),
    teamIdx: index('ix_wi_team').on(t.teamId),
    iterationIdx: index('ix_wi_iteration').on(t.iterationId),
    releaseIdx: index('ix_wi_release').on(t.releaseId),
    blockedIdx: index('ix_wi_blocked')
      .on(t.tenantId, t.isBlocked)
      .where(sql`is_blocked = true`),
    ftsIdx: index('ix_wi_fts').on(t.searchVector).where(sql`deleted_at IS NULL`),
  }),
);

// ── workflow_statuses ─────────────────────────────────────────────────────

export const workflowStatuses = workSchema.table(
  'workflow_statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    category: workflowStatusCategoryEnum('category').notNull(),
    color: varchar('color', { length: 20 }),
    position: integer('position').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_ws_tenant').on(t.tenantId),
    projectIdx: index('ix_ws_project').on(t.projectId),
  }),
);

// ── workflow_transitions ──────────────────────────────────────────────────

export const workflowTransitions = workSchema.table(
  'workflow_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    fromStatusId: uuid('from_status_id'), // NULL = any status
    toStatusId: uuid('to_status_id').notNull(),
    name: varchar('name', { length: 100 }),
    requiredRole: varchar('required_role', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_wt_tenant').on(t.tenantId),
    projectIdx: index('ix_wt_project').on(t.projectId),
  }),
);

// ── sprints (iterations) ──────────────────────────────────────────────────

export const sprints = workSchema.table(
  'sprints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    goal: text('goal'),
    status: sprintStatusEnum('status').notNull().default('planned'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_sprints_tenant').on(t.tenantId),
    projectIdx: index('ix_sprints_project').on(t.projectId),
    activeIdx: index('ix_sprints_active')
      .on(t.projectId, t.status)
      .where(sql`status = 'active'`),
  }),
);

// ── sprint_daily_snapshots (burndown / velocity read model) ───────────────

export const sprintDailySnapshots = workSchema.table(
  'sprint_daily_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    sprintId: uuid('sprint_id').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    totalPoints: integer('total_points').notNull().default(0),
    completedPoints: integer('completed_points').notNull().default(0),
    remainingPoints: integer('remaining_points').notNull().default(0),
    totalItems: integer('total_items').notNull().default(0),
    completedItems: integer('completed_items').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_sds_tenant').on(t.tenantId),
    sprintIdx: index('ix_sds_sprint').on(t.sprintId),
    uniqueDay: uniqueIndex('uq_sds_sprint_date').on(t.sprintId, t.snapshotDate),
  }),
);

// ── releases ──────────────────────────────────────────────────────────────

export const releases = workSchema.table(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    status: releaseStatusEnum('status').notNull().default('planned'),
    targetDate: date('target_date'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_releases_tenant').on(t.tenantId),
    projectIdx: index('ix_releases_project').on(t.projectId),
  }),
);

// ── comments ──────────────────────────────────────────────────────────────

export const comments = workSchema.table(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    parentId: uuid('parent_id'), // NULL = top-level, non-null = threaded reply
    isEdited: boolean('is_edited').notNull().default(false),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_comments_tenant').on(t.tenantId),
    workItemIdx: index('ix_comments_work_item').on(t.workItemId),
    authorIdx: index('ix_comments_author').on(t.authorId),
    parentIdx: index('ix_comments_parent').on(t.parentId),
  }),
);

// ── attachments ───────────────────────────────────────────────────────────

export const attachments = workSchema.table(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    filename: varchar('filename', { length: 500 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: varchar('storage_key', { length: 1000 }).notNull(), // S3 object key
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'completed'
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_attach_tenant').on(t.tenantId),
    workItemIdx: index('ix_attach_work_item').on(t.workItemId),
  }),
);

// ── labels ────────────────────────────────────────────────────────────────

export const labels = workSchema.table(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    color: varchar('color', { length: 20 }).notNull().default('#6b7280'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_labels_tenant').on(t.tenantId),
    projectIdx: index('ix_labels_project').on(t.projectId),
    uniqueName: uniqueIndex('uq_labels_name').on(t.projectId, t.name),
  }),
);

// ── work_item_labels (join table) ─────────────────────────────────────────

export const workItemLabels = workSchema.table(
  'work_item_labels',
  {
    workItemId: uuid('work_item_id').notNull(),
    labelId: uuid('label_id').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workItemId, t.labelId] }),
    workItemIdx: index('ix_wil_work_item').on(t.workItemId),
    labelIdx: index('ix_wil_label').on(t.labelId),
  }),
);

// ── teams (workspace-scoped) ──────────────────────────────────────────────

export const teams = workSchema.table(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    key: varchar('key', { length: 10 }).notNull(),
    description: text('description'),
    leadId: uuid('lead_id'),
    status: teamStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_teams_tenant').on(t.tenantId),
    workspaceIdx: index('ix_teams_workspace').on(t.workspaceId),
    uniqueKey: uniqueIndex('uq_teams_key').on(t.workspaceId, t.key),
  }),
);

// ── team_members ──────────────────────────────────────────────────────────

export const teamMembers = workSchema.table(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    teamId: uuid('team_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: teamMemberStatusEnum('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_tm_tenant').on(t.tenantId),
    teamIdx: index('ix_tm_team').on(t.teamId),
    uniqueMember: uniqueIndex('uq_team_member').on(t.teamId, t.userId),
  }),
);

// ── project_teams (project–team link) ────────────────────────────────────

export const projectTeams = workSchema.table(
  'project_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    teamId: uuid('team_id').notNull(),
    status: projectTeamStatusEnum('status').notNull().default('active'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_pt_tenant').on(t.tenantId),
    projectIdx: index('ix_pt_project').on(t.projectId),
    uniqueLink: uniqueIndex('uq_project_team').on(t.projectId, t.teamId),
  }),
);

// ── project_members ───────────────────────────────────────────────────────

export const projectMembers = workSchema.table(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id'),
    status: projectMemberStatusEnum('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_pm_tenant').on(t.tenantId),
    projectIdx: index('ix_pm_project').on(t.projectId),
    userIdx: index('ix_pm_user').on(t.userId),
    uniqueMember: uniqueIndex('uq_project_member').on(t.projectId, t.userId),
  }),
);

// ── activity_logs (Revision History — sync, same-tx, read-your-writes) ──────
//
// Product-facing revision feed shown in the Work Item / Task "Revision History"
// tab. Written in the SAME transaction as the mutation so the actor sees their
// change immediately. Deliberately SEPARATE from audit.audit_logs (async,
// outbox-fed, SOC2 compliance) — different consistency, retention and access.
// Append-only; never stores rich-text bodies, secrets or tokens.

export const activityLogs = workSchema.table(
  'activity_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    projectId: uuid('project_id').notNull(),
    // Anchor row: parent work item id for both item and task activity, so the
    // item history can show task changes too. entityId is the concrete subject.
    workItemId: uuid('work_item_id').notNull(),
    entityType: varchar('entity_type', { length: 30 }).notNull(), // 'work_item' | 'task' | 'attachment'
    entityId: uuid('entity_id').notNull(),
    actorId: uuid('actor_id'), // null = system action
    action: varchar('action', { length: 60 }).notNull(), // e.g. 'work_item.assigned'
    // { field, old, new } — short scalar values only, never rich-text body.
    changes: jsonb('changes'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ix_activity_tenant').on(t.tenantId),
    // Primary read path: history for one work item, newest first.
    workItemIdx: index('ix_activity_work_item').on(t.workItemId, t.createdAt),
    projectIdx: index('ix_activity_project').on(t.projectId),
  }),
);

// ── time_logs ─────────────────────────────────────────────────────────────────
// Per-user time entries against a work item (added in migration 0012).
// actual_hours on work_items is kept in sync by the trg_sync_actual_hours trigger.

export const timeLogs = workSchema.table(
  'time_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),
    userId: uuid('user_id').notNull(),
    loggedDate: date('logged_date').notNull(),
    hours: numeric('hours', { precision: 6, scale: 2 }).notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('ix_tl_tenant').on(t.tenantId),
    workItemIdx: index('ix_tl_work_item').on(t.workItemId).where(sql`deleted_at IS NULL`),
    userIdx: index('ix_tl_user').on(t.userId, t.loggedDate),
  }),
);

// ── work_item_watchers ────────────────────────────────────────────────────────
// Follower/subscriber list for notification fan-out (added in migration 0012).
// Composite primary key: one row per (workItem, user) pair.

export const workItemWatchers = workSchema.table(
  'work_item_watchers',
  {
    workItemId: uuid('work_item_id').notNull(),
    userId: uuid('user_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    watchedAt: timestamp('watched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workItemId, t.userId] }),
    userIdx: index('ix_wiw_user').on(t.userId),
    tenantIdx: index('ix_wiw_tenant').on(t.tenantId),
  }),
);
