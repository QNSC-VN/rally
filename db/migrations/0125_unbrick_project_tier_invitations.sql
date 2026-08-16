-- Repair invitations that migration 0121 made permanently unacceptable.
--
-- 0121 deleted the custom roles and, for any PENDING invitation naming one, repointed `role_id` at the
-- workspace's own `project_member` tier role. Its comment calls that "the least grant that keeps the
-- invitation meaningful" and explicitly prefers it to NULL. That reasoning is wrong, and the code it
-- reasoned about is what makes it wrong: `WorkspaceService.acceptInvitation` REFUSES a project-tier
-- invited role with `INVITED_ROLE_IS_PROJECT_TIER`, because a workspace-scoped grant of a per-project
-- role is the company-wide over-grant migration 0111 exists to remove.
--
-- So the repoint did not reduce the grant, it removed the invitation's only exit. The refusal is thrown
-- INSIDE the accept transaction, after `addMember`, so the whole thing rolls back: the row stays
-- `pending`, no membership is written, and every retry fails identically. `Resend Invitation` cannot
-- help either — it rotates the token on the same row and leaves `role_id` untouched.
--
-- Ordering confirms this was reachable and not theoretical: the refusal shipped in #424 (2026-08-14)
-- and 0121 in #429 (2026-08-15), so the refusal is an ancestor of the migration that collides with it.
--
-- NULL is the correct value, and it is what the BA describes. `Phase 4/02_Roles_Permissions/SRS.md:25`
-- retires the `Project Admin` / `Project Member` labels outright, and AC-5 makes "no assignment" the
-- landing state for someone who has not been granted a level. `acceptInvitation` reads NULL as
-- "workspace baseline only" and skips `grantWorkspaceRole` entirely, so the invitee becomes a member
-- with no workspace-wide role — which is exactly right. Their per-project access comes from the
-- invitation's own `workspace_invitation_project_access` rows (§6.4), which this does not touch.
--
-- SCOPE: every pending invitation whose `role_id` names a project-tier role, not only the ones 0121
-- wrote. Origin cannot be distinguished after the fact, and it does not matter — any such row is
-- unacceptable by the same refusal, whether a migration or an API caller put it there. `accepted`,
-- `cancelled` and `expired` rows are history and are left alone, as 0121 also chose.
--
-- There is deliberately NO foreign key on `workspace_invitations.role_id` (asserted against
-- `pg_constraint` in 0121), so this is a plain UPDATE with no cascade to consider.
UPDATE "workspace"."workspace_invitations" i
   SET "role_id" = NULL,
       "updated_at" = now()
 WHERE i."status" = 'pending'
   AND i."role_id" IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM "access"."system_roles" r
          WHERE r."id" = i."role_id"
            AND r."slug" IN ('project_admin', 'project_member')
       );
