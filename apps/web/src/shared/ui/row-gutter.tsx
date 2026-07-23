import { forwardRef } from 'react'
import type { DraggableSyntheticListeners } from '@dnd-kit/core'

import { DragHandle } from './drag-handle'
import { SelectionCheckbox } from './selection-checkbox'

export interface RowGutterProps {
  /**
   * Selection checkbox wiring. Omit to render an inert checkbox spacer — used
   * by nested/child rows so their columns stay aligned under the parent.
   */
  checkbox?: {
    checked: boolean
    indeterminate?: boolean
    onChange: () => void
    ariaLabel: string
  }
  /** dnd-kit activator listeners (spread onto the grip). Omit for header/child. */
  dragListeners?: DraggableSyntheticListeners
  /** Render the grip as an inert, invisible spacer (header + child rows, or when
   *  reorder is disabled) while preserving the exact gutter width. */
  dragDisabled?: boolean
  /** Stop clicks on the checkbox cell from bubbling to a row-level handler. */
  stopPropagation?: boolean
}

/**
 * `<RowGutter>` — the single, shared leading gutter for every work-item grid:
 * a rank-reorder grip followed by a selection checkbox, in that fixed order
 * (Broadcom parity, grip left of checkbox).
 *
 * This is the single source of truth for the gutter's cell order and widths, so
 * the sticky header, parent rows and nested child rows can never drift out of
 * column alignment (the class of bug that appears when the markup is copied
 * per-page). Renders a fragment of two flex cells, so it composes inside both
 * gap-based and padding-based grid rows without imposing its own spacing.
 *
 * Pass `ref` to dnd-kit's `setActivatorNodeRef`.
 */
export const RowGutter = forwardRef<HTMLDivElement, RowGutterProps>(function RowGutter(
  { checkbox, dragListeners, dragDisabled = false, stopPropagation = false },
  dragRef,
) {
  return (
    <>
      <DragHandle ref={dragRef} disabled={dragDisabled} {...(dragDisabled ? {} : dragListeners)} />
      <div
        className="flex w-6 shrink-0 items-center justify-center"
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      >
        {checkbox && (
          <SelectionCheckbox
            checked={checkbox.checked}
            indeterminate={checkbox.indeterminate}
            onChange={checkbox.onChange}
            ariaLabel={checkbox.ariaLabel}
          />
        )}
      </div>
    </>
  )
})
