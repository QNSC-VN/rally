-- Remove report:view, portfolio:view and capacity:view from workspace-scoped
-- project_member (Editor) tier roles. Under the 3-level access model (§5) the Editor
-- is delivery-only — Portfolio Items, Capacity Planning and Reports are Admin/WA surfaces.
--
-- The code constant (db/permissions.catalog.ts PROJECT_MEMBER) was already trimmed, but the
-- seed upserts `set: { name }` so it never clobbers an admin's edits to a tier role's
-- permission array. Every workspace created before this change therefore keeps the old array
-- (with the three view perms), and the catalogue edit alone does not reach them. This is the
-- inverse of migration 0092 (which ADDED report:view to project_member).
--
-- Only project_member is touched — project_admin retains all three (Admin sees them per §5).
-- The `-` operator on a jsonb array removes a matching element and is a no-op if absent, so
-- this is idempotent.
UPDATE access.system_roles
SET permissions = permissions - 'report:view' - 'portfolio:view' - 'capacity:view'
WHERE slug = 'project_member'
  AND workspace_id IS NOT NULL;
