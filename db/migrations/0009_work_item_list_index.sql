-- Migration 0009: work_items default-list covering index
-- Adds a partial composite index for the primary work-item listing/pagination
-- path: filter by (tenant_id, project_id), order by created_at, excluding
-- soft-deleted rows. Lets Postgres satisfy the query from the index alone
-- (no extra sort step) and keeps the index small by skipping deleted rows.
--
-- Mirrors the schema definition `listIdx` in db/schema/work.ts.

CREATE INDEX IF NOT EXISTS "ix_wi_list"
  ON "work"."work_items" USING btree ("tenant_id", "project_id", "created_at")
  WHERE deleted_at IS NULL;
