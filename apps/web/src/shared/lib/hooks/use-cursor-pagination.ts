import { useCallback, useState } from 'react'

/**
 * useCursorPagination — server-side cursor pagination.
 *
 * Replaces the `cursor` / `cursorHistory` / `goNext` / `goPrev` state machine
 * hand-rolled in backlog-page and milestones-detail. Keeps the current cursor
 * plus a back-stack of previous cursors so "Previous" walks backwards exactly.
 *
 * `cursor` (null = first page) feeds your query; when the response returns a
 * `nextCursor`, call `goNext(nextCursor)`. `hasPrev` drives the Previous button;
 * "has next" is whatever your query reports (only the caller knows), so it is
 * intentionally not tracked here.
 */
export function useCursorPagination() {
  const [cursor, setCursor] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<string | null>>([])

  const goNext = useCallback(
    (nextCursor: string) => {
      setHistory((h) => [...h, cursor])
      setCursor(nextCursor)
    },
    [cursor],
  )

  const goPrev = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h
      const copy = h.slice(0, -1)
      setCursor(h[h.length - 1])
      return copy
    })
  }, [])

  const reset = useCallback(() => {
    setCursor(null)
    setHistory([])
  }, [])

  return { cursor, goNext, goPrev, reset, hasPrev: history.length > 0 }
}
