-- ============================================================================
-- Migration 0088: the iteration side of Phase 6 Reports
-- ============================================================================
-- Three things Burndown and Velocity cannot be built without.
--
-- 1. timebox_group_id — the stable shared timebox key
--
--    An iteration is (project_id, team_id nullable). When a project runs per-team
--    iterations, "Sprint 25.1" exists once per team, and the All Teams view has to
--    fuse them into ONE bar. The approved mockup does not: its velocity x-axis shows
--    two adjacent bars both labelled 25.1, which is precisely the failure the SRS
--    forbids ("DEV must align Team-specific Iterations using a stable shared timebox
--    key. Do not aggregate by display name alone.").
--
--    A DERIVED key (start_date || end_date) was the cheaper option and is rejected on
--    purpose: shifting one team's end date by a day would silently split that bar in
--    two with nothing to see and nothing to fix. The group is therefore an explicit
--    identity, assigned when the iteration is created (by matching an existing group
--    for the same project and date range) and NEVER reassigned when dates later move.
--    Iterations keep their alignment across replanning, which is the whole point.
--
--    Nullable: an iteration with no dates belongs to no timebox and is excluded from
--    All Teams aggregation rather than collapsed into a shared "no dates" bucket.
--
-- 2/3. total_task_estimate_at_start (+ captured_at) — the Burndown Ideal baseline
--
--    Ideal is SUM(task.estimate) frozen ONCE at iteration start and is not allowed to
--    move when tasks are added, removed or re-estimated afterwards. That is only
--    expressible as a stored capture; recomputing it on read is the bug.

ALTER TABLE "work"."iterations"
  ADD COLUMN IF NOT EXISTS "timebox_group_id" uuid,
  ADD COLUMN IF NOT EXISTS "total_task_estimate_at_start" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "total_task_estimate_captured_at" timestamptz;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_iterations_timebox_group"
  ON "work"."iterations" ("project_id", "timebox_group_id");--> statement-breakpoint

-- Backfill: one group per (project, start_date, end_date). Dateless iterations stay
-- NULL — see above.
--
-- The id is DERIVED from the window rather than random, and the repository mints it with
-- the identical expression on create. Two consequences, both wanted:
--   • no read-then-write, so two concurrent creates for the same window cannot mint two
--     groups and silently split an All Teams bar;
--   • an iteration created after this backfill lands in the SAME group as the rows
--     backfilled here, which a random id could not guarantee.
-- Derivation happens ONCE, at create; a later date edit does not recompute it, which is
-- what keeps the alignment stable across replanning.
UPDATE "work"."iterations"
   SET timebox_group_id =
         md5(project_id::text || ':' || start_date::text || ':' || end_date::text)::uuid
 WHERE start_date IS NOT NULL
   AND end_date IS NOT NULL
   AND timebox_group_id IS NULL;--> statement-breakpoint

-- ── iteration_daily_snapshots: the frozen daily history Burndown reads ──────
--
-- The table already existed for the legacy points-based burndown. Phase 6 measures
-- something different on each axis: REMAINING TO DO in task hours (left) and
-- cumulative ACCEPTED POINTS (right). The legacy total/completed/remaining point
-- columns are removed in the Phase 6 cleanup migration once the old endpoints go;
-- they are left in place here so this migration applies to a live database without
-- breaking the endpoints still serving them.
--
-- `finalized` is what makes history frozen: once the workspace-local day has closed,
-- the daily job stops rewriting that date, so a later task edit cannot rewrite the
-- past. `captured_at` records when the row was last written, for the audited
-- correction process the SRS puts on DEV/operations.
ALTER TABLE "work"."iteration_daily_snapshots"
  ADD COLUMN IF NOT EXISTS "remaining_todo" numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "accepted_points" numeric(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "captured_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "finalized" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- The daily job asks "which dates do I already have for this iteration, and are they
-- closed?" on every tick.
CREATE INDEX IF NOT EXISTS "ix_ids_iteration_date_final"
  ON "work"."iteration_daily_snapshots" ("iteration_id", "snapshot_date", "finalized");
