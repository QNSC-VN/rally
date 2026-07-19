-- 0046: Add an optional start date to work.projects (BA New Project form field).
-- Nullable with no backfill — existing projects simply have no start date until
-- one is set. Surfaced via POST/PATCH /v1/projects and the project responses.
ALTER TABLE "work"."projects" ADD COLUMN IF NOT EXISTS "start_date" date;
