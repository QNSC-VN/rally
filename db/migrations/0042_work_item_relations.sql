-- 0042: Work-item relations (F6). Directed links between work items using the
-- BA relation set. One row per canonical source→target direction; the inverse
-- label (e.g. blocked_by) is derived in the application layer.
CREATE TYPE "public"."work_item_relation_type" AS ENUM (
  'blocks', 'duplicates', 'relates_to', 'depends_on', 'causes'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work"."work_item_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source_item_id" uuid NOT NULL,
  "target_item_id" uuid NOT NULL,
  "relation_type" "public"."work_item_relation_type" NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_wir_source_target_type"
  ON "work"."work_item_relations" ("source_item_id", "target_item_id", "relation_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_wir_source" ON "work"."work_item_relations" ("source_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_wir_target" ON "work"."work_item_relations" ("target_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_wir_workspace" ON "work"."work_item_relations" ("workspace_id");
