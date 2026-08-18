-- ============================================================================
-- RETEST-2026-08-18 — remove the retest fixture
-- ============================================================================
-- Companion to db/seeds/retest/seed.sql. Hand-run, develop only, not a
-- migration and not part of `seed()` / `SEED_ON_DEPLOY`.
--
-- IT NEVER TRUNCATES. Every statement is scoped to ids this fixture owns — the
-- two retest projects (00000000-…-f001 / f002) and the two retest teams
-- (…f020 / f021) — so it cannot reach the demo fixtures, a real project, or
-- anything in `access.*` / `workspace.*` / `identity.*`. Compare
-- `resetFixtureTables` in db/seeds/reset.ts, which TRUNCATEs and is wired only
-- into `pnpm db:seed:test`: that is the tool for a local database, and this is
-- the tool for a shared one.
--
-- The scope is "everything in the retest projects", not only the ids seed.sql
-- wrote, because the BA's own retest ACTIONS create rows there too — comments,
-- attachments, time logs, tasks, activity entries, a milestone. Those ids are
-- unknown in advance, and leaving them behind would leave a project's worth of
-- debris pointing at deleted parents. Nothing outside the two retest projects
-- can match any predicate below.
--
-- RUN: psql "$DEVELOP_URL" -v ON_ERROR_STOP=1 -f db/seeds/retest/reset.sql
-- ============================================================================

BEGIN;

-- ── 1. RE-ARM GROUP B (safe to run on its own) ──────────────────────────────
-- Publishing a plan writes `status`/`published_at`/`published_by` on the plan
-- and `release_id`/`planned_start_date`/`planned_end_date` on every assigned
-- Feature, and Unpublish does NOT roll the Feature fields back — that is the
-- publish contract, not a defect. These two statements put the P5-CP-035 case
-- back to its seeded shape so it can be walked again.
--
-- They are idempotent and are also exactly what `seed.sql` re-applies through
-- its ON CONFLICT DO UPDATE clauses, so "reset then seed" and "seed again" reach
-- the same state. They stand here as well so a human who only wants Group B
-- re-armed can run this section and stop, without deleting anything.
UPDATE work.capacity_plans
   SET status = 'draft', published_at = NULL, published_by = NULL, updated_at = now()
 WHERE id IN ('00000000-0000-7000-8000-00000000f050',
              '00000000-0000-7000-8000-00000000f051',
              '00000000-0000-7000-8000-00000000f052')
   AND (status <> 'draft' OR published_at IS NOT NULL OR published_by IS NOT NULL);

UPDATE work.portfolio_items
   SET release_id = NULL, planned_start_date = NULL, planned_end_date = NULL, updated_at = now()
 WHERE id IN ('00000000-0000-7000-8000-00000000f040',
              '00000000-0000-7000-8000-00000000f041',
              '00000000-0000-7000-8000-00000000f042',
              '00000000-0000-7000-8000-00000000f043')
   AND (release_id IS NOT NULL OR planned_start_date IS NOT NULL OR planned_end_date IS NOT NULL);

-- ── 2. TEARDOWN, in FK-safe order ───────────────────────────────────────────
-- Children before parents throughout. Three FKs in this graph are RESTRICT and
-- would otherwise stop the delete: capacity_plans → projects, capacity_plans →
-- releases, and capacity_plan_teams/allocations → teams. Everything else is
-- CASCADE or SET NULL, but the deletes are still explicit: relying on a cascade
-- would leave the order silently load-bearing.

