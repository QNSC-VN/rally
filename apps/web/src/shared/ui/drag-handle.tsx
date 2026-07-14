import { forwardRef } from 'react'
import { BRAND } from '@/shared/config/brand'

export type DragHandleProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Render an invisible, inert spacer (keeps column alignment when reorder is off). */
  disabled?: boolean
}

/**
 * Six-dot drag-affordance glyph (2 columns × 4 rows) matching the Broadcom
 * Rally rank grip. Rendered as filled circles so the grid reads clearly even
 * at small sizes, unlike lucide's thin `GripVertical`.
 */
function GripDots() {
  const cols = [2, 6]
  const rows = [1.5, 5.5, 9.5, 13.5]
  return (
    <svg
      width="8"
      height="15"
      viewBox="0 0 8 15"
      fill={BRAND.textMuted}
      aria-hidden="true"
      focusable="false"
    >
      {rows.flatMap((cy) => cols.map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" />))}
    </svg>
  )
}

/**
 * Drag-to-reorder grip for rank-ordered data grids (Backlog, Iteration Status).
 *
 * Sits in a fixed left gutter, faintly visible at rest and brightening on row
 * hover, so the reorder affordance is always discoverable without competing
 * with row content. The parent row MUST carry the `group` class for the
 * hover-emphasis to work.
 *
 * Wire it to dnd-kit's sortable: pass `setActivatorNodeRef` as `ref`, spread
 * `listeners` onto it, and put `attributes` on the row element itself.
 */
export const DragHandle = forwardRef<HTMLDivElement, DragHandleProps>(function DragHandle(
  { disabled = false, className = '', ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-label={disabled ? undefined : 'Drag to reorder'}
      className={`flex w-4 shrink-0 items-center justify-center px-2 ${
        disabled
          ? 'cursor-default opacity-0'
          : 'cursor-grab opacity-60 transition-opacity duration-100 group-hover:opacity-100 active:cursor-grabbing'
      } ${className}`}
      {...(disabled ? {} : rest)}
    >
      <GripDots />
    </div>
  )
})
