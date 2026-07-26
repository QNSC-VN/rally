-- Phase 4.2 RBAC reduction: the catalogue now ships exactly three canonical
-- roles (workspace_admin, project_admin, project_member). Drop the roles removed
-- from the model — project_viewer, workspace_member, and the persona presets
-- (scrum_master, product_owner, developer, qa_engineer).
--
-- Assignments to a removed role are deleted (deny-by-default: a workspace admin
-- re-grants a surviving role). The surviving roles' permission sets are
-- re-synced by the seed (seedSystemRoles + tenant bootstrap upsert) that runs
-- immediately after migrate, so no permission arrays are hand-written here.
DELETE FROM "access"."user_role_assignments"
WHERE "role_id" IN (
  SELECT "id" FROM "access"."system_roles"
  WHERE "slug" IN (
    'project_viewer', 'workspace_member',
    'scrum_master', 'product_owner', 'developer', 'qa_engineer'
  )
);--> statement-breakpoint
DELETE FROM "access"."system_roles"
WHERE "slug" IN (
  'project_viewer', 'workspace_member',
  'scrum_master', 'product_owner', 'developer', 'qa_engineer'
);
