import { useState } from 'react'
import {
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable'

/**
 * The sensor set every rank-reorder surface uses — pointer AND keyboard.
 *
 * Exported because two pages (Backlog, Iteration Status) drive `<DndContext>` directly instead of
 * through {@link useRowRerank}, and each had hand-rolled `useSensors(useSensor(PointerSensor, …))`.
 * That duplication is exactly why they were pointer-only: there was no single place to add the
 * keyboard sensor. One definition now, so a third surface cannot diverge again.
 *
 * `sortableKeyboardCoordinates` translates arrow keys into the coordinates
 * `verticalListSortingStrategy` expects, rather than the pixel deltas a pointer produces. Space or
 * Enter on the grip starts and drops; Escape cancels.
 */
export function useRerankSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

/** Minimal shape a row must satisfy to be rank-reorderable. */
interface Rerankable {
  id: string
}

/** The neighbours a dragged row landed between (null = list edge). */
export interface RowRerankChange {
  id: string
  beforeId: string | null
  afterId: string | null
}

export interface UseRowRerankOptions<T extends Rerankable> {
  /** Rows to make draggable (already filtered/sorted/paginated by the page). */
  items: T[]
  /**
   * Persist the new order. The hook owns the drag mechanics + fractional-rank
   * math; the page owns the mutation — kept out of the shared layer so `shared`
   * never depends on `features`.
   */
  onReorder: (change: RowRerankChange) => void
  /** Disable reordering — e.g. while a non-rank column sort is active. */
  disabled?: boolean
}

export interface UseRowRerankResult<T extends Rerankable> {
  /** Optimistically-ordered rows to render (falls back to `items`). */
  items: T[]
  /** Spread onto `<DndContext>`. */
  dndContextProps: {
    sensors: ReturnType<typeof useSensors>
    collisionDetection: CollisionDetection
    onDragEnd: (event: DragEndEvent) => void
  }
  /** Spread onto `<SortableContext>`. */
  sortableContextProps: {
    items: string[]
    strategy: SortingStrategy
  }
}

/**
 * `useRowRerank` — the single source of truth for rank drag-and-drop across
 * every work-item grid (Backlog, Iteration Status, Defects, …).
 *
 * It owns the dnd-kit sensor, the optimistic local ordering (re-synced during
 * render when the server data reference changes) and the `beforeId`/`afterId`
 * fractional-rank computation, then hands the result to the page's `onReorder`
 * to persist. Pages stay declarative: pass the rows, spread the returned props
 * onto `<DndContext>`/`<SortableContext>`, and render `result.items`.
 */
export function useRowRerank<T extends Rerankable>({
  items,
  onReorder,
  disabled = false,
}: UseRowRerankOptions<T>): UseRowRerankResult<T> {
  // Optimistic copy — re-sync (during render, not in an effect) whenever the
  // upstream data reference changes.
  const [localItems, setLocalItems] = useState<T[]>(items)
  const [syncedItems, setSyncedItems] = useState(items)
  if (syncedItems !== items) {
    setSyncedItems(items)
    setLocalItems(items)
  }

  const sensors = useRerankSensors()

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (disabled || !over || active.id === over.id) return
    const oldIndex = localItems.findIndex((it) => it.id === active.id)
    const newIndex = localItems.findIndex((it) => it.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(localItems, oldIndex, newIndex)
    setLocalItems(reordered)
    // Fractional rank: land between the new neighbours (null = list edge).
    onReorder({
      id: active.id as string,
      beforeId: newIndex > 0 ? reordered[newIndex - 1].id : null,
      afterId: newIndex < reordered.length - 1 ? reordered[newIndex + 1].id : null,
    })
  }

  return {
    items: localItems,
    dndContextProps: { sensors, collisionDetection: closestCenter, onDragEnd: handleDragEnd },
    sortableContextProps: {
      items: localItems.map((it) => it.id),
      strategy: verticalListSortingStrategy,
    },
  }
}
