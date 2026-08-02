-- Give the workspace-scoped Project Admin role the new `capacity:view_draft` permission.
--
-- Required for AC-012: a Project Admin set to `Read-only` keeps "opening Draft and
-- Published plans while changing nothing". Draft visibility was
-- `capacity:manage || capacity:publish`, so a read-only Project Admin was refused Drafts
-- exactly as a Project Member is (AC-013) — the BA has ONE permission with two settings
-- where we have three codes, and no combination of the three could tell those two roles
-- apart. This is the fourth code.
--
-- Backfilled for the same reason `report:view` needed migration 0092: `db/seeds/bootstrap.ts`
-- upserts the per-workspace tier roles with `set: { name }`, deliberately, so a permission
-- ADDED to the catalogue never reaches a workspace that already exists.
--
-- Project Admin ONLY. Project Member must NOT receive it, or AC-013 breaks — the whole point
-- of the code is that those two roles now differ.
--
-- Forcing is safe here on the same narrow grounds as 0092: the permission is brand new, so
-- nobody can have deliberately revoked it. The `NOT @>` guard keeps the statement idempotent
-- for the migration runner.
UPDATE access.system_roles
SET permissions = permissions || '["capacity:view_draft"]'::jsonb
WHERE slug = 'project_admin'
  AND NOT (permissions @> '["capacity:view_draft"]'::jsonb);
