/**
 * work schema — projects, work_items, workflow_statuses, workflow_transitions,
 *               iterations, releases, project_counters, iteration_daily_snapshots,
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
  iterationStateEnum,
  releaseStatusEnum,
  teamStatusEnum,
  teamMemberStatusEnum,
  attachmentStatusEnum,
  activityEntityTypeEnum,
  milestoneStatusEnum,
  defectSeverityEnum,
  defectEnvironmentEnum,
  defectRootCauseEnum,
  defectResolutionEnum,
  defectStateEnum,
  taskStateEnum,
  workItemRelationTypeEnum,
} from './enums';

export const workSchema = pgSchema('work');

// ── projects ──────────────────────────────────────────────────────────────

export const projects = workSchema.table(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    key: varchar('key', { length: 10 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    leadId: uuid('lead_id'),
    startDate: date('start_date'),
    status: projectStatusEnum('status').notNull().default('active'),
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    workspaceIdx: index('ix_projects_workspace').on(t.workspaceId),
    keyIdx: uniqueIndex('uq_projects_workspace_key')
      .on(t.workspaceId, t.key)
      .where(sql`deleted_at IS NULL`),
  }),
);

// ── project_counters (item_key seq) ───────────────────────────────────────
// Per-project, per-type sequential counter. Composite PK (projectId, itemType)
// ensures each work-item type has its own numbering sequence.

export const projectCounters = workSchema.table(
  'project_counters',
  {
    projectId: uuid('project_id').notNull(),
    itemType: workItemTypeEnum('item_type').notNull().default('story'),
    workspaceId: uuid('workspace_id').notNull(),
    lastItemNumber: integer('last_item_number').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [{ pk: primaryKey({ columns: [table.projectId, table.itemType] }) }],
);

// ── work_items ────────────────────────────────────────────────────────────

export const workItems = workSchema.table(
  'work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    itemKey: varchar('item_key', { length: 30 }).notNull(),
    type: workItemTypeEnum('type').notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    // Kanban board column (Future Team Board). NOT the BA "Flow State" — that is
    // the flowState column below. Retained for the project-configurable board.
    statusId: uuid('status_id').notNull(),
    // BR-WI-01 — Schedule State and Flow State share the same six values and
    // MIRROR bidirectionally. Both are business-maturity dimensions; the mirror
    // is enforced centrally in the work-item repository write path so they can
    // never drift. Flow State reuses the schedule-state enum (identical catalog).
    scheduleState: workItemScheduleStateEnum('schedule_state').notNull().default('defined'),
    flowState: workItemScheduleStateEnum('flow_state').notNull().default('defined'),
    priority: workItemPriorityEnum('priority').notNull().default('none'),
    assigneeId: uuid('assignee_id'),
    reporterId: uuid('reporter_id'),
    parentId: uuid('parent_id'),
    teamId: uuid('team_id'),
    iterationId: uuid('iteration_id'),
    releaseId: uuid('release_id'),
    // Plan Estimate. numeric(6,2) allows fractional points (e.g. 0.5) per SRS §8;
    // Drizzle returns numeric as a string to preserve precision.
    storyPoints: numeric('story_points', { precision: 6, scale: 2 }),
    // Task time tracking (hours). To Do and Actual are manual inputs; Estimate
    // is read-only derived in the application layer as (To Do + Actual) per
    // SRS P1-TASK-01. Drizzle returns numeric as a string to preserve precision.
    estimateHours: numeric('estimate_hours', { precision: 8, scale: 2 }),
    todoHours: numeric('todo_hours', { precision: 8, scale: 2 }),
    actualHours: numeric('actual_hours', { precision: 8, scale: 2 }),
    acceptanceCriteria: text('acceptance_criteria'),
    // Dedicated rich-text fields (sanitized server-side), distinct from comments.
    notes: text('notes'),
    releaseNotes: text('release_notes'),
    devOwnerId: uuid('dev_owner_id'),
    // P3.4 — Defect-specific fields (only meaningful when type = 'defect')
    severity: defectSeverityEnum('severity'),
    foundInEnvironment: defectEnvironmentEnum('found_in_environment'),
    foundInReleaseId: uuid('found_in_release_id').references(() => releases.id, {
      onDelete: 'set null',
    }),
    // P3.4 — Root cause and resolution (only meaningful when type = 'defect')
    rootCause: defectRootCauseEnum('root_cause'),
    resolution: defectResolutionEnum('resolution'),
    defectState: defectStateEnum('defect_state'),
    fixedInBuild: varchar('fixed_in_build', { length: 255 }),
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
    workspaceIdx: index('ix_wi_workspace').on(t.workspaceId),
    projectIdx: index('ix_wi_project').on(t.projectId),
    itemKeyIdx: uniqueIndex('uq_wi_item_key').on(t.projectId, t.itemKey),
    boardIdx: index('ix_wi_board').on(t.workspaceId, t.projectId, t.statusId, t.rank),
    backlogIdx: index('ix_wi_backlog').on(t.workspaceId, t.projectId, t.rank),
    // Default list/pagination path: filter (workspaceId, projectId), order by createdAt,
    // excluding soft-deleted rows. Partial index keeps it lean and sort-free.
    listIdx: index('ix_wi_list')
      .on(t.workspaceId, t.projectId, t.createdAt)
      .where(sql`deleted_at IS NULL`),
    // Task-list-under-parent hot path (Tasks tab + totals aggregation).
    tasksIdx: index('ix_wi_tasks')
      .on(t.parentId, t.rank)
      .where(sql`type = 'task' AND deleted_at IS NULL`),
    assigneeIdx: index('ix_wi_assignee').on(t.workspaceId, t.assigneeId),
    parentIdx: index('ix_wi_parent').on(t.parentId),
    teamIdx: index('ix_wi_team').on(t.teamId),
    iterationIdx: index('ix_wi_iteration').on(t.iterationId),
    releaseIdx: index('ix_wi_release').on(t.releaseId),
    blockedIdx: index('ix_wi_blocked')
      .on(t.workspaceId, t.isBlocked)
      .where(sql`is_blocked = true`),
    ftsIdx: index('ix_wi_fts')
      .on(t.searchVector)
      .where(sql`deleted_at IS NULL`),
  }),
);

// ── workflow_statuses ─────────────────────────────────────────────────────

export const workflowStatuses = workSchema.table(
  'workflow_statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    category: workflowStatusCategoryEnum('category').notNull(),
    color: varchar('color', { length: 20 }),
    position: integer('position').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_ws_workspace').on(t.workspaceId),
    projectIdx: index('ix_ws_project').on(t.projectId),
  }),
);

// ── workflow_transitions ──────────────────────────────────────────────────

export const workflowTransitions = workSchema.table(
  'workflow_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    fromStatusId: uuid('from_status_id'), // NULL = any status
    toStatusId: uuid('to_status_id').notNull(),
    name: varchar('name', { length: 100 }),
    requiredRole: varchar('required_role', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_wt_workspace').on(t.workspaceId),
    projectIdx: index('ix_wt_project').on(t.projectId),
  }),
);

// ── iterations (Rally timeboxes) ──────────────────────────────────────────
// A date-bounded planning timebox scoped to a project (and optionally a team).
// State follows the Rally vocabulary: planning → committed → accepted.

export const iterations = workSchema.table(
  'iterations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    teamId: uuid('team_id'),
    iterationKey: varchar('iteration_key', { length: 30 }),
    name: varchar('name', { length: 255 }).notNull(),
    // goal: short objective; theme: rich planning context/description.
    goal: text('goal'),
    theme: text('theme'),
    notes: text('notes'),
    state: iterationStateEnum('state').notNull().default('planning'),
    plannedVelocity: integer('planned_velocity'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_iterations_workspace').on(t.workspaceId),
    projectIdx: index('ix_iterations_project').on(t.projectId),
    teamIdx: index('ix_iterations_team').on(t.teamId),
    keyIdx: uniqueIndex('uq_iterations_key').on(t.projectId, t.iterationKey),
    committedIdx: index('ix_iterations_committed')
      .on(t.projectId, t.state)
      .where(sql`state = 'committed'`),
  }),
);

// ── iteration_daily_snapshots (burndown / velocity read model) ────────────

export const iterationDailySnapshots = workSchema.table(
  'iteration_daily_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    iterationId: uuid('iteration_id').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    // numeric(8,2) mirrors release_daily_snapshots so fractional story points
    // survive the burndown read model (matches work_items.story_points).
    totalPoints: numeric('total_points', { precision: 8, scale: 2 }).notNull().default('0'),
    completedPoints: numeric('completed_points', { precision: 8, scale: 2 }).notNull().default('0'),
    remainingPoints: numeric('remaining_points', { precision: 8, scale: 2 }).notNull().default('0'),
    totalItems: integer('total_items').notNull().default(0),
    completedItems: integer('completed_items').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_ids_workspace').on(t.workspaceId),
    iterationIdx: index('ix_ids_iteration').on(t.iterationId),
    uniqueDay: uniqueIndex('uq_ids_iteration_date').on(t.iterationId, t.snapshotDate),
  }),
);

// ── releases ──────────────────────────────────────────────────────────────

export const releases = workSchema.table(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    status: releaseStatusEnum('status').notNull().default('planning'),
    startDate: date('start_date'),
    releaseDate: date('release_date'),
    plannedVelocity: integer('planned_velocity'),
    planEstimate: numeric('plan_estimate', { precision: 8, scale: 2 }),
    version: varchar('version', { length: 100 }),
    theme: text('theme'),
    notes: text('notes'),
    releaseNotes: text('release_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_releases_workspace').on(t.workspaceId),
    projectIdx: index('ix_releases_project').on(t.projectId),
  }),
);

// ── comments ──────────────────────────────────────────────────────────────

export const comments = workSchema.table(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
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
    workspaceIdx: index('ix_comments_workspace').on(t.workspaceId),
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
    workspaceId: uuid('workspace_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    filename: varchar('filename', { length: 500 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: varchar('storage_key', { length: 1000 }).notNull(), // S3 object key
    status: attachmentStatusEnum('status').notNull().default('pending'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_attach_workspace').on(t.workspaceId),
    workItemIdx: index('ix_attach_work_item').on(t.workItemId),
  }),
);

// ── labels ────────────────────────────────────────────────────────────────

export const labels = workSchema.table(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    color: varchar('color', { length: 20 }).notNull().default('#6b7280'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_labels_workspace').on(t.workspaceId),
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
    workspaceIdx: index('ix_teams_workspace').on(t.workspaceId),
    uniqueKey: uniqueIndex('uq_teams_key').on(t.workspaceId, t.key),
  }),
);

// ── team_members ──────────────────────────────────────────────────────────

export const teamMembers = workSchema.table(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    teamId: uuid('team_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: teamMemberStatusEnum('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_tm_workspace').on(t.workspaceId),
    teamIdx: index('ix_tm_team').on(t.teamId),
    uniqueMember: uniqueIndex('uq_team_member').on(t.teamId, t.userId),
  }),
);

// ── project_teams (project–team link) ────────────────────────────────────

export const projectTeams = workSchema.table(
  'project_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    teamId: uuid('team_id').notNull(),
    status: projectTeamStatusEnum('status').notNull().default('active'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_pt_workspace').on(t.workspaceId),
    projectIdx: index('ix_pt_project').on(t.projectId),
    uniqueLink: uniqueIndex('uq_project_team').on(t.projectId, t.teamId),
  }),
);

// ── project_members ───────────────────────────────────────────────────────

export const projectMembers = workSchema.table(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id'),
    status: projectMemberStatusEnum('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_pm_workspace').on(t.workspaceId),
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
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    // Anchor row: parent work item id for both item and task activity, so the
    // item history can show task changes too. entityId is the concrete subject.
    workItemId: uuid('work_item_id').notNull(),
    entityType: activityEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    actorId: uuid('actor_id'), // null = system action
    action: varchar('action', { length: 60 }).notNull(), // e.g. 'work_item.assigned'
    // { field, old, new } — short scalar values only, never rich-text body.
    changes: jsonb('changes'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_activity_workspace').on(t.workspaceId),
    // Primary read path: history for one work item, newest first.
    workItemIdx: index('ix_activity_work_item').on(t.workItemId, t.createdAt),
    projectIdx: index('ix_activity_project').on(t.projectId),
  }),
);

// ── time_logs ─────────────────────────────────────────────────────────────────
// Per-user time entries against a work item (added in migration 0012). Retained
// as an optional worklog/audit trail. As of migration 0052 these entries no
// longer drive actual_hours — Actual is a manual input (SRS P1-TASK-01).

export const timeLogs = workSchema.table(
  'time_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
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
    workspaceIdx: index('ix_tl_workspace').on(t.workspaceId),
    workItemIdx: index('ix_tl_work_item')
      .on(t.workItemId)
      .where(sql`deleted_at IS NULL`),
    userIdx: index('ix_tl_user').on(t.userId, t.loggedDate),
  }),
);

// ── work_item_watchers ────────────────────────────────────────────────────────
// Follower/subscriber list for notification fan-out (added in migration 0012).
// Composite primary key: one row per (workItem, user) pair.

// F6 — directed links between work items (blocks / duplicates / relates_to /
// depends_on / causes). Stored once on the canonical source→target direction;
// the app derives the inverse label for the target side.
export const workItemRelations = workSchema.table(
  'work_item_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    sourceItemId: uuid('source_item_id').notNull(),
    targetItemId: uuid('target_item_id').notNull(),
    relationType: workItemRelationTypeEnum('relation_type').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex('uq_wir_source_target_type').on(t.sourceItemId, t.targetItemId, t.relationType),
    sourceIdx: index('ix_wir_source').on(t.sourceItemId),
    targetIdx: index('ix_wir_target').on(t.targetItemId),
    workspaceIdx: index('ix_wir_workspace').on(t.workspaceId),
  }),
);

export const workItemWatchers = workSchema.table(
  'work_item_watchers',
  {
    workItemId: uuid('work_item_id').notNull(),
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    watchedAt: timestamp('watched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workItemId, t.userId] }),
    userIdx: index('ix_wiw_user').on(t.userId),
    workspaceIdx: index('ix_wiw_workspace').on(t.workspaceId),
  }),
);

// ── release_daily_snapshots (burndown / scope tracking read model) ───────

export const releaseDailySnapshots = workSchema.table(
  'release_daily_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    releaseId: uuid('release_id').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    totalPoints: numeric('total_points', { precision: 8, scale: 2 }).notNull().default('0'),
    completedPoints: numeric('completed_points', { precision: 8, scale: 2 }).notNull().default('0'),
    remainingPoints: numeric('remaining_points', { precision: 8, scale: 2 }).notNull().default('0'),
    totalItems: integer('total_items').notNull().default(0),
    completedItems: integer('completed_items').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueRelease: uniqueIndex('uq_rds_release_date').on(t.releaseId, t.snapshotDate),
    releaseIdx: index('ix_rds_release').on(t.releaseId),
  }),
);

// ── tasks (P3 refactor — separate from work_items) ──────────────────────
// Child execution items belonging to a parent work item (Story / Defect).
// US and DE stay in work_items; Tasks get their own table.

export const tasks = workSchema.table(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    itemKey: varchar('item_key', { length: 30 }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    state: taskStateEnum('state').notNull().default('defined'),
    assigneeId: uuid('assignee_id'),
    teamId: uuid('team_id'),
    iterationId: uuid('iteration_id'),
    estimateHours: numeric('estimate_hours', { precision: 8, scale: 2 }),
    todoHours: numeric('todo_hours', { precision: 8, scale: 2 }),
    actualHours: numeric('actual_hours', { precision: 8, scale: 2 }),
    rank: varchar('rank', { length: 255 }).notNull().default(''),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    workspaceIdx: index('ix_tasks_workspace').on(t.workspaceId),
    projectIdx: index('ix_tasks_project').on(t.projectId),
    parentIdx: index('ix_tasks_parent').on(t.parentId),
    iterationIdx: index('ix_tasks_iteration').on(t.iterationId),
    assigneeIdx: index('ix_tasks_assignee').on(t.assigneeId),
    teamIdx: index('ix_tasks_team').on(t.teamId),
    rankIdx: index('ix_tasks_rank').on(t.parentId, t.rank),
    itemKeyIdx: uniqueIndex('uq_task_item_key').on(t.projectId, t.itemKey),
  }),
);

// ── milestones (P3.3) ────────────────────────────────────────────────────
// Project-level milestone that can link to multiple releases.
// Target dates are derived from linked releases (read-only, computed).

export const milestones = workSchema.table(
  'milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    notes: text('notes'),
    status: milestoneStatusEnum('status').notNull().default('planned'),
    ownerId: uuid('owner_id'),
    targetStartDate: date('target_start_date'),
    targetEndDate: date('target_end_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('ix_milestones_workspace').on(t.workspaceId),
    projectIdx: index('ix_milestones_project').on(t.projectId),
  }),
);

// ── milestone_releases (link table) ──────────────────────────────────────

export const milestoneReleases = workSchema.table(
  'milestone_releases',
  {
    milestoneId: uuid('milestone_id').notNull(),
    releaseId: uuid('release_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.milestoneId, t.releaseId] }),
    milestoneIdx: index('ix_mr_milestone').on(t.milestoneId),
    releaseIdx: index('ix_mr_release').on(t.releaseId),
  }),
);

// ── milestone_projects (P3.3 multi-project support) ────────────────────
export const milestoneProjects = workSchema.table(
  'milestone_projects',
  {
    milestoneId: uuid('milestone_id').notNull(),
    projectId: uuid('project_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.milestoneId, t.projectId] }),
    milestoneIdx: index('ix_mp_milestone').on(t.milestoneId),
    projectIdx: index('ix_mp_project').on(t.projectId),
  }),
);

// ── milestone_teams (P3.3 multi-team support) ─────────────────────────
export const milestoneTeams = workSchema.table(
  'milestone_teams',
  {
    milestoneId: uuid('milestone_id').notNull(),
    teamId: uuid('team_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.milestoneId, t.teamId] }),
    milestoneIdx: index('ix_mt_milestone').on(t.milestoneId),
    teamIdx: index('ix_mt_team').on(t.teamId),
  }),
);

// ── milestone_artifacts (P3.3 — US/DE assigned to milestone) ──────────
export const milestoneArtifacts = workSchema.table(
  'milestone_artifacts',
  {
    milestoneId: uuid('milestone_id').notNull(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.milestoneId, t.workItemId] }),
    milestoneIdx: index('ix_ma_milestone').on(t.milestoneId),
    workItemIdx: index('ix_ma_work_item').on(t.workItemId),
  }),
);

// ── member_capacity (P3.1 Team Status) ─────────────────────────────────

export const memberCapacity = workSchema.table(
  'member_capacity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    teamId: uuid('team_id').notNull(),
    iterationId: uuid('iteration_id').notNull(),
    userId: uuid('user_id').notNull(),
    capacityHours: numeric('capacity_hours', { precision: 8, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueMember: uniqueIndex('uq_member_capacity').on(
      t.projectId,
      t.teamId,
      t.iterationId,
      t.userId,
    ),
    workspaceIdx: index('ix_mc_workspace').on(t.workspaceId),
    iterationIdx: index('ix_mc_iteration').on(t.iterationId),
    userIdx: index('ix_mc_user').on(t.userId),
  }),
);
