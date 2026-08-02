/**
 * useRowSelection — reusable multi-row selection state for data tables.
 *
 * Single source of truth for the checkbox / bulk-action pattern shared by the
 * Backlog and Iteration Status grids (and any future list). Keeps a `Set` of
 * selected ids and derives header-checkbox state (all / indeterminate) from the
 * currently visible `items`.
 *
 * Usage:
 *   const sel = useRowSelection(items)
 *   sel.toggle(id)            // per-row checkbox
 *   sel.toggleAll()           // header checkbox
 *   sel.isSelected(id)        // row checked state
 *   sel.selectedIds           // Set<string> for bulk mutations ([...sel.selectedIds])
 *   sel.count, sel.allSelected, sel.someSelected
 *   sel.clear()               // after a bulk action completes
 */
import { useCallback, useMemo, useState } from 'react'

export interface RowSelection {
  /** Ids of every currently selected row. */
  selectedIds: Set<string>
  /** Number of selected rows. */
  count: number
  /** True when every visible item is selected (and there is ≥1). */
  allSelected: boolean
  /** True when some — but not all — visible items are selected. */
  someSelected: boolean
  /** Whether a specific row is selected. */
  isSelected: (id: string) => boolean
  /** Toggle a single row. */
  toggle: (id: string) => void
  /** Select all visible items, or clear them if all are already selected. */
  toggleAll: () => void
  /** Clear the entire selection. */
  clear: () => void
  /**
   * Replace the selection outright.
   *
   * For a partial bulk result: after "archive the rest and report the blocked ones" (Portfolio
   * FR-037) the useful next state is the SKIPPED rows still selected, so the planner can act on
   * exactly those. `clear()` would make them hunt for the failures again, and `toggle` per row
   * cannot express it in one step.
   */
  replace: (ids: Set<string>) => void
}

export function useRowSelection<T extends { id: string }>(items: readonly T[]): RowSelection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id))
  const someSelected = selectedIds.size > 0 && !allSelected

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      // Standard header-checkbox convention: if ANY visible row is selected
      // (partial/indeterminate OR all), clicking clears them; only when nothing
      // is selected does it select all. Gives a reliable one-click "deselect all".
      const anyVisibleSelected = items.some((i) => next.has(i.id))
      if (anyVisibleSelected) items.forEach((i) => next.delete(i.id))
      else items.forEach((i) => next.add(i.id))
      return next
    })
  }, [items])

  const clear = useCallback(() => setSelectedIds(new Set()), [])
  // A COPY, so a caller cannot hold a reference to state and mutate it behind React's back.
  const replace = useCallback((ids: Set<string>) => setSelectedIds(new Set(ids)), [])

  return useMemo(
    () => ({
      selectedIds,
      count: selectedIds.size,
      allSelected,
      someSelected,
      isSelected,
      toggle,
      toggleAll,
      clear,
      replace,
    }),
    [selectedIds, allSelected, someSelected, isSelected, toggle, toggleAll, clear, replace],
  )
}
