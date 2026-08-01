-- ============================================================================
-- Migration 0091: retire the pre-Phase-6 snapshot columns
-- ============================================================================
-- Both daily-snapshot tables carried a points/items read model written for the legacy
-- burndown and velocity endpoints. Those endpoints are gone, and nothing reads these
-- columns any more:
--
--   • `iteration_daily_snapshots.total/completed/remaining_points` + `*_items` measured
--     "done" as `workflow_statuses.category = 'done'`, which is the D2 board dimension.
--     Phase 6's Burndown plots Task To Do in HOURS and Accepted POINTS by acceptance
--     date — a different measure on each axis, now in `remaining_todo` /
--     `accepted_points`.
--   • `release_daily_snapshots.total/completed/remaining_points` + `*_items` counted
--     `Completed` as done, which RT-AC-08 excludes, and had no Team dimension. The
--     release-detail Burndown panel now reads the Phase 6 `planned_*` / `accepted_*`
--     columns of the All Teams row instead.
--
-- Dropped rather than left in place: a read model nobody writes is a trap. The next
-- person to open these tables would find two plausible "points" columns and no way to
-- tell which the product means, and a stale column that silently reads 0 is exactly the
-- "zero mistaken for measured performance" the Phase 6 contract is written against.
--
-- No data is lost that could be recovered anyway. The release columns were never written
-- by any code path in this repository. The iteration columns were, but they are a derived
-- read model: their inputs are still in `work_items`, and the Phase 6 series they would
-- feed measures something else entirely.

ALTER TABLE "work"."iteration_daily_snapshots"
  DROP COLUMN IF EXISTS "total_points",
  DROP COLUMN IF EXISTS "completed_points",
  DROP COLUMN IF EXISTS "remaining_points",
  DROP COLUMN IF EXISTS "total_items",
  DROP COLUMN IF EXISTS "completed_items";--> statement-breakpoint

ALTER TABLE "work"."release_daily_snapshots"
  DROP COLUMN IF EXISTS "total_points",
  DROP COLUMN IF EXISTS "completed_points",
  DROP COLUMN IF EXISTS "remaining_points",
  DROP COLUMN IF EXISTS "total_items",
  DROP COLUMN IF EXISTS "completed_items";
