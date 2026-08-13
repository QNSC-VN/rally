-- Re-run 0111's DELETE, because 0111's stated premise was wrong.
--
-- 0111 removed WORKSPACE-scoped assignments of the per-Project tier roles and justified forcing
-- it with: "the rows predate the model and nothing legitimate re-creates them (assignRole now
-- refuses scope_type='project', and the invitation path lands No Access)."
--
-- Something did re-create them: `db/seeds/demo.ts` granted `project_member` to DEVELOPER_ID at
-- `scopeType: 'workspace'` on every run. Seeds run AFTER migrations (`db/migrate.ts` calls
-- `seed()` when SEED_ON_DEPLOY is set), so on any database that has been seeded since 0111 the
-- row is back — and `db/seeds/reset.ts` cannot clear it either, because `FIXTURE_TABLES` covers
-- delivery data only and deliberately touches nothing in `access.*`.
--
-- Why this matters more than one fixture user: the row is a workspace-tier grant of the full
-- Editor delivery set, i.e. write access to every project in the workspace including ones the
-- holder has no `project_members` row for. It also made the project-scoped authorization path
-- unreachable in testing, which is how it MASKED the two P0 access defects of 2026-08-14 — the
-- same shape CLAUDE.md records for `report:view`, where a principal holding too much hid a broken
-- gate from every test.
--
-- The seed no longer writes it (see the comment where that block used to be), so this sweep is
-- the last one needed rather than a recurring cleanup. Forced rather than merged for 0111's
-- reason, which is still sound: a per-Project tier role is granted per project through
-- `work.project_members.access_level`, so a workspace-scoped one cannot be a deliberate decision
-- anybody made — there is no UI that produces it and `assignRole` refuses the shape.
--
-- Idempotent: a DELETE that matches nothing is a no-op, so this is safe on a database where 0111
-- was the end of it.
DELETE FROM access.user_role_assignments
WHERE scope_type = 'workspace'
  AND role_id IN (SELECT id FROM access.system_roles WHERE slug IN ('project_admin', 'project_member'));