-- 2a. Work-item sub-resources (no FK to work_items, so they would ORPHAN).
DELETE FROM work.comments
 WHERE entity_id IN (SELECT id FROM work.work_items
                      WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                           '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.attachments
 WHERE entity_id IN (SELECT id FROM work.work_items
                      WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                           '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.time_logs
 WHERE work_item_id IN (SELECT id FROM work.work_items
                         WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                              '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.work_item_labels
 WHERE work_item_id IN (SELECT id FROM work.work_items
                         WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                              '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.work_item_watchers
 WHERE work_item_id IN (SELECT id FROM work.work_items
                         WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                              '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.work_item_relations
 WHERE source_item_id IN (SELECT id FROM work.work_items
                           WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                                '00000000-0000-7000-8000-00000000f002'))
    OR target_item_id IN (SELECT id FROM work.work_items
                           WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                                '00000000-0000-7000-8000-00000000f002'));

-- 2b. Tasks. A Task lives in `work.tasks`, not `work_items` (the Phase 3 split),
--     and its FK to its parent cascades — but a soft delete never fires a
--     cascade, and the BA may have created tasks here.
DELETE FROM work.tasks
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');

-- 2c. Activity + milestones.
DELETE FROM work.activity_logs
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM work.milestone_artifacts
 WHERE milestone_id IN (SELECT id FROM work.milestones
                         WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                              '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.milestone_releases
 WHERE milestone_id IN (SELECT id FROM work.milestones
                         WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                              '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.milestone_teams
 WHERE milestone_id IN (SELECT id FROM work.milestones
                         WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                              '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.milestone_projects
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM work.milestones
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');

-- 2d. Capacity plans (RESTRICT to both projects and releases, so first).
DELETE FROM work.capacity_plan_allocations
 WHERE plan_id IN (SELECT id FROM work.capacity_plans
                    WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                         '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.capacity_plan_teams
 WHERE plan_id IN (SELECT id FROM work.capacity_plans
                    WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                         '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.capacity_plans
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');

-- 2e. Report history. `iteration_daily_snapshots` and `iteration_team_baselines`
--     cascade from their iteration (migrations 0093/0098 gave them FKs, which
--     they had none of before), and are deleted explicitly for the same reason
--     as everything else here.
DELETE FROM work.iteration_daily_snapshots
 WHERE iteration_id IN (SELECT id FROM work.iterations
                         WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                              '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.iteration_team_baselines
 WHERE iteration_id IN (SELECT id FROM work.iterations
                         WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                              '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.release_daily_snapshots
 WHERE release_id IN (SELECT id FROM work.releases
                       WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                            '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.release_team_targets
 WHERE release_id IN (SELECT id FROM work.releases
                       WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                                            '00000000-0000-7000-8000-00000000f002'));
DELETE FROM work.member_capacity
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');

-- 2f. The delivery rows themselves. Work items before portfolio items (a child
--     names its Feature), and both before iterations and releases.
DELETE FROM work.work_items
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM work.portfolio_items
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM work.iterations
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM work.releases
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');

-- 2g. Project configuration and access.
DELETE FROM work.labels
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM work.workflow_transitions
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM work.workflow_statuses
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM work.project_members
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM work.project_teams
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
-- Written by `trg_project_settings_default` when the project row was inserted,
-- so it exists even though seed.sql never mentions it.
DELETE FROM work.project_settings
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');
DELETE FROM workspace.workspace_invitation_project_access
 WHERE project_id IN ('00000000-0000-7000-8000-00000000f001',
                      '00000000-0000-7000-8000-00000000f002');

-- 2h. Teams. Their roster first. If either team was meanwhile added to a plan in
--     ANOTHER project, `fk_capacity_plan_teams_team` (RESTRICT) will refuse the
--     delete and the whole transaction rolls back — deliberately: removing that
--     row would silently re-park a real plan's demand.
DELETE FROM work.team_members
 WHERE team_id IN ('00000000-0000-7000-8000-00000000f020',
                   '00000000-0000-7000-8000-00000000f021');
DELETE FROM work.project_teams
 WHERE team_id IN ('00000000-0000-7000-8000-00000000f020',
                   '00000000-0000-7000-8000-00000000f021');
DELETE FROM work.milestone_teams
 WHERE team_id IN ('00000000-0000-7000-8000-00000000f020',
                   '00000000-0000-7000-8000-00000000f021');
DELETE FROM work.teams
 WHERE id IN ('00000000-0000-7000-8000-00000000f020',
              '00000000-0000-7000-8000-00000000f021');

-- 2i. The projects.
DELETE FROM work.projects
 WHERE id IN ('00000000-0000-7000-8000-00000000f001',
              '00000000-0000-7000-8000-00000000f002');

-- ── 3. WHAT IS DELIBERATELY LEFT ────────────────────────────────────────────
-- • `identity.users` rows for the four accounts. SQL did not create them (an
--   Entra SSO login did) and deleting a person because a fixture is finished
--   would be wrong. They keep whatever workspace-tier role they were given;
--   their per-PROJECT access disappeared with `project_members` above.
-- • `workspace_item_counters`. seed.sql only ever raised those rows to
--   GREATEST(existing, 0), so it changed nothing to undo, and lowering a
--   counter would make the app re-mint keys that already exist.
-- • Notifications generated by the BA's actions. They carry no project_id and
--   reference items through their payload, so they cannot be scoped safely
--   here; they render as an unresolvable link, which is what a notification for
--   a deleted item does anyway.

-- Should print 0 for every column.
SELECT
  (SELECT count(*) FROM work.projects        WHERE id IN ('00000000-0000-7000-8000-00000000f001','00000000-0000-7000-8000-00000000f002')) AS projects_left,
  (SELECT count(*) FROM work.teams           WHERE id IN ('00000000-0000-7000-8000-00000000f020','00000000-0000-7000-8000-00000000f021')) AS teams_left,
  (SELECT count(*) FROM work.work_items      WHERE item_key LIKE 'US-SEED-%')                                                             AS work_items_left,
  (SELECT count(*) FROM work.portfolio_items WHERE item_key LIKE 'FE-SEED-%')                                                            AS features_left,
  (SELECT count(*) FROM work.capacity_plans  WHERE plan_key LIKE 'CP-SEED-%')                                                            AS plans_left,
  (SELECT count(*) FROM work.iterations      WHERE iteration_key LIKE 'IT-SEED-%')                                                       AS iterations_left,
  (SELECT count(*) FROM work.releases        WHERE release_key LIKE 'RE-SEED-%')                                                         AS releases_left;

COMMIT;
