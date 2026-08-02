-- Give the workspace-scoped tier roles the Phase 6 `report:view` permission.
--
-- Phase 6 added `report:view` to `db/permissions.catalog.ts` for both PROJECT_ADMIN and
-- PROJECT_MEMBER, but the catalogue only reaches a workspace through `db/seeds/bootstrap.ts`,
-- whose upsert is deliberately `set: { name }` — it must not clobber an admin's edits to a
-- tier role's permissions. Correct for edits, wrong for a brand-new permission: every
-- workspace created before Phase 6 kept its old array, so `report:view` never arrived and
-- EVERY report route answered 403 to everyone except Workspace Admin (whose grant is the
-- global immutable anchor). Verified on the local database: the global templates carry 29 and
-- 9 permissions, the workspace copies 28 and 8 — the single missing entry in each.
--
-- Safe to force rather than merge-if-absent-and-untouched, and only because `report:view` is
-- NEW: it did not exist before Phase 6, so no workspace can have deliberately revoked it.
-- Adding it back cannot be undoing anyone's decision. A permission that already shipped would
-- need the opposite treatment.
--
-- `jsonb_insert` is not used: it appends unconditionally and would duplicate the code on a
-- re-run. The `NOT @>` guard makes this idempotent, which the migration runner requires.
-- No `updated_at` is set: `access.system_roles` has `created_at` only.
UPDATE access.system_roles
SET permissions = permissions || '["report:view"]'::jsonb
WHERE slug IN ('project_admin', 'project_member')
  AND workspace_id IS NOT NULL
  AND NOT (permissions @> '["report:view"]'::jsonb);
