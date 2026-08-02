-- A TEAM dimension for the frozen Burndown history, plus the foreign keys the
-- Phase 6 snapshot tables never had.
--
-- ── why team_id ─────────────────────────────────────────────────────────────
-- IB §2 requires "a selected Team includes only that Team's work", and Burndown is
-- FROZEN history — it cannot be recomputed per team on read, because yesterday's
-- Remaining To Do only exists where something wrote it down. The grain was
-- (iteration, date) with no team, so a team-scoped Burndown could not be served at all
-- for the shared, team-less iterations that make up 195 of 206 rows in the local
-- database. This is the same shape `release_daily_snapshots` already uses (0089):
-- `team_id IS NULL` is the All Teams row and it is MEASURED, not summed from the team
-- rows, so a task two teams both touch is counted once.
--
-- ── why the COALESCE index ──────────────────────────────────────────────────
-- A plain unique index over a nullable column does not dedupe NULLs, so the All Teams
-- row would not be idempotent — two ticks would insert two rows. COALESCE into the nil
-- UUID gives ON CONFLICT one predicate to target and keeps the daily job a single
-- upsert for both kinds of row. Mirrors `uq_rds_release_team_date` exactly.
ALTER TABLE "work"."iteration_daily_snapshots"
  ADD COLUMN IF NOT EXISTS "team_id" uuid;--> statement-breakpoint

-- Existing rows were written with no team dimension, which is precisely the All Teams
-- reading: they measured every task in the iteration's scope. So they stay as they are
-- (team_id NULL) and become the All Teams series. Nothing is discarded, and no per-team
-- history is invented for days nobody measured per team — the reports report those as
-- gaps, which is what IB §5 demands.
DROP INDEX IF EXISTS "work"."uq_ids_iteration_date";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ids_iteration_team_date"
  ON "work"."iteration_daily_snapshots" (
    "iteration_id",
    COALESCE("team_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "snapshot_date"
  );--> statement-breakpoint

-- The job's own read: which dates do I have for this scope, and are they closed?
DROP INDEX IF EXISTS "work"."ix_ids_iteration_date_final";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_ids_iteration_team_date_final"
  ON "work"."iteration_daily_snapshots" ("iteration_id", "team_id", "snapshot_date", "finalized");
--> statement-breakpoint

-- ── the foreign keys these tables never had ─────────────────────────────────
--
-- Verified against pg_constraint: `iteration_daily_snapshots` and `member_capacity` had
-- ZERO foreign keys. `iterations.service.ts` blocks deleting an iteration unless it is
-- still `planning`, and only `committed` iterations are snapshotted, so orphan snapshots
-- were unreachable through the API today — but orphaned `member_capacity` rows were
-- reachable (delete a planning iteration that already has capacity planned), and
-- "unreachable today" is not an invariant, it is a coincidence of two unrelated rules.
--
-- CASCADE, not RESTRICT: history describes an iteration, so deleting the iteration must
-- take its history with it. RESTRICT would make a legal delete fail on rows the user
-- cannot see or address.
DELETE FROM "work"."iteration_daily_snapshots" s
 WHERE NOT EXISTS (SELECT 1 FROM "work"."iterations" i WHERE i.id = s.iteration_id);
--> statement-breakpoint

ALTER TABLE "work"."iteration_daily_snapshots"
  DROP CONSTRAINT IF EXISTS "fk_ids_iteration";--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots"
  ADD CONSTRAINT "fk_ids_iteration" FOREIGN KEY ("iteration_id")
  REFERENCES "work"."iterations" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- A team can be deleted while its snapshot rows exist; the ALL TEAMS row still carries
-- the measured total, so SET NULL would silently merge a deleted team's history into it.
-- CASCADE removes that team's series and leaves All Teams — which was measured
-- independently — untouched.
DELETE FROM "work"."iteration_daily_snapshots" s
 WHERE s.team_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "work"."teams" t WHERE t.id = s.team_id);--> statement-breakpoint

ALTER TABLE "work"."iteration_daily_snapshots"
  DROP CONSTRAINT IF EXISTS "fk_ids_team";--> statement-breakpoint
ALTER TABLE "work"."iteration_daily_snapshots"
  ADD CONSTRAINT "fk_ids_team" FOREIGN KEY ("team_id")
  REFERENCES "work"."teams" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- ── member_capacity ─────────────────────────────────────────────────────────
