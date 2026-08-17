import { describe, expect, it } from 'vitest';
import { teamRowFilter, teamScopeAdmits } from './team-read-scope';

/**
 * The decision table every scoped READ in this module compiles down to (BA ruling 2026-08-17,
 * `GAP-P4-RBAC-003`). Pinned here rather than only at the SQL, because the three cases are what the
 * boundary IS — a query builder can then be read against them, and the in-memory filter used for a
 * relation's far end cannot answer differently from the query.
 */
describe('teamRowFilter', () => {
  it('adds NO predicate for an unrestricted caller', () => {
    expect(teamRowFilter({ unrestricted: true })).toEqual({ kind: 'all' });
  });

  it('answers `none` for an Editor with no Team — never `all`', () => {
    // The `listReadableProjectIds` mistake in a second place: flattening this into "no filter" hands
    // the caller the whole project, and `inArray(col, [])` is not portable as "match nothing" either.
    expect(teamRowFilter({ unrestricted: false, teamIds: [] })).toEqual({ kind: 'none' });
  });

  it("answers `in` with the Editor's own Teams", () => {
    expect(teamRowFilter({ unrestricted: false, teamIds: ['team-a', 'team-b'] })).toEqual({
      kind: 'in',
      teamIds: ['team-a', 'team-b'],
    });
  });
});

describe('teamScopeAdmits', () => {
  it('admits every row, INCLUDING a team-less one, for an unrestricted caller', () => {
    // `team_id IS NULL` is the Project Backlog, and a Workspace Admin / per-project admin owns it.
    expect(teamScopeAdmits({ unrestricted: true }, null)).toBe(true);
    expect(teamScopeAdmits({ unrestricted: true }, 'team-a')).toBe(true);
  });

  it("admits a row in one of the Editor's Teams", () => {
    expect(teamScopeAdmits({ unrestricted: false, teamIds: ['team-a'] }, 'team-a')).toBe(true);
  });

  it("refuses another Team's row", () => {
    expect(teamScopeAdmits({ unrestricted: false, teamIds: ['team-a'] }, 'team-b')).toBe(false);
  });

  it('refuses a TEAM-LESS row for an Editor — that is the Project Backlog', () => {
    expect(teamScopeAdmits({ unrestricted: false, teamIds: ['team-a'] }, null)).toBe(false);
  });

  it('refuses everything when the Editor has no Team at all', () => {
    expect(teamScopeAdmits({ unrestricted: false, teamIds: [] }, 'team-a')).toBe(false);
    expect(teamScopeAdmits({ unrestricted: false, teamIds: [] }, null)).toBe(false);
  });
});
