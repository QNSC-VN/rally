CREATE TABLE "tenancy"."workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"role_id" uuid,
	"token_hash" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancy"."workspace_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"default_locale" varchar(10) DEFAULT 'en' NOT NULL,
	"date_format" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."project_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"key" varchar(10) NOT NULL,
	"description" text,
	"lead_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenancy"."workspace_members" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "tenancy"."workspace_members" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenancy"."workspace_members" ADD COLUMN "joined_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tenancy"."workspace_members" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_wi_tenant" ON "tenancy"."workspace_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_wi_workspace" ON "tenancy"."workspace_invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wi_token_hash" ON "tenancy"."workspace_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_wi_email" ON "tenancy"."workspace_invitations" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspace_settings" ON "tenancy"."workspace_settings" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prt_token_hash" ON "identity"."password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_prt_user" ON "identity"."password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_pm_tenant" ON "work"."project_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_pm_project" ON "work"."project_members" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_pm_user" ON "work"."project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_member" ON "work"."project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "ix_pt_tenant" ON "work"."project_teams" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_pt_project" ON "work"."project_teams" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_team" ON "work"."project_teams" USING btree ("project_id","team_id");--> statement-breakpoint
CREATE INDEX "ix_tm_tenant" ON "work"."team_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_tm_team" ON "work"."team_members" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_team_member" ON "work"."team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "ix_teams_tenant" ON "work"."teams" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_teams_workspace" ON "work"."teams" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_teams_key" ON "work"."teams" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "ix_wm_status" ON "tenancy"."workspace_members" USING btree ("workspace_id","status");