-- The release Burnup Ideal target gains the TEAM grain its snapshot rows already have, and the
-- superseded per-iteration baseline columns are dropped.
--
-- ── the target ──────────────────────────────────────────────────────────────
-- Migration 0089 gave `release_daily_snapshots` a `team_id`, and 0098 did the same for the Burndown
-- baseline. The release Ideal target was the last quantity left at the wrong grain: two columns on
-- `releases`, captured only under the All Teams scope (`report-snapshot.service.ts` gated the write on
-- `teamId === null`), while `getReleaseBurnupRows` correctly narrows the MEASURED series to the team's
-- own rows.
--
-- So every Team's burnup drew its own Accepted line against the WHOLE release's target: each team
-- looked permanently behind, and one dashed line was claimed as N different teams' plans. RT §7's
-- acceptance example 7 requires that selecting a Team "recomputes the three bucket totals, list rows,
-- status values, issues and Burnup from T1 scope only" — the Ideal sits inside that Burnup definition.
--
-- `team_id IS NULL` here is the MEASURED All Teams row, exactly as in `release_daily_snapshots`, and is
-- never summed. RT §4.1 measures All Teams rather than summing because a Feature whose children span two
-- teams lands in BOTH teams' derived buckets, so a sum would count it twice — and the Ideal must be
-- measured over the same population as the Accepted series it is compared against. This is the opposite
-- of `iteration_team_baselines` (0098), where §4 defines All Teams as the SUM of the team baselines.
--
-- Points and count live on one row because `Chart Unit` is a display switch over a single population —
-- the same reason `release_daily_snapshots` pairs them.
CREATE TABLE IF NOT EXISTS "work"."release_team_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "release_id" uuid NOT NULL REFERENCES "work"."releases"("id") ON DELETE CASCADE,
  "team_id" uuid REFERENCES "work"."teams"("id") ON DELETE CASCADE,
  "ideal_target_points" numeric(8, 2) NOT NULL,
  "ideal_target_count" integer NOT NULL,
  "captured_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- COALESCE, because a plain unique index does not constrain NULLs and the no-team row would duplicate
-- on every capture. Same shape as `uq_itb_iteration_team` (0098) and `uq_rds_release_team_date` (0089).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_rtt_release_team"
  ON "work"."release_team_targets" (
    "release_id",
    COALESCE("team_id", '00000000-0000-0000-0000-000000000000'::uuid)
  );--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_rtt_workspace_release"
  ON "work"."release_team_targets" ("workspace_id", "release_id");--> statement-breakpoint

-- Carry the existing targets over as the All Teams row, which is precisely what each of them was: a
-- value captured under the `teamId === null` scope, measured over the whole release. So All Teams keeps
-- exactly the number it had, and a team-scoped burnup honestly finds no target of its own and renders
-- the "no approved release target" note rather than a line that was never measured for that team.
-- Splitting one release-wide number across teams after the fact is the fabrication RT-BR-09 forbids.
INSERT INTO "work"."release_team_targets"
  ("workspace_id", "release_id", "team_id", "ideal_target_points", "ideal_target_count", "captured_at")
SELECT r."workspace_id", r."id", NULL, r."ideal_target_points", r."ideal_target_count", now()
  FROM "work"."releases" r
 WHERE r."ideal_target_points" IS NOT NULL
   AND r."ideal_target_count" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- One source of truth, so drop the superseded columns rather than leaving a second one that nothing
-- writes. Precedent: 0091_phase6_drop_legacy_snapshot_columns.
ALTER TABLE "work"."releases"
  DROP COLUMN IF EXISTS "ideal_target_points",
  DROP COLUMN IF EXISTS "ideal_target_count";--> statement-breakpoint

-- ── the iteration baseline columns 0098 superseded ──────────────────────────
-- 0098 moved the Burndown baseline into `iteration_team_baselines` and copied every value across, but
-- left these behind; nothing has written them since. A stale column that still looks authoritative is
-- what let the project-grain baseline survive review in the first place.
ALTER TABLE "work"."iterations"
  DROP COLUMN IF EXISTS "total_task_estimate_at_start",
  DROP COLUMN IF EXISTS "total_task_estimate_captured_at";
