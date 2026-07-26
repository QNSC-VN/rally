-- Extend activity_entity_type so the shared activity log can record iteration,
-- project, milestone and release revisions — not just work_item/task/attachment.
-- Kept SEPARATE from 0063 because Postgres forbids USING a new enum value in the
-- same transaction it was added in; 0063 (which uses them) runs afterwards.
ALTER TYPE "public"."activity_entity_type" ADD VALUE IF NOT EXISTS 'iteration';--> statement-breakpoint
ALTER TYPE "public"."activity_entity_type" ADD VALUE IF NOT EXISTS 'project';--> statement-breakpoint
ALTER TYPE "public"."activity_entity_type" ADD VALUE IF NOT EXISTS 'milestone';--> statement-breakpoint
ALTER TYPE "public"."activity_entity_type" ADD VALUE IF NOT EXISTS 'release';
