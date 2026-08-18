-- ============================================================================
-- RETEST-2026-08-18 — the handoff table: what was seeded, and where to click
-- ============================================================================
-- A single read-only SELECT. Run it after seed.sql and paste the output into the
-- BA handoff note; every `path` is a real SPA route, so a URL is
-- <web origin> + path.
--
--   psql "$DEVELOP_URL" -f db/seeds/retest/mapping.sql
--   psql "$DEVELOP_URL" --csv -f db/seeds/retest/mapping.sql > retest-handoff.csv
--
-- It reads the DATABASE rather than repeating the ids from seed.sql, so an empty
-- result means the fixture is not there — and a row appearing here is proof the
-- row exists, not a restatement of the intent. `id` is NULL only for a static
-- surface, which has no row of its own.
-- ============================================================================

WITH retest_projects(id) AS (
  VALUES ('00000000-0000-7000-8000-00000000f001'::uuid),
         ('00000000-0000-7000-8000-00000000f002'::uuid)
),
retest_teams(id) AS (
  VALUES ('00000000-0000-7000-8000-00000000f020'::uuid),
         ('00000000-0000-7000-8000-00000000f021'::uuid)
),
mapping(sort, seed_key, kind, id, path) AS (
  -- Group A: the two projects and their teams.
  SELECT 10, p.key, 'project', p.id::text, '/projects/' || p.key
    FROM work.projects p
   WHERE p.id IN (SELECT id FROM retest_projects)

  UNION ALL
  SELECT 20, t.key, 'team', t.id::text, '/team-status'
    FROM work.teams t
   WHERE t.id IN (SELECT id FROM retest_teams)

  -- Group A: who holds what. The Workspace Admin and the unassigned account
  -- hold NO project_members row by design (§2.1/AC-8, and No Access is the
  -- ABSENCE of a row), so they cannot appear here — that absence is the fixture.
  UNION ALL
  SELECT 30, u.email, 'account (' || pm.access_level || ' on ' || p.key || ')', u.id::text,
         '/projects/' || p.key
    FROM work.project_members pm
    JOIN work.projects p ON p.id = pm.project_id
    JOIN identity.users u ON u.id = pm.user_id
   WHERE pm.project_id IN (SELECT id FROM retest_projects)
     AND pm.status = 'active'

  -- Group A/C: every seeded Story, by key. `/item/<key>` is the deep link the
  -- RBAC cases are walked with (a 403 must be a stated refusal, not a blank page).
  UNION ALL
  SELECT 40, w.item_key, 'story (' || w.schedule_state || ')', w.id::text, '/item/' || w.item_key
    FROM work.work_items w
   WHERE w.project_id IN (SELECT id FROM retest_projects)
     AND w.deleted_at IS NULL

  -- Group B: the Features. Their Portfolio detail is where a published plan's
  -- Release and planned window land.
  UNION ALL
  SELECT 50, pi.item_key, 'feature', pi.id::text, '/portfolio/' || pi.id
    FROM work.portfolio_items pi
   WHERE pi.project_id IN (SELECT id FROM retest_projects)
     AND pi.archived_at IS NULL

  -- Group B: the three plans, and the three releases they are one-per.
  UNION ALL
  SELECT 60, cp.plan_key, 'capacity plan (' || cp.status || ')', cp.id::text,
         '/capacity-planning/' || cp.id
    FROM work.capacity_plans cp
   WHERE cp.project_id IN (SELECT id FROM retest_projects)

  UNION ALL
  SELECT 70, r.release_key,
         'release (' || coalesce(r.start_date::text, '--') || ' to ' || coalesce(r.release_date::text, '--') || ')',
         r.id::text, '/releases/' || r.id
    FROM work.releases r
   WHERE r.project_id IN (SELECT id FROM retest_projects)

  -- Group C: the timeboxes. There is no per-iteration route — Iteration Status
  -- takes the selected iteration from the surface's own picker.
  UNION ALL
  SELECT 80, i.iteration_key,
         'iteration (' || i.state || ', ' || coalesce(i.start_date::text, '--') || ' to ' || coalesce(i.end_date::text, '--') || ')',
         i.id::text, '/iteration-status'
    FROM work.iterations i
   WHERE i.project_id IN (SELECT id FROM retest_projects)

  -- Group C: the surface the frozen history is read on. Burndown needs the
  -- iteration selected; Velocity needs no selection.
  -- Guarded by the projects' existence so an ABSENT fixture returns zero rows: a
  -- static surface row would otherwise read as "the fixture is there".
  UNION ALL
  SELECT 90, 'RETEST-2026-08-18 Burndown + Velocity', 'surface', NULL, '/reports'
   WHERE EXISTS (SELECT 1 FROM work.projects WHERE id IN (SELECT id FROM retest_projects))
)
SELECT seed_key, kind, id, path
  FROM mapping
 ORDER BY sort, seed_key;
