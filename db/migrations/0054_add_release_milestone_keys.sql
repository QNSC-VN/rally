-- Per-project display keys for Releases (RE-<n>) and Milestones (MS-<n>),
-- mirroring iterations.iteration_key (see 0021). Adds a nullable key column,
-- backfills existing rows deterministically by creation order, then enforces
-- per-project uniqueness. New keys are minted by the application (MAX+1 with a
-- unique-index retry), same pattern as iteration_key.

-- ── releases ────────────────────────────────────────────────────────────────
ALTER TABLE "work"."releases" ADD COLUMN "release_key" varchar(30);
--> statement-breakpoint

WITH numbered AS (
  SELECT id,
         'RE-' || ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS k
  FROM "work"."releases"
)
UPDATE "work"."releases" r
SET "release_key" = n.k
FROM numbered n
WHERE r.id = n.id;
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_releases_key"
  ON "work"."releases" ("project_id", "release_key");
--> statement-breakpoint

-- ── milestones ──────────────────────────────────────────────────────────────
ALTER TABLE "work"."milestones" ADD COLUMN "milestone_key" varchar(30);
--> statement-breakpoint

WITH numbered AS (
  SELECT id,
         'MS-' || ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS k
  FROM "work"."milestones"
)
UPDATE "work"."milestones" m
SET "milestone_key" = n.k
FROM numbered n
WHERE m.id = n.id;
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_milestones_key"
  ON "work"."milestones" ("project_id", "milestone_key");
