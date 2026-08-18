/**
 * The exact WHERE clauses of `Track > Quality` — the defect GRID, its footer "of N" and the six KPI
 * cards — under the BA ruling of 2026-08-17: "Null means Project Backlog, accessible only to
 * Workspace Admin and Project Admin. Editor … cannot access team-less items. Enforce this consistently
 * in API queries, lists, reports, search, pickers and direct URLs." §5's Editor row says the same
 * thing about this surface specifically, and `db/permissions.catalog.ts` quotes it beside
 * `QUALITY_VIEW`: "Quality Defects View = Assigned Teams".
 *
 * A PREDICATE spec (`.predicates.`, following `iteration.drizzle-repository.predicates.spec.ts`),
 * because the fault to guard against is a condition present on one of the THREE queries and absent
 * from another — visible in the rendered SQL, invisible through the mocked repository port. The
 * dangerous one is `computeMetrics`: it deliberately ignores the caller's filters (it counts the
 * project, not the page), so a missing team predicate there shows six correct-looking numbers above a
 * correctly narrowed grid, and nothing on screen contradicts it. CLAUDE.md: "Eligibility must be
 * counted in the SAME scope as the measurement."
 *
 * Note the treatment of NULL: a defect with no team is EXCLUDED (`team_id IN (…)`, never
 * `OR IS NULL`). That is the opposite of a team-less ITERATION, which is a shared timebox and stays
 * visible — see `libs/modules/iterations/.../iteration.drizzle-repository.predicates.spec.ts`. The
 * column name is the same on both; the rule is not.
 */
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { DrizzleDB } from '@platform';
import { QualityDrizzleRepository } from './quality.drizzle-repository';
import type { TeamReadScope } from '../../domain/team-read-scope';

interface Captured {
  sql: string;
  params: unknown[];
}

const ALL_TEAMS: TeamReadScope = { unrestricted: true };
const editorScope = (...teamIds: string[]): TeamReadScope => ({ unrestricted: false, teamIds });

function recordingRepo(): { repo: QualityDrizzleRepository; captured: Captured[] } {
  const captured: Captured[] = [];
  const db = drizzle(async (sql, params) => {
    captured.push({ sql, params });
    return { rows: [] };
  });
  return { repo: new QualityDrizzleRepository(db as unknown as DrizzleDB), captured };
}

/**
 * The WHERE clause only.
 *
 * A predicate is what this file is about, and `team_id` also appears in the SELECT list now that the
 * row carries its team, so matching the whole statement would assert about a projection.
 */
function whereOf(sql: string): string {
  const at = sql.indexOf(' where ');
  return at === -1 ? '' : sql.slice(at);
}

describe('QualityDrizzleRepository — the team-scope predicates', () => {
  describe('listDefects (the grid and its footer total)', () => {
    it('emits no team predicate at all for an unrestricted caller', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listDefects('ws-1', 'proj-1', {}, ALL_TEAMS);

      // Two queries: the page, and the count that feeds "of N".
      expect(captured).toHaveLength(2);
      // Asserted on the WHERE clause, not the whole statement: the SELECT list projects `team_id`
      // legitimately (the grid's bulk `Copy` re-creates a defect and has to carry its team), so a
      // whole-statement match would fail on a column that is not a predicate.
      for (const q of captured) {
        expect(whereOf(q.sql)).not.toContain('team_id');
      }
    });

    it("narrows the page AND the count by the editor's teams", async () => {
      const { repo, captured } = recordingRepo();

      await repo.listDefects('ws-1', 'proj-1', {}, editorScope('team-a', 'team-b'));

      expect(captured).toHaveLength(2);
      for (const q of captured) {
        expect(q.sql).toMatch(/"team_id" in \(\$\d+, \$\d+\)/);
        expect(q.params).toEqual(expect.arrayContaining(['ws-1', 'proj-1', 'team-a', 'team-b']));
      }
    });

    it('excludes a team-less defect — the Project Backlog is admin-only', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listDefects('ws-1', 'proj-1', {}, editorScope('team-a'));

      for (const q of captured) expect(q.sql).not.toContain('"team_id" is null');
    });

    it('issues NO query and returns nothing when the editor holds no team', async () => {
      const { repo, captured } = recordingRepo();

      // Short-circuited rather than filtered: `inArray(col, [])` is not portable as "match nothing",
      // and flattening `[]` into "no filter" hands them the whole project.
      const res = await repo.listDefects('ws-1', 'proj-1', {}, editorScope());

      expect(captured).toEqual([]);
      expect(res).toEqual({ rows: [], total: 0 });
    });

    it('keeps the team predicate alongside the caller-supplied filters', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listDefects(
        'ws-1',
        'proj-1',
        { severity: 'critical', assigneeId: 'user-9' },
        editorScope('team-a'),
      );

      for (const q of captured) {
        expect(q.sql).toMatch(/"team_id" in \(\$\d+\)/);
        expect(q.params).toContain('team-a');
      }
    });
  });

  describe('computeMetrics (the six KPI cards)', () => {
    it('emits no team predicate for an unrestricted caller', async () => {
      const { repo, captured } = recordingRepo();

      await repo.computeMetrics('ws-1', 'proj-1', ALL_TEAMS);

      expect(captured).toHaveLength(1);
      expect(captured[0].sql).not.toContain('"team_id"');
    });

    it("narrows to the editor's teams, so the strip matches the grid", async () => {
      const { repo, captured } = recordingRepo();

      await repo.computeMetrics('ws-1', 'proj-1', editorScope('team-a'));

      expect(captured[0].sql).toMatch(/"team_id" in \(\$\d+\)/);
      expect(captured[0].sql).not.toContain('"team_id" is null');
      expect(captured[0].params).toEqual(expect.arrayContaining(['ws-1', 'proj-1', 'team-a']));
    });

    it('reports six zeros — not the project totals — when the editor holds no team', async () => {
      const { repo, captured } = recordingRepo();

      const metrics = await repo.computeMetrics('ws-1', 'proj-1', editorScope());

      expect(captured).toEqual([]);
      expect(metrics).toEqual({
        openDefects: 0,
        critical: 0,
        inProgress: 0,
        verifiedAccepted: 0,
        reopened: 0,
        blockers: 0,
      });
    });
  });

  it('applies the SAME team ids to all three queries', async () => {
    const { repo, captured } = recordingRepo();
    const scope = editorScope('team-a');

    await repo.listDefects('ws-1', 'proj-1', {}, scope);
    await repo.computeMetrics('ws-1', 'proj-1', scope);

    expect(captured).toHaveLength(3);
    for (const q of captured) {
      expect(q.sql).toMatch(/"team_id" in \(\$\d+\)/);
      expect(q.params).toContain('team-a');
    }
  });
});
