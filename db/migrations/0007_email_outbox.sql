-- Migration 0007: email_outbox table + email_job_status enum
-- Creates the async email job queue used by the transactional email system.
--
-- Design: API-side services write rows in the same DB transaction as their
-- business data (e.g. password_reset_tokens). The worker EmailRelayService
-- polls this table, renders templates, and dispatches via IEmailProvider.
-- Guarantees at-least-once delivery with no dual-write.

-- ── Enum ──────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_job_status') THEN
    CREATE TYPE email_job_status AS ENUM ('pending', 'sent', 'failed');
  END IF;
END
$$;

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messaging.email_outbox (
  id               UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  "to"             VARCHAR(320)             NOT NULL,
  template         VARCHAR(100)             NOT NULL,
  vars             JSONB                    NOT NULL DEFAULT '{}',
  status           email_job_status         NOT NULL DEFAULT 'pending',
  attempts         INTEGER                  NOT NULL DEFAULT 0,
  last_error       TEXT,
  sent_at          TIMESTAMPTZ,
  scheduled_at     TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  -- Deduplication: callers supply a deterministic key scoped to their business
  -- event (e.g. sha256('password-reset:'+tokenHash), invitation.id).
  -- ON CONFLICT DO NOTHING in EmailSchedulerService prevents duplicate rows.
  idempotency_key  VARCHAR(255)             UNIQUE
);

-- Index for the relay worker's polling query (SELECT ... WHERE status='pending' ORDER BY scheduled_at)
CREATE INDEX IF NOT EXISTS ix_email_outbox_status
  ON messaging.email_outbox (status, scheduled_at)
  WHERE status = 'pending';
