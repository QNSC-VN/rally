/**
 * The exact WHERE clauses of the two compact iteration feeds — the ones the Iteration pickers read.
 *
 * P6-VEL-004 (BA retest 2026-08-17) was one condition on one of them. `listAssignmentOptions` carried
 * `state IN ('planning','committed')`, so a CLOSED (accepted) sprint was absent from every assignment
 * picker — while the WRITE path accepted it, because `assertIterationAssignable` reads an iteration's
 * `project_id` and `team_id` and nothing else. The consequence was a one-way move: US-2 could leave the
 * finished `P56-AUDIT Carryover Sprint` (and Velocity's Not Accepted correctly fell 8 → 3, since points
 * are attributed by an item's CURRENT iteration — Phase 6/03_Velocity_Chart/SRS.md §4) and could never
 * be put back, because the selector no longer offered the sprint it came from.
 *
 * A PREDICATE spec, not a repository spec — hence the `.predicates.` name, following
 * `portfolio-item.drizzle-repository.predicates.spec.ts`. It asserts the SQL these methods BUILD, using
 * drizzle's proxy driver so no database is involved: the fault is a condition present or absent, which
 * is visible in the rendered statement and invisible to any test that goes through the mocked
 * repository PORT — the service spec's `listAssignmentOptions` mock returns whatever it is told to.
 *
 * The properties pinned here:
 *   1. eligibility filters on SCOPE ONLY — project, workspace, and team-or-shared — never on state;
 *   2. so does reference, and the two therefore agree on POPULATION (they differ in projection);
 *   3. the team predicate is `team_id IS NULL OR team_id = ?`, so a team-scoped picker still offers
 *      the project's SHARED timeboxes. SQL equality never matches NULL and most iterations name no
 *      team, so a strict `= ?` empties the picker instead of narrowing it.
 *   4. an EDITOR's own scope narrows both feeds the same way (BA ruling 2026-08-17, which names
 *      pickers), and a shared timebox survives that narrowing — the property that must NOT be
 *      "aligned" with the work-row rule, where a null team is the admin-only Project Backlog.
 */
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { DrizzleDB } from '@platform';
import { IterationDrizzleRepository } from './iteration.drizzle-repository';
import type { TeamReadScope } from '../../domain/team-read-scope';

/** A Workspace Admin or per-project `admin`: All Teams AND the Project Backlog, so no predicate. */
const ALL_TEAMS: TeamReadScope = { unrestricted: true };
/** An `editor` restricted to their own active Teams in this project. */
const editorScope = (...teamIds: string[]): TeamReadScope => ({ unrestricted: false, teamIds });

interface Captured {
  sql: string;
  params: unknown[];
}

/** A repository over a driver that records instead of executing. */
function recordingRepo(): { repo: IterationDrizzleRepository; captured: Captured[] } {
  const captured: Captured[] = [];
  const db = drizzle(async (sql, params) => {
    captured.push({ sql, params });
    return { rows: [] };
  });
  return { repo: new IterationDrizzleRepository(db as unknown as DrizzleDB), captured };
}

/**
 * Just the WHERE clause. The select list also names `state`, so "does this query filter by state"
 * cannot be answered by searching the whole statement.
 */
function whereClause(sql: string): string {
  const match = /\swhere\s(.*?)(?:\sorder by\s|\sgroup by\s|\slimit\s|$)/.exec(sql);
  if (!match) throw new Error(`No WHERE clause in: ${sql}`);
  return match[1];
}

