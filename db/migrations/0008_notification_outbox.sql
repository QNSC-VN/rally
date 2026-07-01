-- Migration 0008: notification_outbox table + notification_job_status enum
-- Creates the async notification job queue used by the transactional notification system.
--
-- Design: API-side services write rows in the same DB transaction as their
-- business data (NotificationSchedulerService). The worker NotificationRelayService
-- polls this table, renders notification templates, and writes to
-- notifications.in_app_notifications. Guarantees at-least-once delivery with
-- no dual-write. Deduplication via idempotency_key (outbox layer) and
-- source_event_id (in_app_notifications layer).

-- ── Enum ──────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_job_status') THEN
    CREATE TYPE notification_job_status AS ENUM ('pending', 'sent', 'failed');
  END IF;
END
$$;

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messaging.notification_outbox (
  id               UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID                          NOT NULL,
  recipient_id     UUID                          NOT NULL,
  actor_id         UUID,
  type             VARCHAR(100)                  NOT NULL,
  vars             JSONB                         NOT NULL DEFAULT '{}',
  -- UUID of the linked resource (work item, workspace, etc.) — nullable.
  resource_id      UUID,
  status           notification_job_status       NOT NULL DEFAULT 'pending',
  attempts         INTEGER                       NOT NULL DEFAULT 0,
  last_error       TEXT,
  dispatched_at    TIMESTAMPTZ,
  scheduled_at     TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
  -- Deduplication: callers supply a deterministic key scoped to their business
  -- event (e.g. invitation.id, sha256('assigned:'+assignmentId)).
  -- ON CONFLICT DO NOTHING in NotificationSchedulerService prevents duplicate rows.
  idempotency_key  VARCHAR(255)                  UNIQUE
);

-- Index for the relay worker's polling query (SELECT ... WHERE status='pending' ORDER BY scheduled_at)
CREATE INDEX IF NOT EXISTS ix_notification_outbox_status
  ON messaging.notification_outbox (status, scheduled_at)
  WHERE status = 'pending';
