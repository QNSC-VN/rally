-- Invitation resend tracking: how many times an invite was re-sent and when the
-- last email went out (powers the per-invitation resend cooldown + UX).
ALTER TABLE "workspace"."workspace_invitations"
  ADD COLUMN "resend_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "last_sent_at" timestamptz NOT NULL DEFAULT now();
