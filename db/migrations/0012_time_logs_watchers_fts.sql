-- ============================================================================
-- Migration 0012: Time Logging, Watchers, Full-Text Search
-- ============================================================================
-- 1. work.time_logs  — per-user time-entry records (Jira-style worklog)
-- 2. work.work_item_watchers — follower/subscriber fan-out for notifications
-- 3. work.work_items.search_vector — STORED tsvector for GIN full-text search
-- 4. work.sync_actual_hours trigger — keeps work_items.actual_hours up-to-date
--    from time_logs without requiring the service to do the aggregation.
-- ============================================================================

-- ── 1. time_logs ─────────────────────────────────────────────────────────────

CREATE TABLE "work"."time_logs" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL,
  "work_item_id" uuid NOT NULL,
  "user_id"      uuid NOT NULL,
  "logged_date"  date NOT NULL,
  "hours"        numeric(6, 2) NOT NULL,
  "description"  text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  "deleted_at"   timestamptz,
  CONSTRAINT "ck_tl_hours_positive" CHECK ("hours" > 0 AND "hours" <= 24)
);

CREATE INDEX "ix_tl_work_item" ON "work"."time_logs" ("work_item_id")
  WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_tl_user" ON "work"."time_logs" ("user_id", "logged_date" DESC);
CREATE INDEX "ix_tl_tenant" ON "work"."time_logs" ("tenant_id");

ALTER TABLE "work"."time_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "work"."time_logs"
  AS PERMISSIVE FOR ALL
  USING      ("tenant_id" = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

-- ── 2. work_item_watchers ────────────────────────────────────────────────────

CREATE TABLE "work"."work_item_watchers" (
  "work_item_id" uuid NOT NULL,
  "user_id"      uuid NOT NULL,
  "tenant_id"    uuid NOT NULL,
  "watched_at"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("work_item_id", "user_id")
);

CREATE INDEX "ix_wiw_user"   ON "work"."work_item_watchers" ("user_id");
CREATE INDEX "ix_wiw_tenant" ON "work"."work_item_watchers" ("tenant_id");

ALTER TABLE "work"."work_item_watchers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "work"."work_item_watchers"
  AS PERMISSIVE FOR ALL
  USING      ("tenant_id" = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid);

-- ── 3. Full-text search: STORED tsvector column + GIN index ─────────────────
-- Weights: A = item_key & title (highest), B = description, C = acceptance_criteria.
-- STORED means Postgres computes and persists it on INSERT/UPDATE — zero query overhead.

ALTER TABLE "work"."work_items"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("item_key", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("acceptance_criteria", '')), 'C')
  ) STORED;

CREATE INDEX "ix_wi_fts" ON "work"."work_items" USING GIN ("search_vector")
  WHERE "deleted_at" IS NULL;

-- ── 4. Trigger: sync actual_hours from time_logs ──────────────────────────────
-- Fires after any INSERT / UPDATE (hours/deleted_at change) / DELETE on time_logs.
-- Uses COALESCE(NEW, OLD) so it works for all three event types.

CREATE OR REPLACE FUNCTION work.sync_actual_hours()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_work_item_id uuid;
BEGIN
  v_work_item_id := COALESCE(NEW.work_item_id, OLD.work_item_id);

  UPDATE work.work_items
    SET actual_hours = (
      SELECT COALESCE(SUM(hours), 0)
        FROM work.time_logs
       WHERE work_item_id = v_work_item_id
         AND deleted_at   IS NULL
    ),
    updated_at = now()
  WHERE id = v_work_item_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_sync_actual_hours"
AFTER INSERT OR UPDATE OF "hours", "deleted_at" OR DELETE
ON "work"."time_logs"
FOR EACH ROW EXECUTE FUNCTION work.sync_actual_hours();
