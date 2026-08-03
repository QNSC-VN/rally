import { type CSSProperties, type ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { DragHandle } from '@/shared/ui/drag-handle'

/**
 * Makes one Features-tab row draggable, and hands the row its grip.
 *
 * A wrapper rather than dnd-kit inside `CapacityItemRow`: only the component that calls
 * `useSortable` can own the activator ref, but the row is also rendered on surfaces that do not
 * rank (and by tests that do not mount a `DndContext`). Keeping the mechanics here means the row
 * stays a presentational grid row and simply renders whatever `dragHandle` it is given.
 *
 * Rally ranks by dragging the row itself; the grip is the affordance that says so, and it is the shared
 * `DragHandle` every other rankable grid uses. It hand-rolled a lucide `GripVertical` instead — a
 * different glyph from the six dots the rest of the app draws, and with no width-preserving spacer, so
 * a published plan (grip disabled, `null` rendered) shifted every column ~20px left of a draft one.
 */
export function SortableItemRow({
  id,
  disabled = false,
  label,
  children,
}: {
  /** The Feature's portfolio-item id — the same id the rank mutation takes. */
  id: string
  /** No grip and no drag: a published plan, or a reader without `capacity:manage`. */
  disabled?: boolean
  /** Accessible name for the grip, naming the row it moves. */
  label: string
  children: (dragHandle: ReactNode) => ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lifted, not hidden: the row being dragged stays readable so a planner can see what they are
    // moving past.
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 1 : undefined,
  }

  /**
   * Rendered even when disabled: `DragHandle` becomes an inert, invisible spacer of the same width, so
   * the columns beside it do not move between a draft plan and a published one.
   */
  const grip = (
    <DragHandle
      ref={setActivatorNodeRef}
      label={label}
      disabled={disabled}
      {...attributes}
      {...listeners}
    />
  )

  return (
    <div ref={setNodeRef} style={style}>
      {children(grip)}
    </div>
  )
}
