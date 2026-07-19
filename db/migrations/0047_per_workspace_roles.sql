-- 0047: Per-workspace editable role copies (Option B — every tier role is
-- editable per workspace EXCEPT Workspace Admin, which stays the locked anchor).
--
-- Previously the five tier roles were GLOBAL singletons (workspace_id IS NULL,
-- unique on slug alone), so a workspace admin could not tune them without
-- rewriting them for every other tenant. We now let each workspace own its own
-- editable COPY of a tier role alongside the global template: uniqueness moves
-- from (slug) to (workspace_id, slug).
--
-- NULLS NOT DISTINCT keeps the global rows (workspace_id IS NULL) themselves
-- deduplicated by slug, so the reference-catalogue upsert (seedSystemRoles)
-- stays idempotent on every deploy.
DROP INDEX IF EXISTS "access"."uq_system_roles_slug";
ALTER TABLE "access"."system_roles"
  ADD CONSTRAINT "uq_system_roles_workspace_slug"
  UNIQUE NULLS NOT DISTINCT ("workspace_id", "slug");
