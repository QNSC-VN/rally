-- 0056: Iteration (Timebox) Revision History.
--
-- Product-facing revision feed for the Iteration detail "Revision History" tab,
-- the iteration-scoped sibling of work.activity_logs. Anchored on iteration_id
-- (the subject is always the iteration itself — no entity_type/entity_id split).
-- Append-only; scalar diffs only, never rich-text bodies. Workspace isolation is
-- enforced at the application layer (RLS was dropped in migration 0025).

CREATE TABLE IF NOT EXISTS "work"."iteration_activity_logs" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "project_id"   uuid NOT NULL,
  "iteration_id" uuid NOT NULL,
  "actor_id"     uuid,
  "action"       varchar(60) NOT NULL,
  "changes"      jsonb,
  "metadata"     jsonb NOT NULL DEFAULT '{}',
  "created_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_iteration_activity_workspace"
  ON "work"."iteration_activity_logs" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_iteration_activity_iteration"
  ON "work"."iteration_activity_logs" USING btree ("iteration_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_iteration_activity_project"
  ON "work"."iteration_activity_logs" USING btree ("project_id");