--
-- Team Capacity reads this table directly and inner-joins `teams` and `users`, so an
-- orphan row is silently DROPPED from the report: the Capacity total quietly falls while
-- Estimate/ToDo/Actual stay, which reads as a team that planned less rather than as
-- missing data. TC §4 wants a missing capacity record to read as an explicit 0h planning
-- gap, and that only holds if the rows that exist are real.
DELETE FROM "work"."member_capacity" c
 WHERE NOT EXISTS (SELECT 1 FROM "work"."iterations" i WHERE i.id = c.iteration_id)
    OR NOT EXISTS (SELECT 1 FROM "work"."teams" t WHERE t.id = c.team_id)
    OR NOT EXISTS (SELECT 1 FROM "identity"."users" u WHERE u.id = c.user_id)
    OR NOT EXISTS (SELECT 1 FROM "work"."projects" p WHERE p.id = c.project_id);
--> statement-breakpoint

ALTER TABLE "work"."member_capacity"
  DROP CONSTRAINT IF EXISTS "fk_member_capacity_iteration";--> statement-breakpoint
ALTER TABLE "work"."member_capacity"
  ADD CONSTRAINT "fk_member_capacity_iteration" FOREIGN KEY ("iteration_id")
  REFERENCES "work"."iterations" ("id") ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "work"."member_capacity"
  DROP CONSTRAINT IF EXISTS "fk_member_capacity_team";--> statement-breakpoint
ALTER TABLE "work"."member_capacity"
  ADD CONSTRAINT "fk_member_capacity_team" FOREIGN KEY ("team_id")
  REFERENCES "work"."teams" ("id") ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "work"."member_capacity"
  DROP CONSTRAINT IF EXISTS "fk_member_capacity_project";--> statement-breakpoint
ALTER TABLE "work"."member_capacity"
  ADD CONSTRAINT "fk_member_capacity_project" FOREIGN KEY ("project_id")
  REFERENCES "work"."projects" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- Users are soft-deleted (`deleted_at`), so RESTRICT here would only fire on a hard
-- delete — which is exactly when a capacity row must not be left pointing at nothing.
ALTER TABLE "work"."member_capacity"
  DROP CONSTRAINT IF EXISTS "fk_member_capacity_user";--> statement-breakpoint
ALTER TABLE "work"."member_capacity"
  ADD CONSTRAINT "fk_member_capacity_user" FOREIGN KEY ("user_id")
  REFERENCES "identity"."users" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- ── timebox_group_id: an invariant seeds can bypass belongs in the database ──
--
-- `timeboxGroupIdFor()` runs in ONE write path (create). `update` omits it, so adding or
-- changing dates later leaves it NULL forever, and `db/seeds/**` inserts iterations with
-- dates and no group at all. Measured on the local database: 40 iterations had both dates
-- and a NULL group, three of them sharing (project, start, end) with four that were
-- grouped. `findEligibleTimeboxes` coalesces a null group to the iteration id, so each of
-- those becomes its own Velocity bar — the "two adjacent bars both labelled 25.1" failure
-- that 0088 exists to prevent.
--
-- A trigger, because the rule is "any row with both dates has the derived group", and the
-- service is demonstrably not the only writer. Same md5 expression as
-- `timeboxGroupIdFor()` and migration 0088, which a spec pins.
CREATE OR REPLACE FUNCTION "work"."sync_timebox_group_id"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL THEN
    -- Computed ONCE per (project, start, end): a later date edit must not split a
    -- historical bar, so an existing group survives unless the dates it was derived
    -- from have changed.
    IF NEW.timebox_group_id IS NULL THEN
      NEW.timebox_group_id := md5(
        NEW.project_id::text || ':' || NEW.start_date::text || ':' || NEW.end_date::text
      )::uuid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_sync_timebox_group_id" ON "work"."iterations";--> statement-breakpoint

CREATE TRIGGER "trg_sync_timebox_group_id"
  BEFORE INSERT OR UPDATE OF "start_date", "end_date", "project_id"
  ON "work"."iterations"
  FOR EACH ROW
  EXECUTE FUNCTION "work"."sync_timebox_group_id"();--> statement-breakpoint

-- Backfill the rows that were already dated and ungrouped.
UPDATE "work"."iterations"
   SET timebox_group_id = md5(
         project_id::text || ':' || start_date::text || ':' || end_date::text
       )::uuid
 WHERE start_date IS NOT NULL
   AND end_date IS NOT NULL
   AND timebox_group_id IS NULL;
