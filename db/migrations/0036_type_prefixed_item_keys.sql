-- 0036: Add item_type column to project_counters for per-type sequential numbering
-- Changes item_key format from "PROJ-NN" to type-prefixed "US000001" / "DE000001" etc.

ALTER TABLE "work"."project_counters" ADD COLUMN IF NOT EXISTS "item_type" "public"."work_item_type" NOT NULL DEFAULT 'story';
--> statement-breakpoint
-- Widen the primary key to (project_id, item_type) BEFORE seeding per-type rows.
-- Existing rows carry item_type='story' (column default), so each project still
-- has exactly one row here => the composite key is satisfiable. Doing this first
-- is required: the INSERT below adds additional item_type rows per project, which
-- would violate the old single-column (project_id) primary key on any database
-- that already has counter rows (fresh CI DBs have none, so this only bit develop).
ALTER TABLE "work"."project_counters" DROP CONSTRAINT IF EXISTS project_counters_pkey;
--> statement-breakpoint
ALTER TABLE "work"."project_counters" ADD CONSTRAINT project_counters_pkey PRIMARY KEY ("project_id", "item_type");
--> statement-breakpoint
INSERT INTO "work"."project_counters" ("project_id", "workspace_id", "item_type", "last_item_number", "updated_at")
SELECT DISTINCT pc.project_id, pc.workspace_id, t.enumlabel::"public"."work_item_type", 0, now()
FROM "work"."project_counters" pc
CROSS JOIN (
  SELECT unnest(enum_range(NULL::"public"."work_item_type")::text[]) AS enumlabel
) t
WHERE NOT EXISTS (
  SELECT 1 FROM "work"."project_counters" c2
  WHERE c2.project_id = pc.project_id AND c2.item_type = t.enumlabel::"public"."work_item_type"
);
--> statement-breakpoint
UPDATE "work"."project_counters" pc
SET "last_item_number" = GREATEST(pc.last_item_number, COALESCE(mk.max_num, 0)), "updated_at" = now()
FROM (
  SELECT wi.project_id, wi.type AS item_type,
    MAX(CASE WHEN wi.item_key ~ '^[A-Z]+-[0-9]+$' THEN CAST(SPLIT_PART(wi.item_key, '-', 2) AS INTEGER) ELSE 0 END) AS max_num
  FROM "work"."work_items" wi
  GROUP BY wi.project_id, wi.type
) mk
WHERE pc.project_id = mk.project_id AND pc.item_type = mk.item_type;
--> statement-breakpoint
UPDATE "work"."work_items" wi
SET "item_key" =
  CASE wi.type
    WHEN 'story'      THEN 'US' || LPAD(SPLIT_PART(wi.item_key, '-', 2), 6, '0')
    WHEN 'defect'     THEN 'DE' || LPAD(SPLIT_PART(wi.item_key, '-', 2), 6, '0')
    WHEN 'task'       THEN 'TA' || LPAD(SPLIT_PART(wi.item_key, '-', 2), 6, '0')
    WHEN 'feature'    THEN 'FE' || LPAD(SPLIT_PART(wi.item_key, '-', 2), 6, '0')
    WHEN 'initiative' THEN 'IN' || LPAD(SPLIT_PART(wi.item_key, '-', 2), 6, '0')
    ELSE wi.item_key
  END
WHERE wi.item_key ~ '^[A-Z]+-[0-9]+$';