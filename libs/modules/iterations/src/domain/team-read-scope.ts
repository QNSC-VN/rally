/**
 * The team scope every READ in this module narrows by — the READ half of the BA ruling of
 * 2026-08-17 ("Keep `team_id` nullable. Null means Project Backlog, accessible only to Workspace
 * Admin and Project Admin. Editor … cannot access team-less items. Enforce this consistently in API
 * queries, lists, reports, search, pickers and direct URLs").
 *
 * DERIVED from `AccessService.resolveTeamScope`, never re-declared: a hand-written copy of that
 * union is a second home for one rule, and the whole point of the ruling is that the lists, the
 * reports, the pickers and `assertTeamInScope` cannot disagree. If the resolver's shape changes,
 * every call site here becomes a compile error rather than a silently wider query.
 *
 * How to read a value of this type, in the two places it is consumed
 * ------------------------------------------------------------------
 *   • `unrestricted: true` → emit NO predicate at all. A Workspace Admin, a per-project `admin`, or
 *     a principal with no level (whose refusal belongs to `assertProjectPermission`).
 *   • `{ unrestricted: false, teamIds }` → an `editor`, restricted to those teams.
 *   • `teamIds: []` → a REAL answer, meaning "no delivery scope". It must yield NOTHING, and it must
 *     be short-circuited rather than flattened: `inArray(col, [])` is not portable as "match
 *     nothing", and flattening `[]` to "no filter" fails OPEN — the same `null`-versus-`[]`
 *     distinction `listReadableProjectIds` documents.
 */
import type { TeamReadScope } from '@modules/access';

export type { TeamReadScope };

/** True when the caller has an editor scope that covers no team at all — the "return nothing" case. */
export function scopeIsEmpty(scope: TeamReadScope): boolean {
  return !scope.unrestricted && scope.teamIds.length === 0;
}
