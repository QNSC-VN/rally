import { ArrowDown, ArrowUp } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import type { SortDir } from '@/shared/lib/hooks/use-table-sort'

/**
 * One click-to-sort heading, for a SMALL table that is not a resizable data grid.
 *
 * `DataTableHeader` owns the heading row of every work-item grid, but it also owns column resizing,
 * column drag-reorder and the grey sticky header bar — it takes `colStyles` and an `onResize`, which a
 * two-column side panel has no business synthesising. This is the sort affordance on its own.
 *
 * Lives in `shared/ui` for the same reason `RowExpandToggle` does: it is a real `<button>`, and the
 * consumer layers should not be hand-rolling those (the `fe-consistency` ratchet counts them).
 *
 * The arrow appears only on the ACTIVE column, which is what Rally draws — a permanent up/down glyph on
 * every heading tells a reader nothing about how the list is currently ordered.
 */
export function SortHeaderCell({
  label,
  active,
  dir,
  onToggle,
  align = 'left',
  className,
}: {
  label: string
  /** Whether this column is the one currently sorted. */
  active: boolean
  dir: SortDir | null
  onToggle: () => void
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}
      className={cn(
        // `text-muted-foreground` at bold 12px is exactly what `DataTableHeader` draws (its `HEADER_TEXT`
        // is the same token): a heading in a panel beside a grid has to read as the grid's heading, and
        // in `text-foreground` it came out navy beside the grid's grey.
        'flex min-w-0 cursor-pointer items-center gap-1 text-ui-xs font-bold text-muted-foreground',
        'hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        align === 'right' && 'justify-end text-right',
        className,
      )}
    >
      {/* Wraps rather than truncates: these headings are two or three words in a narrow column
          ("Points / Capacity"), and the wrap is what Rally's own panel shows. */}
      <span className="min-w-0 break-words whitespace-normal">{label}</span>
      {active &&
        (dir === 'desc' ? (
          <ArrowDown size={11} className="shrink-0" />
        ) : (
          <ArrowUp size={11} className="shrink-0" />
        ))}
    </button>
  )
}
