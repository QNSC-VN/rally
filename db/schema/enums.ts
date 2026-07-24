/**
 * Centralised Drizzle pgEnum definitions for every enum-like column in the
 * database.  Each enum is declared once here and imported by the schema table
 * files.  TypeScript union types are derived directly from the enum values so
 * domain types never drift from the database definition.
 *
 * Naming convention: <context>_<field>_enum  → pgEnum('<context>_<field>', [...])
 */
import { pgEnum } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

// ── identity ───────────────────────────────────────────────────────────────

export const userStatusEnum = pgEnum('user_status', ['invited', 'active', 'inactive', 'suspended']);

/** External SSO/IdP providers supported for federated login. */
export const ssoProviderEnum = pgEnum('sso_provider', ['entra', 'saml', 'google', 'okta']);

/** Lifecycle state of an SSO connection. */
export const ssoConnectionStatusEnum = pgEnum('sso_connection_status', ['active', 'disabled']);

/**
 * Multi-IdP broker routing model. `directory` connections OWN their email
 * domains (domain-routed, JIT-by-domain); `shared` connections are consumer
 * IdPs we don't own (e.g. consumer Google) — never domain-routed, invite-gated.
 */
export const ssoConnectionKindEnum = pgEnum('sso_connection_kind', ['directory', 'shared']);

// ── workspace ──────────────────────────────────────────────────────────────

export const workspaceStatusEnum = pgEnum('workspace_status', ['active', 'archived']);

export const workspaceMemberStatusEnum = pgEnum('workspace_member_status', [
  'active',
  'suspended',
  'removed',
]);

export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'cancelled',
  'expired',
]);

export const teamStatusEnum = pgEnum('team_status', ['active', 'archived']);

export const teamMemberStatusEnum = pgEnum('team_member_status', ['active', 'removed']);

// ── access ─────────────────────────────────────────────────────────────────

export const scopeTypeEnum = pgEnum('scope_type', ['global', 'workspace', 'project']);

// ── work ───────────────────────────────────────────────────────────────────

export const projectStatusEnum = pgEnum('project_status', ['active', 'archived']);

export const projectMemberStatusEnum = pgEnum('project_member_status', ['active', 'removed']);

export const projectTeamStatusEnum = pgEnum('project_team_status', ['active', 'unlinked']);

export const workItemTypeEnum = pgEnum('work_item_type', [
  'initiative',
  'feature',
  'story',
  'task',
  'defect',
]);

// Defect priority (Rally vocabulary). Story items carry 'none' (UI shows —).
// Migration 0011 remaps legacy critical→urgent, medium→normal.
export const workItemPriorityEnum = pgEnum('work_item_priority', [
  'none',
  'low',
  'normal',
  'high',
  'urgent',
]);

// Rally-style ScheduleState: orthogonal business-maturity dimension, separate
// from the per-project workflow engine (status_id → workflow_statuses).
// Aligned to BA flow-state vocabulary (mini-rally): 6 states, no 'ready',
// terminal state spelled 'release'. Migration 0041 backfills 'ready'→'defined'
// and renames 'released'→'release'.
export const workItemScheduleStateEnum = pgEnum('work_item_schedule_state', [
  'idea',
  'defined',
  'in_progress',
  'completed',
  'accepted',
  'release',
]);

export const workflowStatusCategoryEnum = pgEnum('workflow_status_category', [
  'to_do',
  'in_progress',
  'done',
]);

// Rally Iteration State — a planning-maturity dimension on the timebox itself:
// Planning (being shaped) → Committed (team committed) → Accepted (completed).
export const iterationStateEnum = pgEnum('iteration_state', ['planning', 'committed', 'accepted']);

export const releaseStatusEnum = pgEnum('release_status', ['planning', 'active', 'accepted']);

export const attachmentStatusEnum = pgEnum('attachment_status', ['pending', 'completed']);

// ── storage ────────────────────────────────────────────────────────────────

/**
 * Lifecycle of a storage.files row. `pending` means presigned but not yet
 * confirmed — the object may or may not exist in the bucket. `completed` means
 * the upload was verified (size + checksum) against the bucket.
 */
export const fileStatusEnum = pgEnum('file_status', ['pending', 'completed']);

/**
 * Which bucket a file lives in. `private` objects are only ever reachable via a
 * short-lived presigned GET minted after an authorization check. `public`
 * objects live in the CDN-fronted bucket and are readable by anyone holding the
 * key — only ever for non-sensitive assets (avatars, workspace logos).
 */
export const fileVisibilityEnum = pgEnum('file_visibility', ['private', 'public']);

export const activityEntityTypeEnum = pgEnum('activity_entity_type', [
  'work_item',
  'task',
  'attachment',
]);

// ── messaging ──────────────────────────────────────────────────────────────

export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'published', 'failed']);

