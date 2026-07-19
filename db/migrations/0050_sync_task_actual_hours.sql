-- ============================================================================
-- Migration 0050: Sync actual_hours onto work.tasks too
-- ============================================================================
-- The trg_sync_actual_hours trigger (migration 0012) keeps a work item's
-- derived `actual_hours` equal to SUM(time_logs.hours). It was written before
-- the Phase 3 structural split (migration 0035) that moved tasks into their own
-- `work.tasks` table. Since then the function only updated `work.work_items`,
-- so logging time against a TASK (whose row now lives in `work.tasks`) matched
-- zero rows and its `actual_hours` never reflected the logged worklog.
--
-- A time_logs.work_item_id references exactly one of the two tables, so updating
-- both by id is safe: one UPDATE touches 1 row, the other 0. This restores the
-- single source of truth (Actual = SUM of time logs) for tasks as well.
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- ============================================================================

CREATE OR REPLACE FUNCTION work.sync_actual_hours()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_work_item_id uuid;
  v_total        numeric(8, 2);
BEGIN
  v_work_item_id := COALESCE(NEW.work_item_id, OLD.work_item_id);

  SELECT COALESCE(SUM(hours), 0)
    INTO v_total
    FROM work.time_logs
   WHERE work_item_id = v_work_item_id
     AND deleted_at   IS NULL;

  UPDATE work.work_items
     SET actual_hours = v_total,
         updated_at   = now()
   WHERE id = v_work_item_id;

  UPDATE work.tasks
     SET actual_hours = v_total,
         updated_at   = now()
   WHERE id = v_work_item_id;

  RETURN NULL;
END;
$$;
