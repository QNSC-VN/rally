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
 */
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { DrizzleDB } from '@platform';
import { IterationDrizzleRepository } from './iteration.drizzle-repository';

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

      await repo.listAssignmentOptions('proj-1', 'ws-1');

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

      await repo.listAssignmentOptions('proj-1', 'ws-1', 'team-1');

      const where = whereClause(captured[0].sql);
      expect(where).toContain('"team_id" is null');
      expect(where).toContain('"team_id" = $3');
      expect(captured[0].params).toEqual(['proj-1', 'ws-1', 'team-1']);
      // Still scope-only: adding the team must not have brought a state predicate back.
      expect(where).not.toContain('"state"');
    });

    it('omits the team predicate entirely when no team is asked for', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listAssignmentOptions('proj-1', 'ws-1');

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

      await repo.listReferences('proj-1', 'ws-1', 'team-1');

      const where = whereClause(captured[0].sql);
      expect(where).toContain('"project_id" = $1');
      expect(where).toContain('"workspace_id" = $2');
      expect(where).toContain('"team_id" is null');
      expect(where).toContain('"team_id" = $3');
      expect(where).not.toContain('"state"');
    });

    it('asks for the same ROWS as the eligibility feed', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listAssignmentOptions('proj-1', 'ws-1', 'team-1');
      await repo.listReferences('proj-1', 'ws-1', 'team-1');

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
});
