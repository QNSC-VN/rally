import { describe, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { restrictedTeamScope, teamScope, ALL_TEAMS } from '../../domain/report-scope';
import { teamMatches, timeboxInScope } from './team-scope.sql';

/**
 * The team narrowing every Phase 6 report is bounded by, asserted WITHOUT a database.
 *
 * Rendering the predicate is the point: the defect this file guards against is not a wrong number,
 * it is a MISSING clause. Thirteen call sites used to spell `scope.kind === 'team' ? predicate :
 * undefined`, so a scope kind nobody updated read the whole project and every existing test still
 * passed — a boundary that fails open looks exactly like one that works.
 */
const dialect = new PgDialect();
const render = (chunk: SQL | undefined): { sql: string; params: unknown[] } => {
  // `undefined` means "no clause", which is a real answer for All Teams and a defect for anything
  // else — so it is reported as a string a test can assert on rather than throwing.
  if (chunk === undefined) return { sql: '<no predicate>', params: [] };
  const query = dialect.sqlToQuery(chunk);
  return { sql: query.sql, params: query.params };
};

describe('timeboxInScope', () => {
  it('adds nothing for All Teams — an admin default must stay byte-identical', () => {
    expect(render(timeboxInScope(ALL_TEAMS)).sql).toBe('<no predicate>');
  });

  it('takes a selected Team own timeboxes PLUS the shared ones', () => {
    const { sql: text, params } = render(timeboxInScope(teamScope('t1')));
    expect(text).toContain('"team_id" =');
    expect(text).toContain('"team_id" is null');
    expect(params).toEqual(['t1']);
  });

  it('takes a restricted reader Teams plus the shared ones, as an IN list', () => {
    const { sql: text, params } = render(timeboxInScope(restrictedTeamScope(['t1', 't2'])));
    expect(text).toContain('"team_id" in ($1, $2)');
    expect(text).toContain('"team_id" is null');
    expect(params).toEqual(['t1', 't2']);
  });

  it('matches NOTHING for a reader with no Team, and never emits IN ()', () => {
    const { sql: text } = render(timeboxInScope(restrictedTeamScope([])));
    expect(text).toBe('false');
    expect(text).not.toContain('in ()');
  });
});

describe('teamMatches', () => {
  const resolved = sql`coalesce(a.team_id, b.team_id)`;

  it('adds nothing for All Teams', () => {
    expect(render(teamMatches(ALL_TEAMS, resolved)).sql).toBe('<no predicate>');
  });

  it('is a strict equality for a selected Team', () => {
    const { sql: text, params } = render(teamMatches(teamScope('t1'), resolved));
    expect(text).toBe('coalesce(a.team_id, b.team_id) = $1::uuid');
    expect(params).toEqual(['t1']);
  });

  it('is a strict IN for a restricted reader, which excludes the Project Backlog', () => {
    // The exclusion is the `IN` itself: SQL equality never matches NULL, and a row with no team
    // anywhere resolves to NULL. That is the admin-only population per the BA ruling of 2026-08-17.
    const { sql: text, params } = render(teamMatches(restrictedTeamScope(['t1', 't2']), resolved));
    expect(text).toBe('coalesce(a.team_id, b.team_id) in ($1::uuid, $2::uuid)');
    expect(params).toEqual(['t1', 't2']);
  });

  it('matches NOTHING for a reader with no Team', () => {
    expect(render(teamMatches(restrictedTeamScope([]), resolved)).sql).toBe('false');
  });

  it('never answers "no predicate" for a scope that is not All Teams', () => {
    // The property, not the instance: every restricted or selected scope must produce a clause.
    for (const scope of [
      teamScope('t1'),
      restrictedTeamScope(['t1']),
      restrictedTeamScope(['t1', 't2']),
      restrictedTeamScope([]),
    ]) {
      expect(render(teamMatches(scope, resolved)).sql).not.toBe('<no predicate>');
      expect(render(timeboxInScope(scope)).sql).not.toBe('<no predicate>');
    }
  });
});
