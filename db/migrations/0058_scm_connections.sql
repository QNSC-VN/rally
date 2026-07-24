-- 0058: SCM "Connections" — Pull Requests + Changesets linked to work items.
--
-- New `scm` schema. `repositories` (+ `repository_projects`) maps an SCM repo to
-- the project(s) whose work-item keys it may reference. `webhook_inbox` durably
-- stores raw provider events for async processing by the worker relay.
-- `connections` are Pull Requests, `changesets` are commits — both linked to a
-- work item by the formatted key found in PR/branch/commit text. Dedup is by
-- unique constraints (delivery id; (work_item_id, external_id); (work_item_id,
-- revision)) so at-least-once delivery never duplicates. Workspace isolation is
-- app-layer (RLS dropped in 0025).

CREATE SCHEMA IF NOT EXISTS "scm";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm"."repositories" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "provider"     varchar(20) NOT NULL,
  "full_name"    varchar(255) NOT NULL,
  "base_url"     varchar(512),
  "active"       boolean NOT NULL DEFAULT true,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_scm_repositories_workspace"
  ON "scm"."repositories" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_scm_repositories_workspace_full_name"
  ON "scm"."repositories" USING btree ("workspace_id", "provider", "full_name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm"."repository_projects" (
  "repository_id" uuid NOT NULL,
  "project_id"    uuid NOT NULL,
  CONSTRAINT "scm_repository_projects_pk" PRIMARY KEY ("repository_id", "project_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_scm_repository_projects_project"
  ON "scm"."repository_projects" USING btree ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm"."webhook_inbox" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider"     varchar(20) NOT NULL,
  "delivery_id"  varchar(255) NOT NULL,
  "event_type"   varchar(60) NOT NULL,
  "payload"      jsonb NOT NULL,
  "status"       varchar(20) NOT NULL DEFAULT 'pending',
  "attempts"     integer NOT NULL DEFAULT 0,
  "last_error"   text,
  "scheduled_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  "received_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_scm_inbox_delivery"
  ON "scm"."webhook_inbox" USING btree ("provider", "delivery_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_scm_inbox_pending"
  ON "scm"."webhook_inbox" USING btree ("status", "scheduled_at") WHERE status = 'pending';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm"."connections" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"      uuid NOT NULL,
  "work_item_id"      uuid NOT NULL,
  "provider"          varchar(20) NOT NULL,
  "type"              varchar(20) NOT NULL,
  "external_id"       varchar(255) NOT NULL,
  "name"              text NOT NULL,
  "url"               text NOT NULL,
  "state"             varchar(20),
  "author_name"       varchar(255),
  "source_created_at" timestamptz,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_scm_connections_work_item"
  ON "scm"."connections" USING btree ("work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_scm_connections_workspace"
  ON "scm"."connections" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_scm_connections_item_external"
  ON "scm"."connections" USING btree ("work_item_id", "external_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm"."changesets" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"         uuid NOT NULL,
  "work_item_id"         uuid NOT NULL,
  "provider"             varchar(20) NOT NULL,
  "revision"             varchar(64) NOT NULL,
  "name"                 varchar(128) NOT NULL,
  "message"              text,
  "uri"                  text,
  "author_name"          varchar(255),
  "author_email"         varchar(320),
  "committed_at"         timestamptz,
  "changes"              jsonb NOT NULL DEFAULT '[]',
  "repository_full_name" varchar(255),
  "created_at"           timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_scm_changesets_work_item"
  ON "scm"."changesets" USING btree ("work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_scm_changesets_workspace"
  ON "scm"."changesets" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_scm_changesets_item_revision"
  ON "scm"."changesets" USING btree ("work_item_id", "revision");
