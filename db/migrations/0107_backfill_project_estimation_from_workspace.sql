-- Backfill work.project_settings from the workspace-level preliminary_estimate_map.
-- Copies the workspace's T-shirt-size → points/count map + hours_per_point to every
-- project that doesn't yet have a row. The workspace map remains as the source until
-- all callers are migrated off forWorkspace(), then it gets removed in a later migration.

INSERT INTO work.project_settings (workspace_id, project_id, xs_points, s_points, m_points, l_points, xl_points, hours_per_point)
SELECT
  p.workspace_id,
  p.id,
  COALESCE(
    ((ws.preliminary_estimate_map -> 'xs' ->> 'points')::int),
    1
  ),
  COALESCE(
    ((ws.preliminary_estimate_map -> 's' ->> 'points')::int),
    3
  ),
  COALESCE(
    ((ws.preliminary_estimate_map -> 'm' ->> 'points')::int),
    5
  ),
  COALESCE(
    ((ws.preliminary_estimate_map -> 'l' ->> 'points')::int),
    8
  ),
  COALESCE(
    ((ws.preliminary_estimate_map -> 'xl' ->> 'points')::int),
    13
  ),
  8.0
FROM work.projects p
LEFT JOIN workspace.workspace_settings ws ON ws.workspace_id = p.workspace_id
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM work.project_settings ps WHERE ps.project_id = p.id
  );
