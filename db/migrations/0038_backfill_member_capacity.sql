-- Backfill: create work.member_capacity when it is missing.
--
-- Root cause: 0028_member_capacity shared an identical journal timestamp
-- (`when`) with 0028_drop_password_auth. drizzle-orm's migrator resumes with a
-- strict `created_at < when` comparison, so any database that had already
-- applied 0028_drop_password_auth in an EARLIER deploy (develop did, via #38)
-- silently SKIPPED 0028_member_capacity when it landed later (#56) — the table
-- was never created even though the run reported "migrations applied".
--
-- The duplicate timestamps are corrected in meta/_journal.json so this can never
-- recur on a fresh database. This migration repairs already-migrated databases.
-- Fully idempotent — a no-op where 0028_member_capacity applied normally.

CREATE TABLE IF NOT EXISTS work.member_capacity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  project_id    UUID NOT NULL,
  team_id       UUID NOT NULL,
  iteration_id  UUID NOT NULL,
  user_id       UUID NOT NULL,
  capacity_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_capacity
  ON work.member_capacity (project_id, team_id, iteration_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_mc_workspace ON work.member_capacity (workspace_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_mc_iteration ON work.member_capacity (iteration_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_mc_user ON work.member_capacity (user_id);
