-- An allocation's value becomes a FIXED SNAPSHOT again, with a label saying where it came from.
--
-- ── why this reverses 0077 ──────────────────────────────────────────────────
-- 0077 made `value` nullable so a blank Estimate could resolve to the Feature's own estimate on read,
-- and stated the objection it was solving: "a defaulted 8 and a deliberate 8 were indistinguishable,
-- so the column could never render blank."
--
-- The BA answers that objection with a LABEL rather than a null. §185: a blank Estimate "copies the
-- Feature's top-down estimate into a fixed allocation row and labels its source `Feature Estimate`".
-- §186: "A supplied Estimate becomes a fixed `Manual` allocation row." §11 states the value itself:
-- `fixed allocation.value set during planning/replanning`.
--
-- Fixed matters because a resolved value is not a commitment. With NULL rows, editing a Feature's
-- Refined Estimate silently moved every Draft plan that had assigned it — a planner's committed demand
-- changed underneath them with no action on the plan — and `Team Estimated = SUM(allocation.value)`
-- (§337) could not be computed from the stored rows at all, so every surface had to re-resolve and
-- agree by luck. `source` keeps 0077's distinction while restoring both properties.
--
-- ── the enum ────────────────────────────────────────────────────────────────
CREATE TYPE "public"."capacity_allocation_source" AS ENUM ('feature_estimate', 'manual');--> statement-breakpoint

-- Added NULLABLE first: existing rows are labelled below, and only then is the column closed. Adding
-- it NOT NULL with a default would label every legacy row `manual`, including the ones that never
-- carried a typed number.
ALTER TABLE "work"."capacity_plan_allocations"
  ADD COLUMN "source" "public"."capacity_allocation_source";--> statement-breakpoint

-- ── backfill: NULL value → today's resolved value, labelled `feature_estimate` ──
-- Frozen at TODAY'S resolved figure, so no plan total moves on deploy. The alternative — leaving them
-- to resolve forever — is the behaviour being removed.
--
-- The tier chain is the same one `resolveEstimate` applies, in the PLAN'S OWN UNIT: the refined
-- forecast when it is greater than zero, else the workspace's Preliminary size mapping. Zero is not a
-- forecast anywhere in this domain, which is why `> 0` and not `IS NOT NULL`.
--
-- `preliminary_estimate_map` is a JSONB override per workspace, merged over the seeded defaults
-- key-by-key — the same `{...DEFAULT, ...raw}` merge `PreliminaryEstimateMapService` does, expressed
-- here as a per-size COALESCE so a partially-customised map cannot fall back wholesale.
UPDATE "work"."capacity_plan_allocations" a
   SET "value" = sub.resolved,
       "source" = 'feature_estimate'
  FROM (
    SELECT a2."id",
           CASE
             WHEN p."unit" = 'points' THEN
               CASE WHEN pi."refined_estimate" > 0 THEN pi."refined_estimate"
                    ELSE COALESCE(
                      (ws."preliminary_estimate_map" -> pi."preliminary_estimate"::text ->> 'points')::numeric,
                      d."points"
                    )
               END
             ELSE
               CASE WHEN pi."refined_item_count_estimate" > 0 THEN pi."refined_item_count_estimate"::numeric
                    ELSE COALESCE(
                      (ws."preliminary_estimate_map" -> pi."preliminary_estimate"::text ->> 'count')::numeric,
                      d."count"
                    )
               END
           END AS resolved
      FROM "work"."capacity_plan_allocations" a2
      JOIN "work"."capacity_plans" p ON p."id" = a2."plan_id"
      JOIN "work"."portfolio_items" pi ON pi."id" = a2."portfolio_item_id"
      -- LEFT: a workspace with no settings row falls back to the seeded map, exactly as the service does.
      LEFT JOIN "workspace"."workspace_settings" ws ON ws."workspace_id" = p."workspace_id"
      LEFT JOIN (
        VALUES ('no_entry', 0, 0), ('xs', 1, 1), ('s', 3, 2), ('m', 5, 3), ('l', 8, 5), ('xl', 13, 8)
      ) AS d("size", "points", "count") ON d."size" = pi."preliminary_estimate"::text
     WHERE a2."value" IS NULL
  ) sub
 WHERE a."id" = sub."id";--> statement-breakpoint

-- Everything still unlabelled carried a number a planner put there.
UPDATE "work"."capacity_plan_allocations" SET "source" = 'manual' WHERE "source" IS NULL;--> statement-breakpoint

ALTER TABLE "work"."capacity_plan_allocations"
  ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint

-- A COALESCE guard for the one case the tier chain cannot produce a number for: a Feature deleted out
-- from under its allocation would leave `resolved` NULL and fail the NOT NULL below. Zero is the
-- honest snapshot of "no estimate to copy" and matches the tier chain's own `otherwise 0`.
UPDATE "work"."capacity_plan_allocations" SET "value" = 0 WHERE "value" IS NULL;--> statement-breakpoint

ALTER TABLE "work"."capacity_plan_allocations"
  ALTER COLUMN "value" SET NOT NULL;--> statement-breakpoint

-- The stale DEFAULT 0 that 0071 set and 0077 left behind when it dropped NOT NULL. Every writer now
-- states a value AND a source, so a defaulted row is a bug rather than a convenience — and a silent 0
-- is the exact ambiguity `source` exists to remove.
ALTER TABLE "work"."capacity_plan_allocations"
  ALTER COLUMN "value" DROP DEFAULT;