/** Status for rows in messaging.email_outbox. */
export const emailJobStatusEnum = pgEnum('email_job_status', ['pending', 'sent', 'failed']);

/** Status for rows in messaging.notification_outbox. */
export const notificationJobStatusEnum = pgEnum('notification_job_status', [
  'pending',
  'sent',
  'failed',
]);

// P3.4 — Defect severity (separate from priority). Aligned to BA taxonomy
// (mini-rally): tokens now equal labels (Critical / Major / Minor / Trivial /
// None). Migration 0040 renames high→major, medium→minor, low→trivial.
export const defectSeverityEnum = pgEnum('defect_severity', [
  'critical',
  'major',
  'minor',
  'trivial',
  'none',
]);

// P3.4 — Defect environment where the defect was found.
export const defectEnvironmentEnum = pgEnum('defect_environment', [
  'development',
  'staging',
  'production',
  'testing',
]);

// P3.4 — Defect root cause categories (Rally-aligned).
export const defectRootCauseEnum = pgEnum('defect_root_cause', [
  'requirements',
  'design',
  'code',
  'test',
  'integration',
  'other',
]);

// P3.4 — Defect resolution status (Rally-aligned).
export const defectResolutionEnum = pgEnum('defect_resolution', [
  'fixed',
  'wont_fix',
  'duplicate',
  'cannot_reproduce',
  'deferred',
  'by_design',
]);

// P3.4 — Defect State (separate from Flow State / Schedule State)
export const defectStateEnum = pgEnum('defect_state', [
  'submitted',
  'open',
  'fixed',
  'closed',
  'closed_declined',
]);

// Task schedule state (subset for task table)
export const taskStateEnum = pgEnum('task_state', ['defined', 'in_progress', 'completed']);

// F6 — Work-item relation types (BA linking set). Stored on the canonical
// (source → target) direction; the inverse label is derived in the app layer.
export const workItemRelationTypeEnum = pgEnum('work_item_relation_type', [
  'blocks',
  'duplicates',
  'relates_to',
  'depends_on',
]);

// P3.3 — Milestone states aligned with BA spec.
export const milestoneStatusEnum = pgEnum('milestone_status', [
  'planned',
  'at_risk',
  'met',
  'missed',
  'cancelled',
  'completed',
]);

// ── TypeScript types (derived — never drift from DB) ──────────────────────

export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type WorkspaceStatus = (typeof workspaceStatusEnum.enumValues)[number];
export type WorkspaceMemberStatus = (typeof workspaceMemberStatusEnum.enumValues)[number];
export type InvitationStatus = (typeof invitationStatusEnum.enumValues)[number];
export type TeamStatus = (typeof teamStatusEnum.enumValues)[number];
export type TeamMemberStatus = (typeof teamMemberStatusEnum.enumValues)[number];
export type ScopeType = (typeof scopeTypeEnum.enumValues)[number];
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type ProjectMemberStatus = (typeof projectMemberStatusEnum.enumValues)[number];
export type ProjectTeamStatus = (typeof projectTeamStatusEnum.enumValues)[number];
export type WorkItemType = (typeof workItemTypeEnum.enumValues)[number];
export type WorkItemPriority = (typeof workItemPriorityEnum.enumValues)[number];
export type WorkItemScheduleState = (typeof workItemScheduleStateEnum.enumValues)[number];
export type WorkflowStatusCategory = (typeof workflowStatusCategoryEnum.enumValues)[number];
export type IterationState = (typeof iterationStateEnum.enumValues)[number];
export type ReleaseStatus = (typeof releaseStatusEnum.enumValues)[number];
export type OutboxStatus = (typeof outboxStatusEnum.enumValues)[number];
export type EmailJobStatus = (typeof emailJobStatusEnum.enumValues)[number];
export type NotificationJobStatus = (typeof notificationJobStatusEnum.enumValues)[number];
export type MilestoneStatus = (typeof milestoneStatusEnum.enumValues)[number];
export type DefectSeverity = (typeof defectSeverityEnum.enumValues)[number];
export type DefectEnvironment = (typeof defectEnvironmentEnum.enumValues)[number];
export type DefectRootCause = (typeof defectRootCauseEnum.enumValues)[number];
export type DefectResolution = (typeof defectResolutionEnum.enumValues)[number];
export type DefectState = (typeof defectStateEnum.enumValues)[number];
export type TaskState = (typeof taskStateEnum.enumValues)[number];
export type WorkItemRelationType = (typeof workItemRelationTypeEnum.enumValues)[number];

