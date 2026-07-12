/**
 * Centralised Drizzle pgEnum definitions for every enum-like column in the
 * database.  Each enum is declared once here and imported by the schema table
 * files.  TypeScript union types are derived directly from the enum values so
 * domain types never drift from the database definition.
 *
 * Naming convention: <context>_<field>_enum  → pgEnum('<context>_<field>', [...])
 */
import { pgEnum } from 'drizzle-orm/pg-core';

// ── identity ───────────────────────────────────────────────────────────────

export const userStatusEnum = pgEnum('user_status', ['invited', 'active', 'inactive', 'suspended']);

/** External SSO/IdP providers supported for federated login. */
export const ssoProviderEnum = pgEnum('sso_provider', ['entra', 'saml', 'google', 'okta']);

/** Lifecycle state of an SSO connection. */
export const ssoConnectionStatusEnum = pgEnum('sso_connection_status', ['active', 'disabled']);

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
export const workItemScheduleStateEnum = pgEnum('work_item_schedule_state', [
  'idea',
  'defined',
  'ready',
  'in_progress',
  'completed',
  'accepted',
  'released',
]);

export const workflowStatusCategoryEnum = pgEnum('workflow_status_category', [
  'to_do',
  'in_progress',
  'done',
]);

// Rally Iteration State — a planning-maturity dimension on the timebox itself:
// Planning (being shaped) → Committed (team committed) → Accepted (completed).
export const iterationStateEnum = pgEnum('iteration_state', [
  'planning',
  'committed',
  'accepted',
]);

export const releaseStatusEnum = pgEnum('release_status', ['planning', 'active', 'accepted']);

export const attachmentStatusEnum = pgEnum('attachment_status', ['pending', 'completed']);

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

// P3.4 — Defect severity (separate from priority).
// P3.4 — 'none' added for P3.4 compliance (app layer maps labels: critical→Critical, high→Major Problem, medium→Minor Problem, low→Trivial, none→None).
export const defectSeverityEnum = pgEnum('defect_severity', [
  'critical',
  'high',
  'medium',
  'low',
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
export const taskStateEnum = pgEnum('task_state', [
  'defined',
  'in_progress',
  'completed',
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
