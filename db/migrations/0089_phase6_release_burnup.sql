-- ============================================================================
-- Migration 0089: Release Tracking burnup history + the persisted Ideal baseline
-- ============================================================================
-- `release_daily_snapshots` was added in 0033 and has never been written: an audit of
-- this branch found `ReleasesService.upsertReleaseSnapshot` has NO caller anywhere in
-- libs/, apps/ or test/ — the daily cron only snapshots iterations. So the table is
-- empty in every environment and `GET /v1/releases/:id/burndown` has always returned
-- `[]`. Its shape can therefore be corrected rather than migrated around.
--
-- Three defects in the old shape, all of which Release Tracking would inherit:
--
--   1. It counted `Completed` as done (`completedScheduleStatesSql()`), while
--      RT-AC-08 states Accepted includes ONLY {Accepted, Release} and explicitly
--      excludes Completed.
--   2. It had no Team dimension, so the Team-scoped burnup the SRS requires
--      (`Planned(R, S)` / `Accepted(R, S)`) could not be served at all.
--   3. It had no Preliminary Estimate series and no Ideal baseline, which are two of
--      the four lines on the approved chart.
--
-- Grain: one row per (release, team scope, workspace-local date). `team_id IS NULL`
-- is the All Teams aggregate row — stored rather than summed on read because
-- de-duplicating work items across teams is not something a SUM of team rows can do
-- (a story owned by one team is counted once; the SRS demands DISTINCT work item IDs).
--
-- Points AND count live on the same row: `Chart Unit` is a display switch over the
-- same measured population, not a second measurement, so two rows per day would let
-- them disagree.

ALTER TABLE "work"."release_daily_snapshots"
  ADD COLUMN IF NOT EXISTS "workspace_id" uuid,
  ADD COLUMN IF NOT EXISTS "team_id" uuid,
  ADD COLUMN IF NOT EXISTS "accepted_points" numeric(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "accepted_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "planned_points" numeric(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "planned_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "preliminary_points" numeric(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "preliminary_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "captured_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "finalized" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- Nullable → backfilled → NOT NULL, so the statement is safe on a database that does
-- hold rows even though this branch's code cannot have written any.
UPDATE "work"."release_daily_snapshots" s
   SET workspace_id = r.workspace_id
  FROM "work"."releases" r
 WHERE r.id = s.release_id
   AND s.workspace_id IS NULL;--> statement-breakpoint

DELETE FROM "work"."release_daily_snapshots" WHERE workspace_id IS NULL;--> statement-breakpoint

ALTER TABLE "work"."release_daily_snapshots"
  ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "work"."release_daily_snapshots"
  ADD CONSTRAINT "fk_rds_release" FOREIGN KEY ("release_id")
  REFERENCES "work"."releases" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- The old key had no team dimension. COALESCE into the nil UUID rather than a
-- partial-index pair, so ON CONFLICT can target one predicate and the daily job stays
-- a single idempotent upsert for both the team rows and the All Teams row.
DROP INDEX IF EXISTS "work"."uq_rds_release_date";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_rds_release_team_date"
  ON "work"."release_daily_snapshots" (
    "release_id",
    COALESCE("team_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "snapshot_date"
  );--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_rds_workspace" ON "work"."release_daily_snapshots" ("workspace_id");--> statement-breakpoint

-- ── the Ideal line's persisted baseline (RT-BR-09) ──────────────────────────
--
-- "The approved Release target for Ideal must come from a persisted planning
-- baseline. DEV must not silently use today's mutable Planned value to reconstruct an
-- old ideal line." Two columns because Ideal is drawn in whichever unit Chart Unit
-- selects. NULL means no baseline was approved, which the report must render as an
-- explicit unavailable state rather than as a zero trajectory.
ALTER TABLE "work"."releases"
  ADD COLUMN IF NOT EXISTS "ideal_target_points" numeric(8, 2),
  ADD COLUMN IF NOT EXISTS "ideal_target_count" integer;
