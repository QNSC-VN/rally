-- 0121 — remove custom roles and their assignments (ruling 2026-08-14, AC-11).
--
-- Step 3 of three. Step 1 removed the editing ROUTES and the dead UI; step 2 is
-- `pnpm db:report:custom-roles`, which reports what is held and writes nothing. This is the data step,
-- authorised after that report showed only e2e debris on the databases that exist today (there is no
-- production environment yet, and develop carries dev data only).
--
-- AC-11: "Permission Model is read-only and no editable E/R/D/H role matrix remains", restated in prose
-- as "Workspace Admin does not customize a role/action matrix in this MVP". `db/permissions.catalog.ts`
-- is the single source of truth; a custom role forks it. And custom-role CRUD plus WORKSPACE-scoped
-- tier-role assignment together re-create exactly the company-wide over-grant migration 0111 removed.
--
-- THE PREDICATE IS THE SLUG, NEVER `is_system`
-- `db/seeds/bootstrap.ts` writes `is_system = false` for the workspace-owned EDITABLE COPIES of the
-- tier roles, so on any seeded database `project_admin` (31 permissions) and `project_member` (8) carry
-- `false` beside a genuine custom role. Keyed on that flag this migration would delete the two roles the
-- whole access model depends on. Keyed on the slug it cannot: `workspace_admin`, `project_admin` and
-- `project_member` are the catalogue's own `SYSTEM_ROLE` values.
--
-- NOTHING CASCADES — verified against `pg_constraint`: `access.user_role_assignments.role_id`,
-- `workspace.workspace_members.role_id` and `workspace.workspace_invitations.role_id` are NOT foreign
-- keys. So every reference has to be cleared here, in order, or the delete leaves rows pointing at an id
-- that no longer exists. That is not a privilege leak (the resolver INNER JOINs `system_roles`, so an
-- orphan resolves to nothing and fails closed) but it is invisible debris, and one of the three is worse
-- than debris — see the invitation step below.

-- 1. A PENDING invitation naming a custom role is the one case that could hurt a real person.
--    With no foreign key, acceptance would happily write an assignment for a role that no longer
--    exists; the resolver then drops it and the invitee lands with NO access, silently. Repoint those
--    invitations at the workspace's own `project_member` tier role — the least grant that keeps the
--    invitation meaningful — rather than nulling it, because `acceptInvitation` treats a null role as
--    "workspace baseline only". Accepted and revoked invitations are history and are left untouched.
UPDATE "workspace"."workspace_invitations" i
   SET "role_id" = (
         SELECT t."id"
           FROM "access"."system_roles" t
          WHERE t."slug" = 'project_member'
            AND t."workspace_id" = i."workspace_id"
          LIMIT 1
       )
 WHERE i."status" = 'pending'
   AND i."role_id" IN (
         SELECT "id" FROM "access"."system_roles"
          WHERE "slug" NOT IN ('workspace_admin', 'project_admin', 'project_member')
       );--> statement-breakpoint

-- 2. `workspace_members.role_id` is denormalised and authoritative for NOTHING — `AccessService`
--    resolves from `user_role_assignments`, and nothing in the codebase even joins this column. Cleared
--    rather than repointed for exactly that reason: inventing a tier here would put a value nobody reads
--    into a column that has already misled once.
UPDATE "workspace"."workspace_members"
   SET "role_id" = NULL
 WHERE "role_id" IN (
         SELECT "id" FROM "access"."system_roles"
          WHERE "slug" NOT IN ('workspace_admin', 'project_admin', 'project_member')
       );--> statement-breakpoint

-- 3. The assignments themselves. Deleted, not converted: a custom role's permission set exists nowhere
--    in the catalogue, so there is no honest per-project equivalent to map it onto — which is precisely
--    why step 2 reports the holders instead of guessing. On the databases that exist today every holder
--    is e2e debris. A real holder would have been converted BY HAND before this ran, per the report.
DELETE FROM "access"."user_role_assignments"
 WHERE "role_id" IN (
         SELECT "id" FROM "access"."system_roles"
          WHERE "slug" NOT IN ('workspace_admin', 'project_admin', 'project_member')
       );--> statement-breakpoint

-- 4. And the roles. `is_system` is deliberately absent from this predicate.
DELETE FROM "access"."system_roles"
 WHERE "slug" NOT IN ('workspace_admin', 'project_admin', 'project_member');--> statement-breakpoint

-- 5. Any assignment left pointing at a role that does not exist AT ALL.
--    Not hypothetical: applying steps 1-4 on the development database still left three, because a role
--    row had been deleted earlier without its assignments — which is exactly what the missing foreign
--    key permits. An orphan grants nothing (the resolver INNER JOINs `system_roles`, so it fails closed),
--    so this removes debris rather than access, and it makes the invariant "every assignment resolves to
--    a role" true instead of merely usually true. Idempotent by construction.
DELETE FROM "access"."user_role_assignments" a
 WHERE NOT EXISTS (SELECT 1 FROM "access"."system_roles" r WHERE r."id" = a."role_id");
