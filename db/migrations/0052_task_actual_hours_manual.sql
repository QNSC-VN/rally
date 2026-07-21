-- ============================================================================
-- Migration 0052: Task Actual hours become a manual input (DEV-015)
-- ============================================================================
-- BA-confirmed 2026-07-20 (SRS P1-TASK-01): a task's Actual hours are a manual
-- field, and its Estimate is read-only derived as `Estimate = To Do + Actuals`.
--
-- Previously `actual_hours` was auto-derived by the trg_sync_actual_hours
-- trigger (migrations 0012 / 0050) which set it to SUM(time_logs.hours). That
-- coupling is now removed: Actual is edited directly on the task/work item and
-- the Estimate is recomputed in the application layer from To Do + Actual.
--
-- The time_logs table and its API remain intact (retained as an optional
-- worklog/audit trail) — only the automatic Actual-hours coupling is dropped.
-- Existing actual_hours values are preserved as-is and become manually editable.
-- Idempotent: DROP ... IF EXISTS.
-- ============================================================================

DROP TRIGGER IF EXISTS "trg_sync_actual_hours" ON work.time_logs;
DROP FUNCTION IF EXISTS work.sync_actual_hours();
