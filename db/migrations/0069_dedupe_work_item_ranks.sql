-- ============================================================================
-- Migration 0069: give every work item a distinct rank within its scope
-- ============================================================================
-- `rank` is a LexoRank ordering items within one scope — top-level items of a
-- project, or the children of one parent. It is supposed to be unique per scope,
-- and nothing enforced that.
--
-- Until the fix that ships with this migration, `createWorkItem` derived the new
-- rank OUTSIDE the insert transaction and without a lock:
--
--     const maxRank = await repo.findMaxRank(scope, workspaceId);  // pool, no lock
--     const rank = between(maxRank, null);
--     await uow.run(async (tx) => repo.create({ ..., rank }, tx));
--
-- Two creates in the same scope could therefore read the same max and derive the
-- same rank. Rank assignment now happens inside the transaction under
-- `pg_advisory_xact_lock` keyed on the scope, so new collisions cannot occur.
-- This migration repairs the rows already written: 22 scopes in the development
-- database, each a story and a defect created milliseconds apart, both landing
-- on the first rank because neither saw the other's uncommitted insert.
--
-- To be precise about what is NOT a duplicate: the same rank value in two
-- DIFFERENT scopes is correct and expected. A story ranked first among a
-- project's top-level items and its child defect ranked first among that story's
-- children both hold the same string, and nothing here touches them. Only
-- collisions within one (project_id, parent_id) are repaired.
--
-- Why it matters beyond ordering: `between(low, high)` throws
-- "LexoRank neighbours out of order" when low >= high, so dragging an item
-- between two equal-ranked neighbours fails outright. Ordering itself is already
-- deterministic — every ORDER BY now carries an id tiebreaker — but the ties
-- still break drag-reorder, and they make the visible order arbitrary rather
-- than meaningful.
--
-- Repair strategy: keep the existing relative order (rank, then created_at, then
-- id — the same total order the queries now use), and rewrite each affected
-- scope's ranks as evenly spaced, sortable, fixed-width values. Fixed width
-- matters: LexoRank compares as TEXT, so '10' sorts before '9' unless padded.
-- The gap of 100 leaves room for `between()` to insert on drag without needing
-- another rebalance.
--
-- NOTE on the scope predicate: affected scopes are flagged with a window
-- function, NOT `(project_id, parent_id) IN (SELECT ...)`. Top-level items have
-- `parent_id IS NULL`, and a row-constructor IN comparison involving NULL
-- evaluates to NULL rather than TRUE — so the IN form silently matched nothing
-- and left every top-level scope, which is all of them, unrepaired.
--
-- Idempotent: a second run finds no duplicates, so no scope is flagged and
-- nothing is written.
-- ============================================================================

WITH base AS (
  SELECT
    id,
    project_id,
    parent_id,
    rank,
    created_at,
    count(*) OVER (PARTITION BY project_id, parent_id, rank) AS rows_at_this_rank
  FROM work.work_items
  WHERE deleted_at IS NULL
),
flagged AS (
  -- Two CTE levels, not one: an aggregate over a window function
  -- (`bool_or(count(*) OVER ...) OVER ...`) is a nested window call, which
  -- Postgres rejects outright.
  SELECT
    id,
    project_id,
    parent_id,
    rank,
    created_at,
    bool_or(rows_at_this_rank > 1) OVER (PARTITION BY project_id, parent_id) AS scope_has_duplicate
  FROM base
),
scoped AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY project_id, parent_id
      ORDER BY rank, created_at, id
    ) AS position
  FROM flagged
  WHERE scope_has_duplicate
)
UPDATE work.work_items wi
SET rank = 'a' || lpad((scoped.position * 100)::text, 6, '0'),
    updated_at = now()
FROM scoped
WHERE wi.id = scoped.id
  -- Skip no-op writes so a re-run touches nothing.
  AND wi.rank IS DISTINCT FROM 'a' || lpad((scoped.position * 100)::text, 6, '0');

-- `tasks` carries its own rank, scoped by parent_id. No collisions exist there
-- today, but the same race applied, so repair it on the same terms.
WITH base AS (
  SELECT
    id,
    parent_id,
    rank,
    created_at,
    count(*) OVER (PARTITION BY parent_id, rank) AS rows_at_this_rank
  FROM work.tasks
  WHERE deleted_at IS NULL
),
flagged AS (
  SELECT
    id,
    parent_id,
    rank,
    created_at,
    bool_or(rows_at_this_rank > 1) OVER (PARTITION BY parent_id) AS scope_has_duplicate
  FROM base
),
scoped AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY parent_id ORDER BY rank, created_at, id) AS position
  FROM flagged
  WHERE scope_has_duplicate
)
UPDATE work.tasks t
SET rank = 'a' || lpad((scoped.position * 100)::text, 6, '0'),
    updated_at = now()
FROM scoped
WHERE t.id = scoped.id
  AND t.rank IS DISTINCT FROM 'a' || lpad((scoped.position * 100)::text, 6, '0');
