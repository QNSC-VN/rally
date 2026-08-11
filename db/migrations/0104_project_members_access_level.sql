-- Phase 1 (expand) of the RBAC migration to per-Project access levels.
-- See docs/superpowers/plans/rbac-migration.md.
--
-- Adds a nullable `access_level` ('admin' | 'editor') to work.project_members
-- and backfills it from the retiring tier model:
--   project_admin  -> admin
--   everything else (project_member / unknown slug / no role) -> editor
--   removed / no active row -> NULL = No Access (not a member)
-- The model has THREE levels total: workspace_admin + per-Project admin/editor.
-- There is no 'viewer' level and no named 'No Access' level — No Access is
-- simply the absence of an active project_members row.
-- Project-scoped user_role_assignments are mirrored in as well, so nothing is
-- lost. The column is ADDITIVE: role_id, status and the scopeType='project'
-- assignments all stay — the still-deployed old engine keeps working. The
-- engine swap (Phase 3) is what starts reading access_level; the contract drop
-- (Phase 10) removes the old columns/rows last.

-- 1. Add the column. NULL = No Access (no active project membership).
ALTER TABLE work.project_members
  ADD COLUMN IF NOT EXISTS access_level VARCHAR(10)
  CONSTRAINT chk_project_access_level
    CHECK (access_level IS NULL OR access_level IN ('admin', 'editor'));

-- 2. Backfill from the existing role_id via the system_roles slug.
--    project_admin -> admin; everything else active -> editor (the basic member
--    level — there is no viewer).
UPDATE work.project_members pm
SET access_level =
  CASE
    WHEN sr.slug = 'project_admin' THEN 'admin'
    ELSE 'editor'
  END
FROM access.system_roles sr
WHERE pm.role_id = sr.id
  AND pm.status = 'active';

-- 3. Active rows whose role did not resolve (no role_id / unknown slug) -> editor.
UPDATE work.project_members
SET access_level = 'editor'
WHERE status = 'active'
  AND access_level IS NULL;

-- 4. Mirror project-scoped role assignments (the live permission source) into
--    project_members so no access row is lost. The role assignment wins on
--    conflict (it is what the current engine actually reads).
INSERT INTO work.project_members
  (id, workspace_id, project_id, user_id, role_id, status, access_level, joined_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  ura.workspace_id,
  ura.scope_id,
  ura.user_id,
  ura.role_id,
  'active',
  CASE
    WHEN sr.slug = 'project_admin' THEN 'admin'
    ELSE 'editor'
  END,
  now(), now(), now()
FROM access.user_role_assignments ura
JOIN access.system_roles sr ON sr.id = ura.role_id
WHERE ura.scope_type = 'project'
ON CONFLICT (project_id, user_id)
DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = now();
