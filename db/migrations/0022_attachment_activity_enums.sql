-- Add typed enums for attachment status and activity log entity type.

CREATE TYPE "public"."attachment_status" AS ENUM ('pending', 'completed');

CREATE TYPE "public"."activity_entity_type" AS ENUM ('work_item', 'task', 'attachment');

ALTER TABLE "work"."attachments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "work"."attachments"
  ALTER COLUMN "status" TYPE "public"."attachment_status"
  USING "status"::"public"."attachment_status";
ALTER TABLE "work"."attachments" ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "work"."activity_logs"
  ALTER COLUMN "entity_type" TYPE "public"."activity_entity_type"
  USING "entity_type"::"public"."activity_entity_type";
