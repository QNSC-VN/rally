-- 0051: Add work_items.flow_state — the BA "Flow State" business dimension.
-- BR-WI-01: Schedule State and Flow State share the same six values and mirror
-- bidirectionally. Flow State was previously (incorrectly) surfaced from
-- status_id -> workflow_statuses; it is now its own column that always mirrors
-- schedule_state. status_id is retained purely for the (future) Kanban board.
--
-- Reuses the existing work_item_schedule_state enum (identical 6-value catalog):
--   idea, defined, in_progress, completed, accepted, release
ALTER TABLE "work"."work_items"
  ADD COLUMN "flow_state" "public"."work_item_schedule_state" NOT NULL DEFAULT 'defined';
--> statement-breakpoint
-- Backfill: every existing row's Flow State mirrors its current Schedule State.
UPDATE "work"."work_items" SET "flow_state" = "schedule_state";
