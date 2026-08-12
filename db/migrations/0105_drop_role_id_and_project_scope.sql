-- Phase 10 (contract) of the RBAC migration. See
-- docs/superpowers/plans/rbac-migration.md.
--
-- Removes the safety net:
-- 1. DROP project_members.role_id — access is now solely access_level.
-- 2. DELETE scope_type='project' rows from user_role_assignments — the
--    engine no longer resolves project-tier permissions from role assignments.
--
-- Per-workspace PROJECT_ADMIN / PROJECT_MEMBER rows in system_roles are left
-- in place: the TS catalogue still derives ACCESS_LEVEL_PERMISSIONS from
-- ROLE_PERMISSIONS[PROJECT_ADMIN/PROJECT_MEMBER], and the bootstrap seed
-- recreates them. Removing them is a separate step that must update the
-- catalogue derivation + the seed — deferred.

-- 1. Drop role_id from project_members (access_level is the sole source).
ALTER TABLE work.project_members DROP COLUMN IF EXISTS role_id;

-- 2. Delete project-scoped role assignments (the old engine path's data).
DELETE FROM access.user_role_assignments WHERE scope_type = 'project';
