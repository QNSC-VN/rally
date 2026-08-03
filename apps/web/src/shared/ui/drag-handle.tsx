import { forwardRef } from 'react'
import { BRAND } from '@/shared/config/brand'

export type DragHandleProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Render an invisible, inert spacer (keeps column alignment when reorder is off). */
  disabled?: boolean
  /**
   * Accessible name, when the caller can NAME the row this grip moves ("Reorder FE-3").
   *
   * The default is a hardcoded English `Drag to reorder`, which is the same on every row of every
   * grid — a screen-reader user tabbing a list of them hears one sentence repeated with no way to tell
   * which row they are on. Callers that know the row pass its key; the default stays for the grids
   * that render a grip per row without a handy label.
   */
  label?: string
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
 * Sits in a fixed left gutter, HIDDEN AT REST and revealed on row hover (Rally parity), so the
 * reorder affordance appears right where the pointer is without cluttering the grid. Capacity
 * Planning's own grip (`sortable-item-row.tsx`) already worked this way and is the model.
 *
 * THE PARENT ROW MUST CARRY THE `group` CLASS, or the grip never appears for a pointer user.
 * Every row that passes `dragListeners` does; the ones that do not pass a bare `dragDisabled`
 * spacer, which is `opacity-0` regardless. Adding a grip to a new grid means adding `group` to
 * its row in the same change.
 *
 * This docblock described the hover reveal for a long time while the code rendered `opacity-70`
 * — always visible, and inconsistent with Capacity Planning. The comment was right and the class
 * was wrong; the class now matches.
 *
 * Wire it to dnd-kit's sortable: pass `setActivatorNodeRef` as `ref`, and spread BOTH `listeners`
 * and `attributes` onto it. `attributes` belongs here, on the activator, not on the row — see below.
 */
export const DragHandle = forwardRef<HTMLButtonElement, DragHandleProps>(function DragHandle(
  { disabled = false, label, className = '', ...rest },
  ref,
) {
  return (
    /**
     * A real `<button>`, because this is the only control for a documented feature and it was a plain
     * `div`: unreachable by Tab, so rank reorder was pointer-only on every grid. dnd-kit's
     * `KeyboardSensor` activates from the ACTIVATOR's `onKeyDown` (part of `listeners`), which a
     * non-focusable node can never receive.
     *
     * `attributes` now spreads here too. On the row it made every ROW announce as a button and take its
     * own tab stop, while the element that actually starts a drag had neither — focus landed on one
     * node and the key handler lived on another, which is why adding a sensor alone would not have been
     * enough.
     *
     * `focus-visible` only: a persistent ring on a grip that is hidden until row hover would be visual
     * noise, but a keyboard user must be able to see where they are.
     */
    <button
      ref={ref}
      type="button"
      // Hidden from the a11y tree when it is a pure spacer, so a child or header row does not offer a
      // reorder control that does nothing.
      aria-hidden={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      aria-label={disabled ? undefined : (label ?? 'Drag to reorder')}
      className={`flex w-5 shrink-0 items-center justify-center border-none bg-transparent p-0 ${
        disabled
          ? 'cursor-default opacity-0'
          : 'cursor-grab text-muted-foreground opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current active:cursor-grabbing'
      } ${className}`}
      {...(disabled ? {} : rest)}
    >
      <GripDots />
    </button>
  )
})
