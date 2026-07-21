import { useCallback, useState } from 'react'

export type SortDir = 'asc' | 'desc'

export interface SortState<F extends string> {
  field: F
  dir: SortDir
}

/**
 * useTableSort — single source of truth for grid sort state.
 *
 * Replaces the `toggleSort` helper copy-pasted verbatim into backlog,
 * work-item-detail, iteration-status and iterations ("if same column flip dir,
 * else set that column ascending").
 *
 * `toggle(field)`: clicking the active column flips asc↔desc; clicking a new
 * column sorts it ascending.
 */
export function useTableSort<F extends string>(initial: SortState<F> | null = null) {
  const [sort, setSort] = useState<SortState<F> | null>(initial)

  const toggle = useCallback((field: F) => {
    setSort((prev) =>
      prev && prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' },
    )
  }, [])

  const clear = useCallback(() => setSort(null), [])

  return {
    sort,
    sortField: sort?.field ?? null,
    sortDir: sort?.dir ?? null,
    toggle,
    setSort,
    clear,
  }
}
