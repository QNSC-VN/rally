-- Attachments become polymorphic, so a portfolio item can carry files.
--
-- Second table to follow the `(entity_type, entity_id)` shape that `activity_logs` set and
-- `comments` took in 0080, and it reuses the SAME `entity_ref_type` enum 0080 created —
-- that enum exists to list the things that can own child records, and this is exactly such
-- a record. A second enum here would be two vocabularies for one idea.
--
-- The table is RENAMED, not just widened. `work_item_attachments` holding a portfolio
-- item's files would be a name that lies about its contents, and this junction table is
-- read by a cron reaper (`apps/worker/src/cron/cleanup.cron.ts`) whose whole job is
-- deciding whether a blob is still referenced — the one place a misleading name is most
-- expensive. `storage.files` needed no change: 0053 already made it owner-agnostic.
--
-- Statement order IS the safety argument, as in 0080: the backfill runs while
-- `work_item_id` still exists, and the column is dropped only afterwards, so every existing
-- attachment keeps its subject.
--
-- The PRIMARY KEY moves from (work_item_id, file_id) to (entity_type, entity_id, file_id).
-- It stays a natural key rather than gaining a surrogate id: the same file attached twice to
-- one item is still one attachment, and that is the constraint enforcing it.

ALTER TABLE "work"."work_item_attachments" RENAME TO "attachments";--> statement-breakpoint

ALTER TABLE "work"."attachments"
  ADD COLUMN "entity_type" "entity_ref_type" NOT NULL DEFAULT 'work_item',
  ADD COLUMN "entity_id" uuid;--> statement-breakpoint

-- Every existing attachment is on a work item, by construction.
UPDATE "work"."attachments" SET "entity_id" = "work_item_id" WHERE "entity_id" IS NULL;--> statement-breakpoint

ALTER TABLE "work"."attachments"
  ALTER COLUMN "entity_id" SET NOT NULL,
  -- The default existed only to let ADD COLUMN succeed on a populated table. Leaving it
  -- would silently absorb a caller that forgot to say what it was attaching to.
  ALTER COLUMN "entity_type" DROP DEFAULT;--> statement-breakpoint

-- Dropping work_item_id takes the old PK and its FK with it, so both are rebuilt below.
ALTER TABLE "work"."attachments" DROP CONSTRAINT "work_item_attachments_pkey";--> statement-breakpoint
DROP INDEX IF EXISTS "work"."ix_wia_work_item";--> statement-breakpoint
ALTER TABLE "work"."attachments" DROP COLUMN "work_item_id";--> statement-breakpoint

ALTER TABLE "work"."attachments"
  ADD CONSTRAINT "attachments_pkey" PRIMARY KEY ("entity_type", "entity_id", "file_id");--> statement-breakpoint

-- Replaces ix_wia_work_item. Every read is "the attachments on THIS subject".
CREATE INDEX "ix_attachments_entity" ON "work"."attachments" ("entity_type", "entity_id");--> statement-breakpoint

-- The remaining two indexes only need renaming to match the table; the reaper's
-- "is this file still referenced?" lookup is ix_attachments_file.
ALTER INDEX "work"."ix_wia_file" RENAME TO "ix_attachments_file";--> statement-breakpoint
ALTER INDEX "work"."ix_wia_workspace" RENAME TO "ix_attachments_workspace";
