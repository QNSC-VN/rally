-- Migration: 0013_attachment_status
-- Adds lifecycle status column to work.attachments so the presign→upload→confirm
-- flow can track pending / completed state. Soft-delete is already handled by
-- deletedAt; no 'deleted' status enum needed.

ALTER TABLE work.attachments
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CONSTRAINT ck_attach_status CHECK (status IN ('pending', 'completed'));

-- Index for cleanup job: delete pending rows older than 1 hour
CREATE INDEX IF NOT EXISTS ix_attach_pending_cleanup
  ON work.attachments (created_at)
  WHERE status = 'pending' AND deleted_at IS NULL;
