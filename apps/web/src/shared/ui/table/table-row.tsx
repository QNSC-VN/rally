import { forwardRef, type HTMLAttributes } from 'react'

import { cn } from '@/shared/lib/utils'

export interface TableRowProps extends HTMLAttributes<HTMLDivElement> {
  /** 30px floor instead of 34px — the nested and allocation grids sit tighter. */
  compact?: boolean
  /** `min-w-max`, for a grid inside a horizontal scroll region: the row spans all its columns. */
  fitContent?: boolean
  /** The whole row opens something on click. */
  interactive?: boolean
  /**
   * A DISCLOSED child row: tinted, and it does not take the hover highlight.
   *
   * Subordination is carried by the tint and the indent, not by shrinking the type — a child row keeps
   * the parent's 12px, or every editable control on it renders visibly smaller than the identical
   * control one row above.
   */
  nested?: boolean
}

/**
 * One row of a data grid — the chrome every grid shares, in one place.
 *
 * Eight grids had hand-written the same class string and had already drifted four ways:
 *
 *   • Release Tracking used `hover:bg-surface-hover`, the LIST-row hover (Projects, Home), so one grid
 *     highlighted a different colour from the identical grid one menu item away;
 *   • Iteration Status used `border-border-subtle` where the other seven use `border-border-inner`, plus
 *     a `duration-100` nobody else has;
 *   • three had no `min-h` floor at all, so row height tracked content and a grid's rows were ragged;
 *   • two were missing `group`, which is what hover-revealed controls (the drag grip, row actions) key
 *     off — so those controls never appeared.
 *
 * Same reasoning as `useDragRowStyle`, which exists because seven grids had hand-written the same drag
 * style: the fix for a repeated block is one shared producer, not a convention nobody can enforce.
 *
 * PADDING IS DELIBERATELY NOT HERE. The grids genuinely differ — `px-3` on most, `px-2` on the capacity
 * allocation table, `pr-3 pl-1` on Iteration Status — because each has to line up with its own header's
 * `padClassName`. A row whose padding disagreed with its header is the alignment bug this component
 * cannot fix for you; pass it in `className` and match the frame.
 */
export const TableRow = forwardRef<HTMLDivElement, TableRowProps>(function TableRow(
  { compact = false, fitContent = false, interactive = false, nested = false, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'group flex items-center border-b border-border-inner text-ui-md transition-colors',
        compact ? 'min-h-[30px]' : 'min-h-[34px]',
        fitContent && 'min-w-max',
        interactive && 'cursor-pointer',
        nested ? 'bg-surface-subtle' : 'hover:bg-primary-lighter',
        className,
      )}
      {...rest}
    />
  )
})
