-- Comments become polymorphic, so a portfolio item can have a discussion.
--
-- `comments.work_item_id` was a plain NOT NULL column, which is why the Portfolio detail
-- page had no Comments section: there was nowhere to hang one. This replaces it with the
-- `(entity_type, entity_id)` pair that `activity_logs` in this same schema already uses —
-- see the comment on that table for the reasoning. Following the existing shape rather
-- than inventing a second one is the whole point.
--
-- `entity_ref_type` is deliberately NEW and SHARED rather than reusing
-- `activity_entity_type`. The two answer different questions: activity can be logged
-- against a task or an attachment, neither of which can own a comment. This enum lists
-- exactly the things that can own child records, and attachments / labels / watchers will
-- reuse it as they follow.
--
-- Ordering matters here. The backfill runs while `work_item_id` still exists, and the
-- column is only dropped afterwards, so the statement order below IS the safety argument:
-- every existing row keeps its subject.

CREATE TYPE "entity_ref_type" AS ENUM ('work_item', 'portfolio_item');--> statement-breakpoint

ALTER TABLE "work"."comments"
  ADD COLUMN "entity_type" "entity_ref_type" NOT NULL DEFAULT 'work_item',
  ADD COLUMN "entity_id" uuid;--> statement-breakpoint

-- Every existing comment is on a work item, by construction.
UPDATE "work"."comments" SET "entity_id" = "work_item_id" WHERE "entity_id" IS NULL;--> statement-breakpoint

ALTER TABLE "work"."comments"
  ALTER COLUMN "entity_id" SET NOT NULL,
  -- The default existed only to let the ADD COLUMN succeed on a populated table. Leaving
  -- it would silently absorb a caller that forgot to say what it was commenting on.
  ALTER COLUMN "entity_type" DROP DEFAULT;--> statement-breakpoint

DROP INDEX IF EXISTS "work"."ix_comments_work_item";--> statement-breakpoint
ALTER TABLE "work"."comments" DROP COLUMN "work_item_id";--> statement-breakpoint

-- Replaces the old single-column index. Every read is "the comments on THIS subject", so
-- the pair is the access path.
CREATE INDEX "ix_comments_entity" ON "work"."comments" ("entity_type", "entity_id");
