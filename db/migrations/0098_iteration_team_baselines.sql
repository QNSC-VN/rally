-- The Burndown Ideal baseline gains the TEAM grain its snapshot rows already have.
--
-- ── the rule ────────────────────────────────────────────────────────────────
-- IB §4: "Capture one immutable baseline when the Iteration starts … `SUM(task.estimate at Iteration
-- start)`", and §4 closes with the part that was missing here:
--
--     "For `All Teams`, the baseline is the SUM of the participating Team baselines for the shared
--      timebox."
--
-- So the baseline is per TEAM, and All Teams is a SUM — deliberately unlike the snapshot rows, where
-- `team_id IS NULL` is a MEASURED All Teams row that is never summed. Two different rules for two
-- different quantities, both stated by the BA.
--
-- ── what was wrong ──────────────────────────────────────────────────────────
-- Migration 0093 gave `iteration_daily_snapshots` a `team_id` so a team-scoped Burndown could be
-- served, but the baseline stayed on `iterations.total_task_estimate_at_start` — ONE column per
-- iteration, no team dimension, and `sumTaskEstimate` had no team predicate. A team-scoped chart
-- therefore plotted that team's measured bars against the WHOLE PROJECT's Ideal line.
--
-- The consequences were not cosmetic. IB §6 compares `remainingToDo(d)` with `ideal(d)`, so with a
-- project baseline the indicator read "On track" for a team that had burned nothing, and could not
-- read "Behind plan" until a team exceeded every other team's estimate as well as its own. The
-- `sr-only` data table stated the same wrong number as fact.
--
-- ── why a table and not a column ────────────────────────────────────────────
-- One row per (iteration, team scope). `team_id IS NULL` here means "work whose team cannot be
-- resolved" — NOT All Teams — so summing the rows loses nothing, which is exactly what §4's All Teams
-- rule needs. A nullable `team_id` in a unique index does not constrain NULLs, so the index COALESCEs
-- into the nil UUID, the same shape `uq_ids_iteration_team_date` (0093) and `uq_rds_release_team_date`
-- (0089) already use.
CREATE TABLE IF NOT EXISTS "work"."iteration_team_baselines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "iteration_id" uuid NOT NULL REFERENCES "work"."iterations"("id") ON DELETE CASCADE,
  -- NULL = tasks whose team resolves to nothing. Summed into All Teams like any other row.
  "team_id" uuid REFERENCES "work"."teams"("id") ON DELETE CASCADE,
  "total_task_estimate_at_start" numeric(10, 2) NOT NULL,
  "captured_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_itb_iteration_team"
  ON "work"."iteration_team_baselines" (
    "iteration_id",
    COALESCE("team_id", '00000000-0000-0000-0000-000000000000'::uuid)
  );--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_itb_workspace_iteration"
  ON "work"."iteration_team_baselines" ("workspace_id", "iteration_id");--> statement-breakpoint

-- ── carrying the existing baselines over ────────────────────────────────────
-- Each existing value measured the whole iteration with every team's work lumped together. It cannot
-- be split per team after the fact, and inventing a split would be exactly the fabrication the
-- reporting rules forbid — so it lands as ONE `team_id IS NULL` row.
--
-- The consequences are deliberate and honest: All Teams keeps precisely the number it had (the sum of
-- one row), and a team-scoped chart for a pre-existing iteration finds no baseline of its own and says
-- so via the "no start baseline was recorded" note, instead of drawing a line that was never measured
-- for that team. New iterations get real per-team baselines from the next capture onward.
INSERT INTO "work"."iteration_team_baselines"
  ("workspace_id", "iteration_id", "team_id", "total_task_estimate_at_start", "captured_at")
SELECT i."workspace_id",
       i."id",
       NULL,
       i."total_task_estimate_at_start",
       COALESCE(i."total_task_estimate_captured_at", now())
  FROM "work"."iterations" i
 WHERE i."total_task_estimate_at_start" IS NOT NULL
ON CONFLICT DO NOTHING;
