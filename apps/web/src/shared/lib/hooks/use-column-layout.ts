import { useCallback, useMemo, useState } from 'react'
import { useResizableColumns } from './use-resizable-columns'

export interface ColumnDef<K extends string> {
  key: K
  label: string
  defaultWidth: number
  minWidth?: number
  /** Cannot be hidden via the Show Fields menu (e.g. ID / Name). */
  locked?: boolean
}

interface StoredExtras<K extends string> {
  order?: K[]
  hidden?: K[]
}

function loadExtras<K extends string>(storageKey: string, knownKeys: K[]): StoredExtras<K> {
  try {
    const raw = localStorage.getItem(`${storageKey}:layout`)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as StoredExtras<K>
    const known = new Set(knownKeys)
    const order = Array.isArray(parsed.order) ? parsed.order.filter((k) => known.has(k)) : undefined
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((k) => known.has(k))
      : undefined
    return { order, hidden }
  } catch {
    return {}
  }
}

function saveExtras<K extends string>(storageKey: string, extras: Required<StoredExtras<K>>) {
  try {
    localStorage.setItem(`${storageKey}:layout`, JSON.stringify(extras))
  } catch {
    /* noop */
  }
}

/**
 * useColumnLayout — width resize (delegates to useResizableColumns) plus
 * column order and visibility, persisted alongside widths. Exposes styleFor()
 * so existing per-column JSX just spreads the returned style instead of a
 * full config-driven table rewrite.
 */
export function useColumnLayout<K extends string>(columns: ColumnDef<K>[], storageKey: string) {
  const knownKeys = useMemo(() => columns.map((c) => c.key), [columns])
  const defaults = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c.defaultWidth])) as Record<K, number>,
    [columns],
  )
  const mins = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c.minWidth ?? 30])) as Record<K, number>,
    [columns],
  )

  const { widths, startResize, resizedKeys } = useResizableColumns(defaults, {
    min: mins,
    storageKey,
  })

  const [{ order, hidden }, setExtras] = useState(() => {
    const stored = loadExtras<K>(storageKey, knownKeys)
    const order = stored.order ?? knownKeys
    // Reconcile: keep known stored order, append any new columns not yet stored.
    const merged = [
      ...order.filter((k) => knownKeys.includes(k)),
      ...knownKeys.filter((k) => !order.includes(k)),
    ]
    const hiddenSet = new Set(
      (stored.hidden ?? []).filter((k) => !columns.find((c) => c.key === k)?.locked),
    )
    return { order: merged, hidden: hiddenSet }
  })

  const persist = useCallback(
    (next: { order: K[]; hidden: Set<K> }) => {
      saveExtras(storageKey, { order: next.order, hidden: [...next.hidden] })
    },
    [storageKey],
  )

  const toggleVisible = useCallback(
    (key: K) => {
      if (columns.find((c) => c.key === key)?.locked) return
      setExtras((prev) => {
        const nextHidden = new Set(prev.hidden)
        if (nextHidden.has(key)) nextHidden.delete(key)
        else nextHidden.add(key)
        const next = { order: prev.order, hidden: nextHidden }
        persist(next)
        return next
      })
    },
    [columns, persist],
  )

  /**
   * Move `dragKey` to sit relative to `overKey` in the order array.
   * `position` defaults to `'before'` (backwards-compatible with the Show
   * Fields menu); pass `'after'` to drop a column to the RIGHT of the target
   * (required for left-to-right header drags).
   */
  const reorder = useCallback(
    (dragKey: K, overKey: K, position: 'before' | 'after' = 'before') => {
      if (dragKey === overKey) return
      setExtras((prev) => {
        const withoutDrag = prev.order.filter((k) => k !== dragKey)
        const overIndex = withoutDrag.indexOf(overKey)
        if (overIndex === -1) return prev
        const insertAt = position === 'after' ? overIndex + 1 : overIndex
        withoutDrag.splice(insertAt, 0, dragKey)
        const next = { order: withoutDrag, hidden: prev.hidden }
        persist(next)
        return next
      })
    },
    [persist],
  )

  const orderIndex = useMemo(() => {
    const map = new Map<K, number>()
    order.forEach((k, i) => map.set(k, i))
    return map
  }, [order])

  /** Combine a column's base style (width/flex from callsite) with order + visibility. */
  const styleFor = useCallback(
    (key: K, base: React.CSSProperties = {}): React.CSSProperties => {
      const isHidden = hidden.has(key)
      if (isHidden) {
        return { ...base, display: 'none', order: orderIndex.get(key) ?? 0 }
      }

      const width = widths[key] ?? base.width

      // Fixed-width column: pin width and drop any flex sizing the callsite set,
      // so the resized width always wins.
      return {
        ...base,
        order: orderIndex.get(key) ?? 0,
        width,
        minWidth: width,
        maxWidth: width,
        flex: `0 0 ${width}px`,
        flexShrink: undefined,
        flexGrow: undefined,
        flexBasis: undefined,
      }
    },
    [widths, orderIndex, hidden],
  )

  return { widths, startResize, order, hidden, toggleVisible, reorder, styleFor, resizedKeys }
}
