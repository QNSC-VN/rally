-- Extend activity_entity_type so the shared activity log can record iteration,
-- project, milestone and release revisions — not just work_item/task/attachment.
--
-- Done by RECREATING the type (rename-old → create-new → swap column → drop-old)
-- rather than `ALTER TYPE ... ADD VALUE`. drizzle applies every pending migration
-- inside ONE transaction, and Postgres forbids USING a value added via ADD VALUE
-- in the same transaction it was added (0064 immediately inserts 'iteration'
-- rows). A fresh CREATE TYPE has all its values usable in that same transaction,
-- so the type-swap is safe under drizzle's single-tx migrator on every PG version.
ALTER TYPE "public"."activity_entity_type" RENAME TO "activity_entity_type_old";--> statement-breakpoint
CREATE TYPE "public"."activity_entity_type" AS ENUM ('work_item', 'task', 'attachment', 'iteration', 'project', 'milestone', 'release');--> statement-breakpoint
ALTER TABLE "work"."activity_logs" ALTER COLUMN "entity_type" TYPE "public"."activity_entity_type" USING "entity_type"::text::"public"."activity_entity_type";--> statement-breakpoint
DROP TYPE "public"."activity_entity_type_old";
