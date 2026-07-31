import type { SortDir } from '@/shared/lib/hooks/use-table-sort'
import type { CapacityPlanTeam } from './api'

/** The team-grid columns a reader can sort by. Mirrors the `sortCol`s in `CAPACITY_TEAM_COLUMNS`. */
export type CapacityTeamSortField =
  'team' | 'features' | 'complete' | 'rollup' | 'estimated' | 'capacity'

/**
 * Sorts a plan's teams CLIENT-SIDE.
 *
 * The plan endpoint returns every team in one payload — there is no page to fetch and no server
 * sort to ask for — so ordering is a view concern. It lives here rather than in the page so the
 * tie-break and null rules are testable without rendering a grid.
 *
 * A team that has entered NO capacity sorts last in both directions. `null` is not zero: zero is a
 * team that declared it has nothing to give, `null` is a team that has not answered yet, and
 * letting `null` win a descending sort would put the least-informative rows at the top.
 *
 * Ties fall back to team name so the order is total — an unstable order makes a re-render look
 * like data changed.
 */
export function sortCapacityTeams(
  teams: readonly CapacityPlanTeam[],
  field: CapacityTeamSortField | null,
  dir: SortDir | null,
  /**
   * How many Features are allocated to a team. Passed in rather than read off the row: the count is
   * derived from the plan's allocation list, which the team payload does not carry.
   */
  featureCountOf: (teamId: string) => number,
): CapacityPlanTeam[] {
  const rows = [...teams]
  if (field === null || dir === null) return rows

  const sign = dir === 'asc' ? 1 : -1
  // `teamName` is nullable in the payload; an unnamed team sorts as the empty string rather than
  // throwing the whole comparator.
  const byName = (a: CapacityPlanTeam, b: CapacityPlanTeam) =>
    (a.teamName ?? '').localeCompare(b.teamName ?? '')

  if (field === 'team') return rows.sort((a, b) => sign * byName(a, b))

  const value = (team: CapacityPlanTeam): number | null => {
    switch (field) {
      case 'features':
        return featureCountOf(team.teamId)
      case 'complete':
        return team.metrics.complete
      case 'rollup':
        return team.metrics.rollup
      case 'estimated':
        return team.metrics.estimated
      case 'capacity':
        return team.metrics.capacity
    }
  }

  return rows.sort((a, b) => {
    const av = value(a)
    const bv = value(b)
    if (av === null && bv === null) return byName(a, b)
    if (av === null) return 1
    if (bv === null) return -1
    return av === bv ? byName(a, b) : sign * (av - bv)
  })
}
