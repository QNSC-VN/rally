-- Add typed enums for attachment status and activity log entity type.

CREATE TYPE "public"."attachment_status" AS ENUM ('pending', 'completed');

CREATE TYPE "public"."activity_entity_type" AS ENUM ('work_item', 'task', 'attachment');

-- Drop the partial index and CHECK constraint that reference "status" while it is
-- still text. Postgres cannot rebuild a partial-index predicate across an
-- ALTER COLUMN ... TYPE change and fails with 42P17
-- ("functions in index predicate must be marked IMMUTABLE"), so we drop first
-- and recreate the index against the enum column afterwards.
DROP INDEX IF EXISTS "work"."ix_attach_pending_cleanup";
ALTER TABLE "work"."attachments" DROP CONSTRAINT IF EXISTS "ck_attach_status";

ALTER TABLE "work"."attachments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "work"."attachments"
  ALTER COLUMN "status" TYPE "public"."attachment_status"
  USING "status"::"public"."attachment_status";
ALTER TABLE "work"."attachments" ALTER COLUMN "status" SET DEFAULT 'pending';

-- Recreate the cleanup index now that "status" is the enum type.
CREATE INDEX IF NOT EXISTS "ix_attach_pending_cleanup"
  ON "work"."attachments" ("created_at")
  WHERE "status" = 'pending' AND "deleted_at" IS NULL;

ALTER TABLE "work"."activity_logs"
  ALTER COLUMN "entity_type" TYPE "public"."activity_entity_type"
  USING "entity_type"::"public"."activity_entity_type";
