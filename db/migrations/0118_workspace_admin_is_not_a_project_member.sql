-- A Workspace Admin is not a Project user (AC-8, §2.1, RBE-03).
--
-- "A Workspace Admin is not added as a Project user or Team member" — its authority is the
-- workspace-wide grant, and the catalogue gives `workspace_admin` every project-tier permission
-- explicitly, so a `work.project_members` row adds it nothing. Nothing anti-joined them
-- anywhere: `db/seeds/demo.ts` writes the row and migration 0104 backfilled it to
-- `access_level = 'admin'`, so a WA was listed as a member of every project in the workspace,
-- counted in `memberCount`, and offerable again through Add Existing User.
--
-- The code side of this ships with the same change: `ProjectsService.listProjectMembers` and the
-- `memberCount` query filter these users out, and `addProjectMember` now REFUSES them
-- (`PROJECT_MEMBER_IS_WORKSPACE_ADMIN`).
--
-- Why the rows are DELETED rather than left hidden by the query. A `project_members` row is what
-- `AccessService.effectiveAssignments` synthesizes a project-scoped grant from. While the user
-- is a Workspace Admin the row is redundant, so hiding it would be harmless — but the moment
-- their workspace-scoped assignment is revoked, the leftover row keeps granting per-project
-- `admin`, and after the query filter above there is nothing on any screen that would say so.
-- A hidden row that still grants is exactly the state this repo has been bitten by before; a
-- row that grants nothing is fine to hide, and this one does not stay that way.
--
-- DELETE and not `status = 'removed'`: that status asserts an administrator removed a member who
-- had been one, which never happened and has no `project.member.removed` event behind it. The
-- audit trail for real grants lives in `audit.audit_logs`, not in this row. Deleting also leaves
-- a clean slate if the user is later demoted and legitimately granted project access.
--
-- Only the `project_members` half is done here. §2.1 says the same about Team membership, but
-- `work.team_members` is the teams module's table and its write path is not being changed in
-- this migration — removing the rows without the rule that stops them coming back would be a
-- cleanup that undoes itself on the next seed. Tracked, not silently half-fixed.
--
-- The `workspace_members.status = 'active'` join is not incidental — it is the same predicate
-- `selectWorkspaceAdminUserIds` and `IWorkspaceMemberRepository.isActiveAdmin` use. A SUSPENDED
-- member is not a Workspace Admin: `effectiveAssignments` gates project synthesis on active
-- workspace membership, so their row grants nothing today, and the query filter above does not
-- hide it. Visible and inert is a correct state; deleting it here would make the migration and
-- the code disagree about who counts as an admin.
DELETE FROM work.project_members pm
WHERE EXISTS (
  SELECT 1
  FROM access.user_role_assignments ura
  JOIN access.system_roles sr ON sr.id = ura.role_id
  JOIN workspace.workspace_members wm
    ON wm.workspace_id = ura.workspace_id
   AND wm.user_id = ura.user_id
   AND wm.status = 'active'
  WHERE ura.user_id = pm.user_id
    AND ura.workspace_id = pm.workspace_id
    AND ura.scope_type = 'workspace'
    AND sr.slug = 'workspace_admin'
);
