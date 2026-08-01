-- Capacity planning gets the foreign keys it never had, and a plan key it cannot be missing.
--
-- An audit of the live database found `capacity_plans` declaring only unique and check constraints:
-- `project_id`, `release_id` and `workspace_id` were bare NOT NULL uuids, and `team_id` on both
-- `capacity_plan_teams` and `capacity_plan_allocations` referenced nothing at all. The consequence was
-- reachable through the normal UI: deleting a non-accepted release left every plan on it pointing at a
-- row that no longer existed, its Release badge blank (the read leftJoins) and its publish silently
-- unable to write the Release field ever again, because the release window resolves to null and
-- `release_id` is deliberately immutable. Nothing repaired that state.
--
-- ON DELETE RESTRICT, not CASCADE, on every one of these. A plan is a commitment: if a release, a
-- project or a team is genuinely going away, the plans that depend on it are exactly what the operator
-- needs to be told about, and cascading them away silently destroys planning history. The service layer
-- refuses first with a named error; these constraints are the backstop for direct SQL and for paths
-- nobody has written yet.
--
-- Verified before writing: zero rows violate any of the four (`release_id`, `project_id` and both
-- `team_id`s all resolve today), so every ADD CONSTRAINT below validates without a rewrite.

-- ── plan_key: mint the missing ones, then forbid NULL ────────────────────────
--
-- `uq_capacity_plans_key` is UNIQUE (project_id, plan_key) and NULLs are distinct in a btree, so it
-- never constrained a missing key. Three live plans had none — inserted directly, bypassing the
-- `CP-<n>` minting in `createPlan` — and `nextKeyNumber` ignores them, so a later plan in that project
-- would be minted a key that reads as if they never existed. The plan ID is the list's primary
-- affordance, so a row without one cannot be opened the way every other row is.
--
-- Numbering continues from the project's current maximum rather than restarting: reusing a number a
-- surviving row already holds would violate the unique index.
WITH minted AS (
  SELECT
    p.id,
    'CP-' || (
      COALESCE(
        (
          SELECT MAX((regexp_match(p2.plan_key, '^CP-(\d+)$'))[1]::int)
          FROM "work"."capacity_plans" p2
          WHERE p2.project_id = p.project_id AND p2.plan_key IS NOT NULL
        ),
        0
      )
      + ROW_NUMBER() OVER (PARTITION BY p.project_id ORDER BY p.created_at, p.id)
    )::text AS next_key
  FROM "work"."capacity_plans" p
  WHERE p.plan_key IS NULL
)
UPDATE "work"."capacity_plans" AS t
SET plan_key = minted.next_key
FROM minted
WHERE t.id = minted.id;--> statement-breakpoint

ALTER TABLE "work"."capacity_plans" ALTER COLUMN "plan_key" SET NOT NULL;--> statement-breakpoint

-- ── The four missing foreign keys ───────────────────────────────────────────

ALTER TABLE "work"."capacity_plans"
  ADD CONSTRAINT "fk_capacity_plans_project"
  FOREIGN KEY ("project_id") REFERENCES "work"."projects"("id") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "work"."capacity_plans"
  ADD CONSTRAINT "fk_capacity_plans_release"
  FOREIGN KEY ("release_id") REFERENCES "work"."releases"("id") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "work"."capacity_plan_teams"
  ADD CONSTRAINT "fk_capacity_plan_teams_team"
  FOREIGN KEY ("team_id") REFERENCES "work"."teams"("id") ON DELETE RESTRICT;--> statement-breakpoint

-- Allocations keep ON DELETE RESTRICT on the team too, even though `team_id` is nullable here: a NULL
-- is the Unallocated bucket and is unaffected, while a real team that still carries committed demand
-- must not disappear from under it.
ALTER TABLE "work"."capacity_plan_allocations"
  ADD CONSTRAINT "fk_capacity_allocations_team"
  FOREIGN KEY ("team_id") REFERENCES "work"."teams"("id") ON DELETE RESTRICT;
