/**
 * Expand/collapse bookkeeping for the two collapsible grids on the capacity-plan detail page
 * (Teams tab rows, Features tab per-team breakdowns).
 *
 * Both tabs held a byte-identical `useState<Set<string>>` + `useCallback` pair that rebuilt the
 * Set to add or remove one id — 22 lines of the page for one idea, on the file that holds the
 * `MAX_FILE_LINES` ratchet ceiling. Extracted here because `FRONTEND_CONVENTIONS.md` §1 puts
 * page-local helpers in `pages/<x>/model/`, not inside a `*-page.tsx`.
 *
 * It IS a hook now, and the note here used to say the opposite — "deliberately not a hook: `useState`
 * stays on the page so React's rules-of-hooks lint keeps seeing it". That reasoning was wrong on its
 * own terms: the lint rule tracks any function whose name begins with `use`, so a custom hook is
 * exactly as visible to it as an inline `useState`. What forced the second look was the ratchet doing
 * its job — the page sat ON the `MAX_FILE_LINES` ceiling with the back-navigation fix needing two
 * lines, and the only honest way to find them was to stop writing the same four lines twice.
 */
import { useCallback, useState } from 'react'

/**
 * One collapsible grid's expand state: the set of expanded ids, and an immutable toggle for it.
 *
 * Collapsed by default on both grids, as Rally is — a plan with a dozen teams is a list of TEAMS, and
 * expanding every one buries the capacity comparison the tab exists for. Each row carries a count, so
 * a collapsed one still says how much it holds.
 */
export function useExpandedIds(): [ReadonlySet<string>, (id: string) => void] {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = useCallback((id: string) => setExpanded((prev) => toggleId(prev, id)), [])
  return [expanded, toggle]
}

/**
 * Return a NEW Set with `id` flipped. A new instance every time, because React bails out of a
 * re-render when the next state is `Object.is`-equal to the previous one — mutating and returning
 * the same Set would leave the row visually collapsed.
 */
export function toggleId(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
