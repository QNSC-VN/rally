import { useCallback, useRef, useState } from 'react'

/**
 * Drop indicator position relative to a column header.
 *
 * - `before` — insertion line should appear at the LEFT edge of the target column.
 * - `after`  — insertion line should appear at the RIGHT edge of the target column.
 */
export interface DropIndicator<K extends string> {
  type: 'before' | 'after'
  key: K
}

interface UseColumnDragOptions<K extends string> {
  /** Called with (fromKey, toKey) when a column is dropped on a valid target. */
  onReorder: (fromKey: K, toKey: K) => void
}

/**
 * `useColumnDrag` — lightweight, reusable HTML5 drag-and-drop logic for
 * table column headers. Uses a **ref** for the active drag key so the
 * `onDrop` closure always reads the freshest value without depending on
 * a stale React-state closure.
 *
 * Consumed by `<DraggableHeaderCell>` but can also be used directly.
 */
export function useColumnDrag<K extends string>({ onReorder }: UseColumnDragOptions<K>) {
  // ── Ref-based drag key (avoids stale-closure bugs in onDrop) ──
  const dragKeyRef = useRef<K | null>(null)

  // ── Visual state (drives re-renders for opacity / indicator) ──
  const [activeDragKey, setActiveDragKey] = useState<K | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator<K> | null>(null)

  // Keep a ref in sync so handleDrop can read the latest indicator without
  // being in the dependency array of its useCallback.
  const indicatorRef = useRef<DropIndicator<K> | null>(null)
  const setIndicator = useCallback((v: DropIndicator<K> | null) => {
    indicatorRef.current = v
    setDropIndicator(v)
  }, [])

  // ── Shared cleanup ──
  const cleanup = useCallback(() => {
    dragKeyRef.current = null
    setActiveDragKey(null)
    setIndicator(null)
  }, [setIndicator])

  // ── Event handlers ──

  const handleDragStart = useCallback((key: K, e: React.DragEvent) => {
    dragKeyRef.current = key
    setActiveDragKey(key)
    setIndicator(null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }, [setIndicator])

  const handleDragOver = useCallback(
    (key: K, e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const from = dragKeyRef.current
      if (!from || from === key) {
        setIndicator(null)
        return
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const midX = rect.left + rect.width / 2
      setIndicator(e.clientX < midX ? { type: 'before', key } : { type: 'after', key })
    },
    [setIndicator],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      // Only clear when the pointer truly leaves the element (not when it
      // enters a child). This prevents flickering.
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        setIndicator(null)
      }
    },
    [setIndicator],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const from = dragKeyRef.current
      const indicator = indicatorRef.current
      if (!from || !indicator) {
        cleanup()
        return
      }
      onReorder(from, indicator.key)
      cleanup()
    },
    [onReorder, cleanup],
  )

  const handleDragEnd = useCallback(() => {
    cleanup()
  }, [cleanup])

  return {
    activeDragKey,
    dropIndicator,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  }
}