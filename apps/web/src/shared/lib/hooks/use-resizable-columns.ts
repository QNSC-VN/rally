import { useCallback, useEffect, useRef, useState } from 'react'

interface UseResizableColumnsOptions<K extends string> {
  /** Minimum width in px — a flat number for all columns, or per-column overrides. */
  min?: number | Partial<Record<K, number>>
  /** Maximum width in px — a flat number for all columns, or per-column overrides. */
  max?: number | Partial<Record<K, number>>
  /** When set, widths are persisted to localStorage under this key and restored on mount. */
  storageKey?: string
}

/**
 * useResizableColumns — drag-to-resize table column widths.
 *
 * Persists widths to localStorage on mouseup for ultra-smooth 60fps dragging,
 * tracks customized columns, and respects min/max width boundaries.
 */
export function useResizableColumns<K extends string>(
  defaults: Record<K, number>,
  options: UseResizableColumnsOptions<K> = {},
) {
  const { min = 30, max = 1000, storageKey } = options

  const [widths, setWidths] = useState<Record<K, number>>(() => {
    // Clamp a width into the column's current [min, max] bounds. A persisted
    // width can violate the current bounds — e.g. a column resized narrow in an
    // earlier session, then given a larger `minWidth` in code — so clamping on
    // load prevents a stale value from rendering below its minimum (which makes
    // fixed-width content like the schedule-state stepper overflow).
    const clamp = (col: K, w: number) => {
      const lo = typeof min === 'number' ? min : (min[col] ?? 30)
      const hi = typeof max === 'number' ? max : (max[col] ?? 1000)
      return Math.min(hi, Math.max(lo, w))
    }
    let stored: Partial<Record<K, number>> = {}
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) stored = JSON.parse(raw) as Partial<Record<K, number>>
      } catch {
        stored = {}
      }
    }
    // Keep only currently-known columns (drops widths for removed columns) and
    // clamp each persisted/default width into bounds.
    return Object.fromEntries(
      (Object.keys(defaults) as K[]).map((k) => [k, clamp(k, stored[k] ?? defaults[k])]),
    ) as Record<K, number>
  })

  const [resizedKeys, setResizedKeys] = useState<Set<K>>(() => {
    if (!storageKey) return new Set<K>()
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<K, number>>
        return new Set(Object.keys(parsed) as K[])
      }
    } catch {
      /* noop */
    }
    return new Set<K>()
  })

  // Ref to hold the latest widths to prevent recreating startResize callback
  const widthsRef = useRef(widths)
  useEffect(() => {
    widthsRef.current = widths
  }, [widths])

  const resizingRef = useRef<{ col: K; startX: number; startW: number } | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Safety net: remove document listeners on unmount
  useEffect(() => () => cleanupRef.current?.(), [])

  const minFor = useCallback((col: K) => (typeof min === 'number' ? min : (min[col] ?? 30)), [min])
  const maxFor = useCallback(
    (col: K) => (typeof max === 'number' ? max : (max[col] ?? 1000)),
    [max],
  )

  const startResize = useCallback(
    (col: K, e: React.MouseEvent) => {
      e.preventDefault()
      const startW = widthsRef.current[col] ?? defaults[col]
      resizingRef.current = { col, startX: e.clientX, startW }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      function onMove(ev: MouseEvent) {
        if (!resizingRef.current) return
        const { col: c, startX, startW: sw } = resizingRef.current
        const next = Math.min(maxFor(c), Math.max(minFor(c), sw + ev.clientX - startX))

        setResizedKeys((prev) => {
          if (prev.has(c)) return prev
          const nextSet = new Set(prev)
          nextSet.add(c)
          return nextSet
        })

        setWidths((prev) => ({ ...prev, [c]: next }))
      }

      function onUp() {
        resizingRef.current = null
        cleanupRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)

        // Persist to localStorage only at the end of the drag to keep dragging extremely fluid
        if (storageKey) {
          setWidths((prev) => {
            try {
              localStorage.setItem(storageKey, JSON.stringify(prev))
            } catch {
              /* noop */
            }
            return prev
          })
        }
      }

      cleanupRef.current = onUp
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [minFor, maxFor, storageKey, defaults],
  )

  return { widths, setWidths, startResize, resizedKeys }
}
