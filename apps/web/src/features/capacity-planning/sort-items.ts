import type { SortDir } from '@/shared/lib/hooks/use-table-sort'
import type { CapacityPlanItem } from './api'

/**
 * Sortable columns on the Features tab.
 *
 * Rally sorts every column on this tab, so the union is the column list minus the two that carry no
 * value to compare: the reserved change marker and the gear. `rank` is here as an explicit field
 * because it is the DEFAULT order and the only one the cutline is defined against — see
 * `isRankOrder`.
 */
export type CapacityItemSortField =
  | 'rank'
  | 'itemKey'
  | 'name'
  | 'assignment'
  | 'team'
  | 'dependencies'
  | 'rollup'
  | 'estimated'
  | 'complete'

/**
 * Rally draws the cutline "only when you sort portfolio items by rank in ascending order", and ranks
 * by dragging only in that same order.
 *
 * `null` counts as rank-ascending: the grid opens in the plan's own order, which IS rank ascending —
 * the state simply has no explicit sort yet.
 */
export function isRankOrder(field: CapacityItemSortField | null, dir: SortDir | null): boolean {
  return field === null || (field === 'rank' && dir !== 'desc')
}

/** Text compare that keeps a missing value last regardless of direction. */
function byText(a: string | null, b: string | null, dir: SortDir): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
}

function byNumber(a: number, b: number, dir: SortDir): number {
  return dir === 'asc' ? a - b : b - a
}

/**
 * The plan's Features in the requested order.
 *
 * Client-side, like every other narrowing on this page: the plan arrives whole, so there is nothing
 * to re-fetch. The incoming array is already in rank order, so `rank` (and no sort at all) returns it
 * untouched rather than re-deriving an order from LexoRank strings, which sort as text.
 *
 * `assignment` sorts by the TEAM NAME a planner reads, not by its id — which is why the caller passes
 * a resolver. An unassigned Feature sorts last either way: it is the row with no answer, and Rally
 * flags it rather than interleaving it.
 */
export function sortCapacityItems(
  items: readonly CapacityPlanItem[],
  field: CapacityItemSortField | null,
  dir: SortDir | null,
  teamNameOf: (teamId: string | null) => string | null,
): CapacityPlanItem[] {
  if (field === null || field === 'rank') {
    const ranked = [...items]
    return dir === 'desc' ? ranked.reverse() : ranked
  }
  const direction: SortDir = dir ?? 'asc'
  const sorted = [...items]

  sorted.sort((a, b) => {
    switch (field) {
      case 'itemKey':
        return byText(a.itemKey, b.itemKey, direction)
      case 'name':
        return byText(a.name, b.name, direction)
      case 'assignment':
        return byText(teamNameOf(a.primaryTeamId), teamNameOf(b.primaryTeamId), direction)
      case 'team':
        return byText(a.teamName, b.teamName, direction)
      // Reserved alongside the column: every Feature reports zero dependencies until there is a
      // dependency model, so this is a stable no-op rather than a missing case.
      case 'dependencies':
        return 0
      case 'rollup':
        return byNumber(a.rollup, b.rollup, direction)
      case 'estimated':
        return byNumber(a.estimated, b.estimated, direction)
      case 'complete':
        return byNumber(a.complete, b.complete, direction)
    }
  })

  return sorted
}
