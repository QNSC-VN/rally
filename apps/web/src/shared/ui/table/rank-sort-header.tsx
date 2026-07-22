import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

/**
 * RankSortHeader — the clickable "Rank" header cell for rank-ordered grids whose
 * rank/row-number lives in the leading gutter (not a normal column), so it can't
 * use the built-in <DataTableHeader> sort affordance. Click toggles sort by the
 * `rank` field (asc ⇄ desc); the arrow mirrors the shared column SortHeader.
 *
 * Pass the SAME width class the body's row-number cell uses so the header and
 * rows stay column-aligned.
 */
export function RankSortHeader({
  active,
  dir,
  onSort,
  widthClass = 'w-12',
}: {
  /** True when the grid is currently sorted by rank. */
  active: boolean
  dir: 'asc' | 'desc'
  onSort: () => void
  widthClass?: string
}) {
  return (
    <button
      type="button"
      onClick={onSort}
      aria-label="Sort by rank"
      className={cn(
        widthClass,
        'group/rank flex shrink-0 cursor-pointer items-center justify-end gap-1 px-2 text-right select-none',
      )}
    >
      <span className={active ? 'text-primary-light' : undefined}>Rank</span>
      {active ? (
        dir === 'desc' ? (
          <ChevronDown size={11} className="shrink-0 text-primary" />
        ) : (
          <ChevronUp size={11} className="shrink-0 text-primary" />
        )
      ) : (
        <ChevronsUpDown
          size={11}
          className="shrink-0 text-slate-400 transition-colors group-hover/rank:text-slate-600"
        />
      )}
    </button>
  )
}
