-- 0055: Remove the unused 'causes' value from work_item_relation_type. The BA
-- relation set (DB design §8.2) is blocks / duplicates / relates_to / depends_on;
-- 'causes' was never part of the spec and has no rows. Postgres cannot drop an
-- enum value in place, so recreate the type and re-point the column.
ALTER TYPE "public"."work_item_relation_type" RENAME TO "work_item_relation_type_old";--> statement-breakpoint
CREATE TYPE "public"."work_item_relation_type" AS ENUM (
  'blocks', 'duplicates', 'relates_to', 'depends_on'
);--> statement-breakpoint
ALTER TABLE "work"."work_item_relations"
  ALTER COLUMN "relation_type" TYPE "public"."work_item_relation_type"
  USING "relation_type"::text::"public"."work_item_relation_type";--> statement-breakpoint
DROP TYPE "public"."work_item_relation_type_old";
