-- Unify the two revision-history tables into ONE shared activity_logs store.
-- activity_logs (owned by work-items) is already polymorphic (entity_type +
-- entity_id); generalize its anchor column work_item_id → nullable context_id
-- (parent grouping so child logs surface on a parent), then fold the separate
-- iteration_activity_logs rows in and drop that table.
ALTER TABLE "work"."activity_logs" RENAME COLUMN "work_item_id" TO "context_id";--> statement-breakpoint
ALTER TABLE "work"."activity_logs" ALTER COLUMN "context_id" DROP NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "work"."ix_activity_work_item";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_activity_entity" ON "work"."activity_logs" ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_activity_context" ON "work"."activity_logs" ("context_id");--> statement-breakpoint
INSERT INTO "work"."activity_logs" ("id","workspace_id","project_id","entity_type","entity_id","context_id","actor_id","action","changes","metadata","created_at")
SELECT "id","workspace_id","project_id",'iteration',"iteration_id",NULL,"actor_id","action","changes","metadata","created_at"
FROM "work"."iteration_activity_logs"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
DROP TABLE IF EXISTS "work"."iteration_activity_logs";
