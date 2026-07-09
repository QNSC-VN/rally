-- ============================================================================
-- Migration 0026: Drop tenancy — merge tenant into workspace
-- ============================================================================
-- Physically removes the `tenant` concept. `workspace` becomes the switchable
-- root. On all scoped tables the tenant_id column is renamed to workspace_id;
-- the tenant tables, the DEPLOYMENT_MODE single-tenant apparatus (app-side) and
-- the RLS layer (dropped in 0025) go away.
--
-- Greenfield: dev/develop DBs are reset. No data backfill. There are no foreign
-- keys on tenant_id in this schema, so renames/drops are straightforward.
--
-- Runs AFTER 0025 (RLS teardown) so no `tenant_isolation` policy references the
-- columns being renamed/dropped.
-- ============================================================================

-- ── new workspace_status enum ───────────────────────────────────────────────
CREATE TYPE "public"."workspace_status" AS ENUM('active', 'archived');

-- ── tenancy.workspaces — workspace becomes the root ─────────────────────────
-- Dropping tenant_id auto-drops ix_workspaces_tenant and uq_workspaces_tenant_slug.
ALTER TABLE "tenancy"."workspaces" DROP COLUMN IF EXISTS "tenant_id";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workspaces_slug" ON "tenancy"."workspaces" USING btree ("slug") WHERE deleted_at IS NULL;
ALTER TABLE "tenancy"."workspaces" ADD COLUMN IF NOT EXISTS "status" "public"."workspace_status" DEFAULT 'active' NOT NULL;
CREATE INDEX IF NOT EXISTS "ix_workspaces_status" ON "tenancy"."workspaces" USING btree ("status");

-- ── tenancy.workspace_members — sole membership boundary ────────────────────
ALTER TABLE "tenancy"."workspace_members" DROP COLUMN IF EXISTS "tenant_id";
ALTER TABLE "tenancy"."workspace_members" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp with time zone;

-- ── tenancy.workspace_invitations / workspace_settings ──────────────────────
ALTER TABLE "tenancy"."workspace_invitations" DROP COLUMN IF EXISTS "tenant_id";
ALTER TABLE "tenancy"."workspace_settings" DROP COLUMN IF EXISTS "tenant_id";

-- ── work.projects — already had workspace_id; drop the tenant_id column ──────
-- Dropping tenant_id auto-drops ix_projects_tenant and uq_projects_key.
ALTER TABLE "work"."projects" DROP COLUMN IF EXISTS "tenant_id";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_projects_workspace_key" ON "work"."projects" USING btree ("workspace_id","key") WHERE deleted_at IS NULL;

-- ── work.teams — already had workspace_id; drop the tenant_id column ─────────
-- Dropping tenant_id auto-drops ix_teams_tenant.
ALTER TABLE "work"."teams" DROP COLUMN IF EXISTS "tenant_id";

-- ── work.* — rename tenant_id → workspace_id + rename the plain tenant index ─
-- Composite indexes (ix_wi_board/backlog/list/assignee/blocked, ix_audit_actor,
-- ix_ian_recipient, uq_notif_pref_user_type, …) follow the renamed column
-- automatically and keep their names.
ALTER TABLE "work"."project_counters" RENAME COLUMN "tenant_id" TO "workspace_id";

ALTER TABLE "work"."work_items" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_wi_tenant" RENAME TO "ix_wi_workspace";

ALTER TABLE "work"."workflow_statuses" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_ws_tenant" RENAME TO "ix_ws_workspace";

ALTER TABLE "work"."workflow_transitions" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_wt_tenant" RENAME TO "ix_wt_workspace";

ALTER TABLE "work"."iterations" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_iterations_tenant" RENAME TO "ix_iterations_workspace";

ALTER TABLE "work"."iteration_daily_snapshots" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_ids_tenant" RENAME TO "ix_ids_workspace";

ALTER TABLE "work"."releases" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_releases_tenant" RENAME TO "ix_releases_workspace";

ALTER TABLE "work"."comments" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_comments_tenant" RENAME TO "ix_comments_workspace";

ALTER TABLE "work"."attachments" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_attach_tenant" RENAME TO "ix_attach_workspace";

ALTER TABLE "work"."labels" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_labels_tenant" RENAME TO "ix_labels_workspace";

ALTER TABLE "work"."team_members" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_tm_tenant" RENAME TO "ix_tm_workspace";

ALTER TABLE "work"."project_teams" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_pt_tenant" RENAME TO "ix_pt_workspace";

ALTER TABLE "work"."project_members" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_pm_tenant" RENAME TO "ix_pm_workspace";

ALTER TABLE "work"."activity_logs" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_activity_tenant" RENAME TO "ix_activity_workspace";

ALTER TABLE "work"."time_logs" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_tl_tenant" RENAME TO "ix_tl_workspace";

ALTER TABLE "work"."work_item_watchers" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "work"."ix_wiw_tenant" RENAME TO "ix_wiw_workspace";

-- ── access.* ────────────────────────────────────────────────────────────────
-- system_roles.workspace_id stays nullable (NULL = global system role).
ALTER TABLE "access"."system_roles" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "access"."ix_system_roles_tenant" RENAME TO "ix_system_roles_workspace";

ALTER TABLE "access"."user_role_assignments" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "access"."ix_ura_tenant" RENAME TO "ix_ura_workspace";

-- ── audit.audit_logs ────────────────────────────────────────────────────────
ALTER TABLE "audit"."audit_logs" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "audit"."ix_audit_tenant" RENAME TO "ix_audit_workspace";

-- ── notifications.* ─────────────────────────────────────────────────────────
ALTER TABLE "notifications"."in_app_notifications" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER TABLE "notifications"."notification_preferences" RENAME COLUMN "tenant_id" TO "workspace_id";

-- ── messaging.* ─────────────────────────────────────────────────────────────
ALTER TABLE "messaging"."outbox_events" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "messaging"."ix_outbox_tenant" RENAME TO "ix_outbox_workspace";

ALTER TABLE "messaging"."email_outbox" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER TABLE "messaging"."notification_outbox" RENAME COLUMN "tenant_id" TO "workspace_id";

-- ── identity.auth_sessions — active workspace for the session ───────────────
ALTER TABLE "identity"."auth_sessions" RENAME COLUMN "tenant_id" TO "workspace_id";
ALTER INDEX "identity"."ix_auth_sessions_tenant" RENAME TO "ix_auth_sessions_workspace";

-- ── identity SSO — install-global, drop tenant linkage ──────────────────────
ALTER TABLE "identity"."sso_identities" DROP COLUMN IF EXISTS "tenant_id";
-- Dropping tenant_id auto-drops ix_sso_connections_tenant.
ALTER TABLE "identity"."sso_connections" DROP COLUMN IF EXISTS "tenant_id";

-- ── drop tenant tables ──────────────────────────────────────────────────────
DROP TABLE IF EXISTS "tenancy"."tenant_members";
DROP TABLE IF EXISTS "tenancy"."tenant_domains";
DROP TABLE IF EXISTS "tenancy"."subscriptions";
DROP TABLE IF EXISTS "tenancy"."tenants";

-- ── drop orphaned enums ─────────────────────────────────────────────────────
DROP TYPE IF EXISTS "public"."tenant_status";
DROP TYPE IF EXISTS "public"."subscription_plan";
DROP TYPE IF EXISTS "public"."subscription_status";
