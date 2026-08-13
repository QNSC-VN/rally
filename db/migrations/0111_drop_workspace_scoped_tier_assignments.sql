-- Delete WORKSPACE-scoped assignments of the per-Project tier roles. Migration 0105
-- removed scope_type='project' rows but left these: a user invited at project_admin /
-- project_member before the access-level cutover holds the FULL tier delivery set as a
-- workspace baseline — every project, today. Under the 3-level model those roles are
-- granted per-Project ONLY, via project_members.access_level; workspace_members has no
-- roleId column of their own, so these rows are pure legacy over-grant.
--
-- Forced, not merged: the rows predate the model and nothing legitimate re-creates them
-- (assignRole now refuses scope_type='project', and the invitation path lands No Access).
DELETE FROM access.user_role_assignments
WHERE scope_type = 'workspace'
  AND role_id IN (SELECT id FROM access.system_roles WHERE slug IN ('project_admin', 'project_member'));
