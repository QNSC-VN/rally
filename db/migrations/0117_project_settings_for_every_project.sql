-- Every project HAS estimation settings (SRS §4.2, §6.2, PRJ-06).
--
-- §4.2 lists the T-shirt scale and Hours per point among the required Create Project fields,
-- but they reached the database through a SECOND request: the SPA POSTed the project, then
-- fired a best-effort `PATCH /projects/:id/estimation-settings` which it SKIPPED whenever the
-- six values still equalled the defaults and merely toasted on failure. `createProject`
-- inserted no `work.project_settings` row at all. So a required setting was optional in
-- practice, and the common path left every project with no row for later readers to fall back
-- around — `ProjectsService.getEstimationSettings` and
-- `PreliminaryEstimateMapService.forProject` both carry a defaults branch for exactly this.
--
-- The service now writes the row inside the create transaction. This migration makes the
-- invariant true for the rows that already exist, and keeps it true for the writers that never
-- reach the service.
--
-- Why a TRIGGER and not "the service always writes it": the service is demonstrably not the
-- only writer. `db/seeds/**` inserts `work.projects` directly (`seedProject` in demo.ts, plus
-- second-project.ts), which is the same reason `trg_task_iteration_from_parent`,
-- `trg_sync_accepted_date` and `timebox_group_id` are triggers rather than service hooks. The
-- trigger is the FLOOR (the documented defaults); `createProject`'s own upsert is what applies
-- a Workspace Admin's choice on top, in the same transaction, and it targets
-- `uq_project_settings_project` precisely because this trigger has already run by then.

-- 1. Backfill: one row per project that has none, using the column DEFAULTs.
--    The defaults are not invented here — they are migration 0106's own column DEFAULTs, which
--    `DEFAULT_PROJECT_ESTIMATION_SETTINGS` and `DEFAULT_PRELIMINARY_ESTIMATE_MAP` already
--    mirror, so no project's Estimated Progress, capacity Preliminary tier or settings form
--    changes value on deploy. Naming only workspace_id/project_id and letting the DEFAULTs
--    supply the six numbers is what guarantees that: there is one source for them, not two.
--    Soft-deleted projects are included deliberately — `deleted_at` is reversible by clearing
--    the column, and a restored project with no settings row would reintroduce the gap.
INSERT INTO work.project_settings (workspace_id, project_id)
SELECT p.workspace_id, p.id
FROM work.projects p
WHERE NOT EXISTS (
  SELECT 1 FROM work.project_settings s WHERE s.project_id = p.id
);

-- 2. Keep it true for every future writer, service or not.
CREATE OR REPLACE FUNCTION work.project_settings_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- ON CONFLICT DO NOTHING, not an unguarded insert: a caller may legitimately insert the
  -- project and its settings in one transaction, and this must not turn that into a unique
  -- violation on uq_project_settings_project.
  INSERT INTO work.project_settings (workspace_id, project_id)
  VALUES (NEW.workspace_id, NEW.id)
  ON CONFLICT (project_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_settings_default ON work.projects;

CREATE TRIGGER trg_project_settings_default
  AFTER INSERT ON work.projects
  FOR EACH ROW
  EXECUTE FUNCTION work.project_settings_default();
