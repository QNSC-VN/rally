-- ============================================================================
-- Migration 0010: reconcile email_outbox drift + notification_preferences
-- ============================================================================
-- The original drizzle-kit output for this slot re-CREATE'd the email/
-- notification outbox enums + tables + ix_wi_list that the hand-written
-- migrations 0007/0008/0009 already create. On a fresh database that runs the
-- full chain (0000 -> 0011) those raw CREATEs collide ("type already exists").
--
-- This version expresses only the *genuine* delta that post-dated 0007/0008,
-- written idempotently so it is safe on a fresh DB and on any environment that
-- already has the 0007/0008/0009 objects:
--   1. email_outbox gains recipient_id + tenant_id (added to the schema after
--      0007 shipped).
--   2. notifications.notification_preferences is a brand-new table.
-- notification_outbox (0008) and ix_wi_list (0009) already match the schema,
-- so nothing is emitted for them here.
-- ============================================================================

-- 1. email_outbox drift (recipient_id + tenant_id)
ALTER TABLE "messaging"."email_outbox"
  ADD COLUMN IF NOT EXISTS "recipient_id" uuid,
  ADD COLUMN IF NOT EXISTS "tenant_id"    uuid;
--> statement-breakpoint

-- 2. notification_preferences (new)
CREATE TABLE IF NOT EXISTS "notifications"."notification_preferences" (
	"id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id"  uuid NOT NULL,
	"user_id"    uuid NOT NULL,
	"type"       varchar(100) NOT NULL,
	"in_app"     boolean NOT NULL DEFAULT true,
	"email"      boolean NOT NULL DEFAULT true,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notif_pref_user_type" ON "notifications"."notification_preferences" USING btree ("tenant_id","user_id","type");