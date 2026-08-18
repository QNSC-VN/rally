/**
 * The team scope the defect list and its metrics narrow by — the READ half of the BA ruling of
 * 2026-08-17 ("Keep `team_id` nullable. Null means Project Backlog, accessible only to Workspace
 * Admin and Project Admin. Editor … cannot access team-less items. Enforce this consistently in API
 * queries, lists, reports, search, pickers and direct URLs"), and the code half of the §5 Editor row
 * `db/permissions.catalog.ts` already quotes beside `QUALITY_VIEW`: "Quality Defects View = Assigned
 * Teams".
 *
 * DERIVED from `AccessService.resolveTeamScope`, never re-declared: one rule, one home. If the
 * resolver's shape changes, every call site here becomes a compile error rather than a silently wider
 * query.
 *
 *   • `unrestricted: true` → emit NO predicate at all (Workspace Admin, per-project `admin`, or a
 *     principal with no level, whose refusal belongs to `assertProjectPermission`).
 *   • `{ unrestricted: false, teamIds }` → an `editor`, restricted to those teams.
 *   • `teamIds: []` → a REAL answer meaning "no delivery scope": it must yield NOTHING, and be
 *     short-circuited rather than flattened. `inArray(col, [])` is not portable as "match nothing",
 *     and flattening `[]` into "no filter" fails OPEN.
 *
 * A defect is a WORK ROW, so the predicate is `team_id IN (…)` with NO `OR IS NULL`: a team-less
 * defect is the Project Backlog's, and admin-only.
 */
import type { TeamReadScope } from '@modules/access';

export type { TeamReadScope };

/** True when the caller has an editor scope covering no team at all — the "return nothing" case. */
export function scopeIsEmpty(scope: TeamReadScope): boolean {
  return !scope.unrestricted && scope.teamIds.length === 0;
}
