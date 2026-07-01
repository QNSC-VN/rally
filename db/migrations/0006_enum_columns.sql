CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."project_member_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_team_status" AS ENUM('active', 'unlinked');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('planned', 'released', 'archived');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('global', 'workspace', 'project');--> statement-breakpoint
CREATE TYPE "public"."sprint_status" AS ENUM('planned', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'starter', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'trialing', 'past_due', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."team_member_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."team_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'inactive', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."work_item_priority" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."work_item_type" AS ENUM('initiative', 'feature', 'story', 'task', 'defect');--> statement-breakpoint
CREATE TYPE "public"."workflow_status_category" AS ENUM('to_do', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."workspace_member_status" AS ENUM('active', 'suspended', 'removed');--> statement-breakpoint
DROP INDEX IF EXISTS "work"."ix_sprints_active";--> statement-breakpoint
DROP INDEX IF EXISTS "messaging"."ix_outbox_status";--> statement-breakpoint
ALTER TABLE "tenancy"."subscriptions" ALTER COLUMN "plan" SET DEFAULT 'free'::"public"."subscription_plan";--> statement-breakpoint
ALTER TABLE "tenancy"."subscriptions" ALTER COLUMN "plan" SET DATA TYPE "public"."subscription_plan" USING "plan"::"public"."subscription_plan";--> statement-breakpoint
ALTER TABLE "tenancy"."subscriptions" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."subscription_status";--> statement-breakpoint
ALTER TABLE "tenancy"."subscriptions" ALTER COLUMN "status" SET DATA TYPE "public"."subscription_status" USING "status"::"public"."subscription_status";--> statement-breakpoint
ALTER TABLE "tenancy"."tenants" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."tenant_status";--> statement-breakpoint
ALTER TABLE "tenancy"."tenants" ALTER COLUMN "status" SET DATA TYPE "public"."tenant_status" USING "status"::"public"."tenant_status";--> statement-breakpoint
ALTER TABLE "tenancy"."tenants" ALTER COLUMN "plan" SET DEFAULT 'free'::"public"."subscription_plan";--> statement-breakpoint
ALTER TABLE "tenancy"."tenants" ALTER COLUMN "plan" SET DATA TYPE "public"."subscription_plan" USING "plan"::"public"."subscription_plan";--> statement-breakpoint
ALTER TABLE "tenancy"."workspace_invitations" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."invitation_status";--> statement-breakpoint
ALTER TABLE "tenancy"."workspace_invitations" ALTER COLUMN "status" SET DATA TYPE "public"."invitation_status" USING "status"::"public"."invitation_status";--> statement-breakpoint
ALTER TABLE "tenancy"."workspace_members" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."workspace_member_status";--> statement-breakpoint
ALTER TABLE "tenancy"."workspace_members" ALTER COLUMN "status" SET DATA TYPE "public"."workspace_member_status" USING "status"::"public"."workspace_member_status";--> statement-breakpoint
ALTER TABLE "identity"."users" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."user_status";--> statement-breakpoint
ALTER TABLE "identity"."users" ALTER COLUMN "status" SET DATA TYPE "public"."user_status" USING "status"::"public"."user_status";--> statement-breakpoint
ALTER TABLE "access"."user_role_assignments" ALTER COLUMN "scope_type" SET DATA TYPE "public"."scope_type" USING "scope_type"::"public"."scope_type";--> statement-breakpoint
ALTER TABLE "work"."project_members" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."project_member_status";--> statement-breakpoint
ALTER TABLE "work"."project_members" ALTER COLUMN "status" SET DATA TYPE "public"."project_member_status" USING "status"::"public"."project_member_status";--> statement-breakpoint
ALTER TABLE "work"."project_teams" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."project_team_status";--> statement-breakpoint
ALTER TABLE "work"."project_teams" ALTER COLUMN "status" SET DATA TYPE "public"."project_team_status" USING "status"::"public"."project_team_status";--> statement-breakpoint
ALTER TABLE "work"."projects" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."project_status";--> statement-breakpoint
ALTER TABLE "work"."projects" ALTER COLUMN "status" SET DATA TYPE "public"."project_status" USING "status"::"public"."project_status";--> statement-breakpoint
ALTER TABLE "work"."releases" ALTER COLUMN "status" SET DEFAULT 'planned'::"public"."release_status";--> statement-breakpoint
ALTER TABLE "work"."releases" ALTER COLUMN "status" SET DATA TYPE "public"."release_status" USING "status"::"public"."release_status";--> statement-breakpoint
ALTER TABLE "work"."sprints" ALTER COLUMN "status" SET DEFAULT 'planned'::"public"."sprint_status";--> statement-breakpoint
ALTER TABLE "work"."sprints" ALTER COLUMN "status" SET DATA TYPE "public"."sprint_status" USING "status"::"public"."sprint_status";--> statement-breakpoint
ALTER TABLE "work"."team_members" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."team_member_status";--> statement-breakpoint
ALTER TABLE "work"."team_members" ALTER COLUMN "status" SET DATA TYPE "public"."team_member_status" USING "status"::"public"."team_member_status";--> statement-breakpoint
ALTER TABLE "work"."teams" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."team_status";--> statement-breakpoint
ALTER TABLE "work"."teams" ALTER COLUMN "status" SET DATA TYPE "public"."team_status" USING "status"::"public"."team_status";--> statement-breakpoint
ALTER TABLE "work"."work_items" ALTER COLUMN "type" SET DATA TYPE "public"."work_item_type" USING "type"::"public"."work_item_type";--> statement-breakpoint
ALTER TABLE "work"."work_items" ALTER COLUMN "priority" SET DEFAULT 'medium'::"public"."work_item_priority";--> statement-breakpoint
ALTER TABLE "work"."work_items" ALTER COLUMN "priority" SET DATA TYPE "public"."work_item_priority" USING "priority"::"public"."work_item_priority";--> statement-breakpoint
ALTER TABLE "work"."workflow_statuses" ALTER COLUMN "category" SET DATA TYPE "public"."workflow_status_category" USING "category"::"public"."workflow_status_category";--> statement-breakpoint
ALTER TABLE "messaging"."outbox_events" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."outbox_status";--> statement-breakpoint
ALTER TABLE "messaging"."outbox_events" ALTER COLUMN "status" SET DATA TYPE "public"."outbox_status" USING "status"::"public"."outbox_status";--> statement-breakpoint
CREATE INDEX "ix_sprints_active" ON "work"."sprints" USING btree ("project_id","status") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "ix_outbox_status" ON "messaging"."outbox_events" USING btree ("status","created_at") WHERE status = 'pending';
