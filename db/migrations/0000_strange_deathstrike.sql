CREATE SCHEMA "tenancy";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "access";
--> statement-breakpoint
CREATE SCHEMA "work";
--> statement-breakpoint
CREATE SCHEMA "messaging";
--> statement-breakpoint
CREATE SCHEMA "notifications";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TABLE "tenancy"."subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" varchar(50) DEFAULT 'free' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"seat_limit" integer,
	"current_period_end" timestamp with time zone,
	"external_subscription_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancy"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(63) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"plan" varchar(50) DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenancy"."workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancy"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(63) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"avatar_url" varchar(2048),
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"device_info" jsonb,
	"ip_address" varchar(45),
	"is_revoked" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"avatar_url" varchar(2048),
	"password_hash" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "access"."system_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access"."user_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" varchar(30) NOT NULL,
	"scope_id" uuid,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"filename" varchar(500) NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" varchar(1000) NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"parent_id" uuid,
	"is_edited" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."project_counters" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"last_item_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" varchar(10) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"lead_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'planned' NOT NULL,
	"target_date" date,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."sprint_daily_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"completed_points" integer DEFAULT 0 NOT NULL,
	"remaining_points" integer DEFAULT 0 NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"completed_items" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"goal" text,
	"status" varchar(20) DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"end_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"item_key" varchar(30) NOT NULL,
	"type" varchar(20) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status_id" uuid NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"assignee_id" uuid,
	"reporter_id" uuid,
	"parent_id" uuid,
	"iteration_id" uuid,
	"release_id" uuid,
	"story_points" integer,
	"acceptance_criteria" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"rank" varchar(255) DEFAULT '' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."workflow_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" varchar(20) NOT NULL,
	"color" varchar(20),
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."workflow_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"from_status_id" uuid,
	"to_status_id" uuid NOT NULL,
	"name" varchar(100),
	"required_role" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging"."outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"aggregate_type" varchar(100) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"partition_key" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications"."in_app_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" varchar(100) NOT NULL,
	"title" varchar(500) NOT NULL,
	"body" text,
	"resource_type" varchar(50),
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_email" varchar(255),
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" uuid NOT NULL,
	"project_id" uuid,
	"changes" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" varchar(45),
	"user_agent" varchar(500),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriptions_tenant" ON "tenancy"."subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenants_slug" ON "tenancy"."tenants" USING btree ("slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "ix_tenants_status" ON "tenancy"."tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_wm_tenant" ON "tenancy"."workspace_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspace_member" ON "tenancy"."workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "ix_wm_user" ON "tenancy"."workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_workspaces_tenant" ON "tenancy"."workspaces" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspaces_tenant_slug" ON "tenancy"."workspaces" USING btree ("tenant_id","slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "ix_auth_sessions_tenant" ON "identity"."auth_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_sessions_token_hash" ON "identity"."auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_auth_sessions_user" ON "identity"."auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_auth_sessions_family" ON "identity"."auth_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "ix_users_tenant" ON "identity"."users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email" ON "identity"."users" USING btree ("email") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_tenant_email" ON "identity"."users" USING btree ("tenant_id","email") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_system_roles_slug" ON "access"."system_roles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ix_system_roles_tenant" ON "access"."system_roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_ura_tenant" ON "access"."user_role_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_ura_user" ON "access"."user_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ura_user_role_scope" ON "access"."user_role_assignments" USING btree ("user_id","role_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "ix_attach_tenant" ON "work"."attachments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_attach_work_item" ON "work"."attachments" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "ix_comments_tenant" ON "work"."comments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_comments_work_item" ON "work"."comments" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "ix_comments_author" ON "work"."comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "ix_comments_parent" ON "work"."comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_projects_tenant" ON "work"."projects" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_projects_workspace" ON "work"."projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_projects_key" ON "work"."projects" USING btree ("tenant_id","key") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "ix_releases_tenant" ON "work"."releases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_releases_project" ON "work"."releases" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_sds_tenant" ON "work"."sprint_daily_snapshots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_sds_sprint" ON "work"."sprint_daily_snapshots" USING btree ("sprint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sds_sprint_date" ON "work"."sprint_daily_snapshots" USING btree ("sprint_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "ix_sprints_tenant" ON "work"."sprints" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_sprints_project" ON "work"."sprints" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_sprints_active" ON "work"."sprints" USING btree ("project_id","status") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "ix_wi_tenant" ON "work"."work_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_wi_project" ON "work"."work_items" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wi_item_key" ON "work"."work_items" USING btree ("project_id","item_key");--> statement-breakpoint
CREATE INDEX "ix_wi_board" ON "work"."work_items" USING btree ("tenant_id","project_id","status_id","rank");--> statement-breakpoint
CREATE INDEX "ix_wi_backlog" ON "work"."work_items" USING btree ("tenant_id","project_id","rank");--> statement-breakpoint
CREATE INDEX "ix_wi_assignee" ON "work"."work_items" USING btree ("tenant_id","assignee_id");--> statement-breakpoint
CREATE INDEX "ix_wi_parent" ON "work"."work_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_wi_iteration" ON "work"."work_items" USING btree ("iteration_id");--> statement-breakpoint
CREATE INDEX "ix_wi_release" ON "work"."work_items" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "ix_wi_blocked" ON "work"."work_items" USING btree ("tenant_id","is_blocked") WHERE is_blocked = true;--> statement-breakpoint
CREATE INDEX "ix_ws_tenant" ON "work"."workflow_statuses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_ws_project" ON "work"."workflow_statuses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_wt_tenant" ON "work"."workflow_transitions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_wt_project" ON "work"."workflow_transitions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_outbox_status" ON "messaging"."outbox_events" USING btree ("status","created_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "ix_outbox_tenant" ON "messaging"."outbox_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_outbox_event_id" ON "messaging"."outbox_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ix_ian_recipient" ON "notifications"."in_app_notifications" USING btree ("tenant_id","recipient_id","is_read");--> statement-breakpoint
CREATE INDEX "ix_ian_created" ON "notifications"."in_app_notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_ian_resource" ON "notifications"."in_app_notifications" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "ix_audit_tenant" ON "audit"."audit_logs" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_audit_actor" ON "audit"."audit_logs" USING btree ("tenant_id","actor_id");--> statement-breakpoint
CREATE INDEX "ix_audit_resource" ON "audit"."audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "ix_audit_project" ON "audit"."audit_logs" USING btree ("project_id","occurred_at");