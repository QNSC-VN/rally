-- ============================================================================
-- Migration 0027: Rename `tenancy` schema to `workspace`
-- ============================================================================
-- Cosmetic/structural cleanup after the multi-tenancy drop (0025/0026). The
-- schema physically held workspace tables (workspaces, workspace_members,
-- workspace_invitations, workspace_settings) but kept the legacy `tenancy`
-- name. Rename it so the physical schema matches the domain.
--
-- ALTER SCHEMA ... RENAME moves every contained object (tables, indexes,
-- sequences) and Postgres automatically updates dependent references (foreign
-- keys, views), so no per-object DDL is required.
--
-- Historical migrations 0000-0026 still reference `tenancy` by name — they are
-- immutable and only ever run against a fresh DB in order, so the schema exists
-- under the old name at the point each of them executes, and this migration
-- renames it afterwards.
-- ============================================================================

ALTER SCHEMA "tenancy" RENAME TO "workspace";
