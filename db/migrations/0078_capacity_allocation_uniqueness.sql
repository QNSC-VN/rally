-- One allocation row per (plan, Feature, team). There was NO index enforcing it.
--
-- The service has always merged into an existing row (`findAllocationFor` then add), so the app
-- produced one row per pair in practice — but nothing stopped a second one: two concurrent
-- allocations race that read, a retried request duplicates, and a seed using
-- `ON CONFLICT DO NOTHING` has no constraint to conflict WITH, so re-running it silently multiplied
-- the fixture (three copies of the same allocation, and a team's Estimated three times its truth).
--
-- Two indexes, because NULL is not a value: Postgres treats NULL team ids as distinct, so the
-- ordinary index cannot hold the Unallocated bucket to one row per Feature. The partial index does.
DELETE FROM "work"."capacity_plan_allocations" a
USING "work"."capacity_plan_allocations" b
WHERE a."plan_id" = b."plan_id"
  AND a."portfolio_item_id" = b."portfolio_item_id"
  AND a."team_id" IS NOT DISTINCT FROM b."team_id"
  AND a."created_at" > b."created_at";--> statement-breakpoint

-- Same-timestamp duplicates (a single seed statement inserts them in one transaction) need the id
-- as the tiebreaker, so the delete above cannot catch them.
DELETE FROM "work"."capacity_plan_allocations" a
USING "work"."capacity_plan_allocations" b
WHERE a."plan_id" = b."plan_id"
  AND a."portfolio_item_id" = b."portfolio_item_id"
  AND a."team_id" IS NOT DISTINCT FROM b."team_id"
  AND a."created_at" = b."created_at"
  AND a."id" > b."id";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_capacity_allocation_team"
  ON "work"."capacity_plan_allocations" ("plan_id", "portfolio_item_id", "team_id")
  WHERE "team_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_capacity_allocation_unassigned"
  ON "work"."capacity_plan_allocations" ("plan_id", "portfolio_item_id")
  WHERE "team_id" IS NULL;
