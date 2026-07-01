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

/** Lifecycle state of a tenant's SSO connection. */
export const ssoConnectionStatusEnum = pgEnum('sso_connection_status', ['active', 'disabled']);

// ── tenancy ────────────────────────────────────────────────────────────────

export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'deleted']);

export const subscriptionPlanEnum = pgEnum('subscription_plan', [
  'free',
  'starter',
  'pro',
  'enterprise',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'trialing',
  'past_due',
  'canceled',
]);

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

export const sprintStatusEnum = pgEnum('sprint_status', ['planned', 'active', 'completed']);

export const releaseStatusEnum = pgEnum('release_status', ['planned', 'released', 'archived']);

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

// ── TypeScript types (derived — never drift from DB) ──────────────────────

export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type TenantStatus = (typeof tenantStatusEnum.enumValues)[number];
export type SubscriptionPlan = (typeof subscriptionPlanEnum.enumValues)[number];
export type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number];
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
export type SprintStatus = (typeof sprintStatusEnum.enumValues)[number];
export type ReleaseStatus = (typeof releaseStatusEnum.enumValues)[number];
export type OutboxStatus = (typeof outboxStatusEnum.enumValues)[number];
export type EmailJobStatus = (typeof emailJobStatusEnum.enumValues)[number];
export type NotificationJobStatus = (typeof notificationJobStatusEnum.enumValues)[number];
