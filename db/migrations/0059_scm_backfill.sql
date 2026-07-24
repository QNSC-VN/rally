-- 0059: SCM Phase 2 — GitHub App backfill.
--
-- `scm.repositories.installation_id` caches the GitHub App installation id for a
-- repo (avoids re-resolving on every REST call). `scm.backfill_jobs` is a small
-- durable job queue: enqueued when a repo is mapped or "Sync now" is clicked,
-- drained by the worker (ScmBackfillRelayService), which authenticates as the
-- App and links historical PRs/commits via the same idempotent linker as the
-- webhook path.

ALTER TABLE "scm"."repositories" ADD COLUMN IF NOT EXISTS "installation_id" varchar(64);
--> statement-breakpoint
CREATE TYPE "public"."scm_backfill_status" AS ENUM('pending', 'done', 'failed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm"."backfill_jobs" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"  uuid NOT NULL,
  "repository_id" uuid NOT NULL,
  "status"        "public"."scm_backfill_status" NOT NULL DEFAULT 'pending',
  "attempts"      integer NOT NULL DEFAULT 0,
  "last_error"    text,
  "counts"        jsonb,
  "scheduled_at"  timestamptz NOT NULL DEFAULT now(),
  "requested_at"  timestamptz NOT NULL DEFAULT now(),
  "finished_at"   timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_scm_backfill_repository"
  ON "scm"."backfill_jobs" USING btree ("repository_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_scm_backfill_pending"
  ON "scm"."backfill_jobs" USING btree ("status", "scheduled_at") WHERE status = 'pending';