// ── Semantic groupings (single source of truth for roll-up / progress logic) ──
// Used by reporting, releases, milestones, quality and iteration-status so the
// definition of "done" / "accepted" / "open" lives in exactly one place.
//
// THREE ORTHOGONAL "DONE" DIMENSIONS — do NOT conflate them (BA source of truth:
// product-docs/projects/mini-rally). Each metric MUST use the dimension its
// spec names, and callers MUST reuse the helpers below rather than inline a
// string literal:
//
//   D1 — work_items.schedule_state  (business readiness / acceptance)
//        idea → defined → in_progress → completed → accepted → release
//        • "Accepted" metric  = ACCEPTED_SCHEDULE_STATES  (accepted OR release)
//        • "Completed" roll-up = COMPLETED_SCHEDULE_STATES (completed/accepted/release)
//        Drives: iteration-status Accepted %/points, release & milestone
//        progress, portfolio acceptance, iteration accept-gate & auto-accept.
//        Ref: Phase 2/03 Iteration Status SRS — "Accepted means Schedule State
//        equals Accepted, unless backend has a final accepted status mapping"
//        (that mapping is ACCEPTED_SCHEDULE_STATES — release is post-acceptance).
//
//   D2 — workflow_statuses.category  (kanban board column: to_do/in_progress/done)
//        • "board + burndown 'done'" — Ref: 05_Architecture/DATABASE_SCHEMA.md
//          (workflow_statuses.category "drives board grouping + burndown done").
//        Drives: sprint burndown/velocity snapshots, board columns, Home
//        project-progress. Use WORKFLOW_DONE_CATEGORY / isWorkflowDoneCategory.
//        NOTE: D2 is intentionally NOT the same as D1 acceptance — a board-done
//        item may not yet be business-accepted, and vice-versa.
//
//   D3 — tasks.state  (execution sub-state: defined/in_progress/completed)
//        Task terminal is `completed`; a parent US/DE auto-completes only when
//        every child task is `completed`, and is NEVER auto-reverted from a more
//        mature D1 terminal (Ref: BA-alignment F3 + Phase 3 P3-TS-009).

/** Schedule states that count as completed for progress & velocity roll-ups. */
export const COMPLETED_SCHEDULE_STATES = [
  'completed',
  'accepted',
  'release',
] as const satisfies readonly WorkItemScheduleState[];

/** Schedule states that count as accepted (a work item the team has signed off). */
export const ACCEPTED_SCHEDULE_STATES = [
  'accepted',
  'release',
] as const satisfies readonly WorkItemScheduleState[];

/** Schedule states that are still open / in-flight (not yet completed). */
export const OPEN_SCHEDULE_STATES = [
  'idea',
  'defined',
  'in_progress',
] as const satisfies readonly WorkItemScheduleState[];

/**
 * Defect "open" states for the Quality dashboard — intentionally NARROWER than
 * OPEN_SCHEDULE_STATES: a defect in `idea` is not yet an actionable open defect,
 * so backlog `idea` is excluded (BA Quality rule). Kept here next to the other
 * groupings so the two "open" definitions can never silently drift apart.
 */
export const OPEN_DEFECT_SCHEDULE_STATES = [
  'defined',
  'in_progress',
] as const satisfies readonly WorkItemScheduleState[];

/** D2 workflow-board category that counts as "done" for board + burndown/velocity. */
export const WORKFLOW_DONE_CATEGORY = 'done' as const satisfies WorkflowStatusCategory;

/** Type guard: is this schedule state counted as completed for roll-ups? */
export const isCompletedScheduleState = (s: WorkItemScheduleState): boolean =>
  (COMPLETED_SCHEDULE_STATES as readonly WorkItemScheduleState[]).includes(s);

/** Type guard: is this schedule state counted as accepted? */
export const isAcceptedScheduleState = (s: WorkItemScheduleState): boolean =>
  (ACCEPTED_SCHEDULE_STATES as readonly WorkItemScheduleState[]).includes(s);

/** Type guard: is this schedule state an actionable open defect (excludes `idea`)? */
export const isOpenDefectScheduleState = (s: WorkItemScheduleState): boolean =>
  (OPEN_DEFECT_SCHEDULE_STATES as readonly WorkItemScheduleState[]).includes(s);

/** Type guard: does this workflow-status category count as board/burndown "done"? */
export const isWorkflowDoneCategory = (c: WorkflowStatusCategory): boolean =>
  c === WORKFLOW_DONE_CATEGORY;

// SQL fragment factories — inline the grouping into a raw `sql` IN (...) list so
// aggregate/FILTER queries share the exact same definition of "done"/"accepted".
// Factories (not shared instances) so each call yields a fresh, safely-bound chunk.
const toSqlList = (values: readonly string[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** `'completed', 'accepted', 'release'` bound for use inside `schedule_state IN (...)`. */
export const completedScheduleStatesSql = (): SQL => toSqlList(COMPLETED_SCHEDULE_STATES);

/** `'accepted', 'release'` bound for use inside `schedule_state IN (...)`. */
export const acceptedScheduleStatesSql = (): SQL => toSqlList(ACCEPTED_SCHEDULE_STATES);