describe('IterationDrizzleRepository — the compact feed predicates', () => {
  describe('listAssignmentOptions (the ELIGIBILITY feed behind every Iteration selector)', () => {
    it('filters on project and tenancy — and NOT on state', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listAssignmentOptions('proj-1', 'ws-1', undefined, ALL_TEAMS);

      expect(captured).toHaveLength(1);
      const where = whereClause(captured[0].sql);

      expect(where).toContain('"project_id" = $1');
      expect(where).toContain('"workspace_id" = $2');
      expect(captured[0].params).toEqual(['proj-1', 'ws-1']);

      // THE P6-VEL-004 ASSERTION. A state predicate here withholds a CLOSED sprint from the picker
      // while the API still accepts it, which makes Velocity's current-assignment rule one-way.
      expect(
        where,
        'the eligibility feed must not filter by iteration state: an accepted (closed) iteration is a ' +
          'legal assignment target, and excluding it made the move-IN direction of P6-VEL-004 ' +
          'unreachable through the UI',
      ).not.toContain('"state"');
      expect(where).not.toMatch(/planning|committed|accepted/);
    });

    it('offers a team its OWN timeboxes plus the project SHARED ones', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listAssignmentOptions('proj-1', 'ws-1', 'team-1', ALL_TEAMS);

      const where = whereClause(captured[0].sql);
      expect(where).toContain('"team_id" is null');
      expect(where).toContain('"team_id" = $3');
      expect(captured[0].params).toEqual(['proj-1', 'ws-1', 'team-1']);
      // Still scope-only: adding the team must not have brought a state predicate back.
      expect(where).not.toContain('"state"');
    });

    it('omits the team predicate entirely when no team is asked for', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listAssignmentOptions('proj-1', 'ws-1', undefined, ALL_TEAMS);

      expect(whereClause(captured[0].sql)).not.toContain('"team_id"');
    });
  });

  /**
   * The reference feed is unchanged, and it is asserted here so the pair can be compared: after
   * P6-VEL-004 these two answer the same question about MEMBERSHIP and differ only in what they
   * SELECT (`/options` also returns `team_id`, which `iterationsInScope` needs). If one ever gains a
   * row predicate the other lacks, the picker and its labels start disagreeing again — which is the
   * defect RELATION_DATA_TRACEABILITY.md recorded in the other direction.
   */
  describe('listReferences (the REFERENCE feed behind filters and id→name labels)', () => {
    it('filters on scope only, exactly like the eligibility feed', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listReferences('proj-1', 'ws-1', 'team-1', ALL_TEAMS);

      const where = whereClause(captured[0].sql);
      expect(where).toContain('"project_id" = $1');
      expect(where).toContain('"workspace_id" = $2');
      expect(where).toContain('"team_id" is null');
      expect(where).toContain('"team_id" = $3');
      expect(where).not.toContain('"state"');
    });

    it('asks for the same ROWS as the eligibility feed', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listAssignmentOptions('proj-1', 'ws-1', 'team-1', ALL_TEAMS);
      await repo.listReferences('proj-1', 'ws-1', 'team-1', ALL_TEAMS);

      const [eligibility, reference] = captured;
      expect(whereClause(reference.sql)).toBe(whereClause(eligibility.sql));
      expect(reference.params).toEqual(eligibility.params);
      // ...while the PROJECTIONS stay different: only the reference feed carries the team.
      expect(reference.sql).toContain('"team_id"');
      expect(eligibility.sql.slice(0, eligibility.sql.indexOf(' from '))).not.toContain(
        '"team_id"',
      );
    });
  });

  /**
   * THE EDITOR'S TEAM SCOPE (BA ruling 2026-08-17, read half). A picker is one of the surfaces the
   * ruling names, and these two feeds are the ones behind every Iteration selector, filter and label.
   *
   * The distinction being pinned is the one that is easy to "fix" in the wrong direction: here a
   * `team_id IS NULL` row is a SHARED timebox and must survive, while the same NULL on a WORK row is
   * the Project Backlog and must not (see `iteration-status.drizzle-repository.predicates.spec.ts`).
   * Two predicates over the same column name, opposite treatments of NULL, and only a test says so.
   */
  describe('an EDITOR scope narrows both feeds — and a SHARED timebox survives it', () => {
    it('emits `team_id IS NULL OR team_id IN (…)`, so shared sprints stay selectable', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listAssignmentOptions(
        'proj-1',
        'ws-1',
        undefined,
        editorScope('team-a', 'team-b'),
      );

      const where = whereClause(captured[0].sql);
      expect(where).toContain('"team_id" is null');
      expect(where).toContain('"team_id" in ($3, $4)');
      expect(captured[0].params).toEqual(['proj-1', 'ws-1', 'team-a', 'team-b']);
      // Never a state predicate, even now (P6-VEL-004 is orthogonal to team scope).
      expect(where).not.toContain('"state"');
    });

    it('narrows the REFERENCE feed identically, so labels and the picker cannot disagree', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listAssignmentOptions('proj-1', 'ws-1', undefined, editorScope('team-a'));
      await repo.listReferences('proj-1', 'ws-1', undefined, editorScope('team-a'));

      const [eligibility, reference] = captured;
      expect(whereClause(reference.sql)).toBe(whereClause(eligibility.sql));
      expect(reference.params).toEqual(eligibility.params);
    });

    it('leaves ONLY the shared timeboxes for an editor with no team — never `IN ()`', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listReferences('proj-1', 'ws-1', undefined, editorScope());

      const where = whereClause(captured[0].sql);
      expect(where).toContain('"team_id" is null');
      // `inArray(col, [])` is not portable as "match nothing", so the empty scope must never render one.
      expect(where).not.toMatch(/in \(\)/);
      expect(captured[0].params).toEqual(['proj-1', 'ws-1']);
    });

    it('emits NO team predicate at all for an unrestricted caller', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listReferences('proj-1', 'ws-1', undefined, ALL_TEAMS);

      // Not a tautology, not `IS NULL OR IN (...)` over every team: literally absent.
      expect(whereClause(captured[0].sql)).not.toContain('"team_id"');
    });

    it('combines an explicitly requested team WITH the caller scope', async () => {
      const { repo, captured } = recordingRepo();

      // The service asserts the requested team is one of the caller's before reaching here
      // (`resolveTimeboxScope` → `assertTeamInScope`), so this is belt-and-braces rather than the
      // boundary: the requested-team predicate must not REPLACE the scope predicate.
      await repo.listAssignmentOptions('proj-1', 'ws-1', 'team-a', editorScope('team-a'));

      const where = whereClause(captured[0].sql);
      expect(where).toContain('"team_id" = $3');
      expect(where).toContain('"team_id" in ($4)');
      expect(captured[0].params).toEqual(['proj-1', 'ws-1', 'team-a', 'team-a']);
    });
  });
});
