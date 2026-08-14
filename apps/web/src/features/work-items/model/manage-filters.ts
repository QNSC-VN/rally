/**
 * Manage Filters — the shared multi-column filter model for the work-item grids.
 *
 * Implements `P2-BL-FR-005` / `P2-BL-FR-020` / Backlog AC-7 ("Manage Filters
 * allows selecting multiple columns and combines active filters after Apply")
 * and `P2-IS-FR-022`, which inherits the Backlog pattern by reference.
 *
 * ONE model, used by Backlog and Iteration Status. The two screens differ only
 * in their field list; the selection / draft / apply semantics are identical, so
 * they live here rather than being written twice.
 *
 * Three rules the shape encodes deliberately:
 *
 *  1. **`applied` is the only thing a query may read.** `draft` holds what the
 *     user has typed but not yet committed. AC-7 makes Apply the moment filters
 *     combine, so a query built from `draft` would filter on every keystroke and
 *     make the Apply button a lie.
 *  2. **Un-checking a column DROPS its value.** A filter that still narrows the
 *     list while its control is hidden is invisible state — the smell CLAUDE.md
 *     records as "a value HIDDEN on read": the banner reads as unfiltered, the
 *     grid is filtered, and there is no control left to clear it.
 *  3. **Quick search is NOT a field here.** `P2-BL-TS-015` requires the toolbar
 *     search to keep working independently of Manage Filters, so it stays the
 *     page's own state and is sent as its own (`q`) parameter.
 */
import { useCallback, useMemo, useState } from 'react'

/**
 * The Owner filter's "Unassigned" value. Not a user id, and deliberately the
 * BACKEND's sentinel (`UNASSIGNED_FILTER` in `work-item.types.ts`) rather than a
 * client-only token: SQL equality never matches NULL, so an unassigned option
 * has to be resolved to `assignee_id IS NULL` server-side. Iteration Status used
 * a client-only `__unassigned__` because its filtering was client-side; sending
 * that to the server would have matched nothing.
 */
export const UNASSIGNED_OWNER = 'unassigned'

export type FilterFieldKind = 'text' | 'number' | 'select'

export interface FilterFieldOption {
  value: string
  label: string
}

export interface FilterFieldDef<K extends string = string> {
  /** Stable key. Also the server query parameter this field maps to. */
  key: K
  /** Translated column label — the same word the grid header shows. */
  label: string
  /** `text`/`number` render an input (P2-BL-FR-006); `select` a dropdown. */
  kind: FilterFieldKind
  /** `select` only. The "any value" row is added by the control, not here. */
  options?: FilterFieldOption[]
  /**
   * Whether the field's control shows before the user touches Manage Filters.
   * Defaults to false: the fields each screen already shipped opt IN, so
   * enabling Manage Filters cannot silently remove a filter someone relied on.
   */
  defaultVisible?: boolean
}

export type FilterValues<K extends string> = Partial<Record<K, string>>

export interface ManageFiltersState<K extends string> {
  /** Every offered field, in definition order. */
  fields: FilterFieldDef<K>[]
  /** The chosen fields, in definition order — the controls to render. */
  visible: FilterFieldDef<K>[]
  isVisible: (key: K) => boolean
  toggleVisible: (key: K) => void
  /** Uncommitted control values. */
  draft: FilterValues<K>
  setDraftValue: (key: K, value: string) => void
  /** Committed values. The query reads THIS and nothing else. */
  applied: FilterValues<K>
  /** The draft differs from what is applied — Apply has something to do. */
  dirty: boolean
  /** Count of applied, non-empty values; feeds the toolbar's filter badge. */
  activeCount: number
  apply: () => void
  clear: () => void
}

/** Strip empties and anything whose field is no longer visible. */
function commitValues<K extends string>(
  fields: FilterFieldDef<K>[],
  values: FilterValues<K>,
  visibleKeys: ReadonlySet<K>,
): FilterValues<K> {
  const next: FilterValues<K> = {}
  for (const field of fields) {
    if (!visibleKeys.has(field.key)) continue
    const value = values[field.key]
    if (value != null && value !== '') next[field.key] = value
  }
  return next
}

function sameValues<K extends string>(a: FilterValues<K>, b: FilterValues<K>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => a[k as K] === b[k as K])
}

/**
 * @param fields Offered filter fields. Pass a MEMOISED array — the default
 * visible set is read once, on first render, so a fresh array is harmless, but a
 * stable one keeps the returned callbacks stable too.
 */
export function useManageFilters<K extends string>(
  fields: FilterFieldDef<K>[],
): ManageFiltersState<K> {
  // Lazy initial state so the default set is read exactly once and a later
  // re-render (e.g. member options arriving) cannot re-check a field the user
  // has just un-checked.
  const [visibleKeys, setVisibleKeys] = useState<Set<K>>(
    () => new Set(fields.filter((f) => f.defaultVisible).map((f) => f.key)),
  )
  const [draft, setDraft] = useState<FilterValues<K>>({})
  const [applied, setApplied] = useState<FilterValues<K>>({})

  const toggleVisible = useCallback((key: K) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        // Rule 2: hiding a column clears its filter, in the draft AND in what is
        // already applied, so the grid can never be narrowed by a control the
        // reader cannot see.
        setDraft((d) => {
          if (d[key] === undefined) return d
          const copy = { ...d }
          delete copy[key]
          return copy
        })
        setApplied((a) => {
          if (a[key] === undefined) return a
          const copy = { ...a }
          delete copy[key]
          return copy
        })
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const setDraftValue = useCallback((key: K, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }, [])

  const apply = useCallback(() => {
    setApplied(commitValues(fields, draft, visibleKeys))
  }, [fields, draft, visibleKeys])

  const clear = useCallback(() => {
    setDraft({})
    setApplied({})
  }, [])

  const visible = useMemo(() => fields.filter((f) => visibleKeys.has(f.key)), [fields, visibleKeys])
  const pending = useMemo(
    () => commitValues(fields, draft, visibleKeys),
    [fields, draft, visibleKeys],
  )

  return {
    fields,
    visible,
    isVisible: (key: K) => visibleKeys.has(key),
    toggleVisible,
    draft,
    setDraftValue,
    applied,
    dirty: !sameValues(pending, applied),
    activeCount: Object.keys(applied).length,
    apply,
    clear,
  }
}
