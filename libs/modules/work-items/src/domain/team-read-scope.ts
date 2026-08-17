/**
 * The EDITOR Team scope, on the READ side — one decision table for every list, count, search and
 * picker in this module (BA ruling 2026-08-17, `GAP-P4-RBAC-003`):
 *
 *   "Keep `team_id` nullable. Null means Project Backlog, accessible only to Workspace Admin and
 *    Project Admin. Editor must select one of their assigned Teams when creating a Work Item and
 *    cannot access team-less items. Enforce this consistently in API queries, lists, reports, search,
 *    pickers and direct URLs."
 *
 * `AccessService.resolveTeamScope` answers WHO the caller is; this file answers what that means for
 * a ROW, so the SQL builders and the in-memory filters cannot disagree — the property whose absence
 * made the deleted `assertTeamScoped` "a filter with a security-sounding name". Three outcomes and
 * no fourth:
 *
 *   • `all`  — a Workspace Admin, a per-project `admin`, or a principal with no level at all. NO
 *     predicate is added. (`resolveTeamScope` owns why the last of those is unrestricted here:
 *     answering a permission failure with an empty grid would read as "this project has no work".)
 *   • `none` — an `editor` with no active Team in the project. The read must return NOTHING. It is
 *     NOT flattened into `all`, which is the `listReadableProjectIds` `null`-versus-`[]` mistake in
 *     a second place, and it is not emitted as `inArray(col, [])`, which is not portable as "match
 *     nothing" — every caller short-circuits instead.
 *   • `in`   — an `editor`'s own Teams, as `team_id IN (…)`. NEVER `IN (…) OR IS NULL`: a team-less
 *     row is the Project Backlog and is admin-only, so SQL's own exclusion of NULL from `IN` is the
 *     behaviour that is wanted rather than an accident to be papered over.
 */

/**
 * Re-exported from its single home rather than re-declared: four modules had a local copy of this one
 * decision within a day of the rule landing, which is exactly the drift the rule exists to prevent.
 */
import type { TeamReadScope } from '@modules/access';

export type { TeamReadScope };

/**
 * One project's team narrowing inside a CROSS-project read (the two Home aggregates).
 *
 * Only projects the caller is an `editor` in appear; any readable project NOT named here is
 * unrestricted. `teamIds: []` is a real answer and means that project contributes no rows.
 */
export interface ProjectTeamScope {
  projectId: string;
  teamIds: string[];
}

/** What a query must do about `team_id`. See the file docblock for why there are exactly three. */
export type TeamRowFilter = { kind: 'all' } | { kind: 'none' } | { kind: 'in'; teamIds: string[] };

/** The scope, as an instruction to a query. */
export function teamRowFilter(scope: TeamReadScope): TeamRowFilter {
  if (scope.unrestricted) return { kind: 'all' };
  if (scope.teamIds.length === 0) return { kind: 'none' };
  return { kind: 'in', teamIds: scope.teamIds };
}

/**
 * The same decision for a row already in memory — used where the rows come from a query that cannot
 * express the predicate (the far END of a relation, whose project and team are only known after the
 * row loads).
 *
 * `teamId === null` is refused for a restricted caller: that is the Project Backlog.
 */
export function teamScopeAdmits(scope: TeamReadScope, teamId: string | null): boolean {
  const filter = teamRowFilter(scope);
  switch (filter.kind) {
    case 'all':
      return true;
    case 'none':
      return false;
    case 'in':
      return teamId !== null && filter.teamIds.includes(teamId);
  }
}
