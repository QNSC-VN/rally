/**
 * SelectableTable — the single shell for the COMPLEX work-item grids
 * (Backlog, Quality/Defects, Iteration Status, Work Item → Tasks).
 *
 * Why this exists
 * ---------------
 * The simple list pages already share `ListPageScaffold`, but the complex grids
 * couldn't use it because they need drag-to-rank, cursor pagination, expandable
 * child rows and bespoke inline-edit cells. So each re-wired the SAME selection
 * boilerplate by hand — `useRowSelection`, the header select-all gutter, the
 * `BulkActionBar`, and the `DndContext`/`SortableContext` wrap — and drifted
 * (e.g. Tasks tab had checkboxes but no bar; header-checkbox deselect differed).
 *
 * SelectableTable owns exactly that shared boilerplate and nothing else, so the
 * grids stay consistent while keeping full control of their rows:
 *   - owns row selection (or accepts an external `RowSelection`)
 *   - renders the header select-all gutter (shared `RowGutter`)
 *   - renders the `BulkActionBar` (only when ≥1 selected) with page actions
 *   - optionally wraps the body in dnd-kit context for drag-to-rank
 *   - forwards everything else to `DataTableFrame` (totals, footer/pagination,
 *     loading/empty/error, sticky sortable header)
 *
 * Rows stay page-specific components: each row owns its `useSortable` +
 * `<RowGutter>` (grip + checkbox) and receives `{ selected, onToggleSelect }`
 * via `renderRow`. Expandable grids (Iteration Status) simply return a parent
 * row plus its child rows from `renderRow` — no special support needed.
 */
import { type ReactNode } from 'react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'

import { BulkActionBar } from '@/shared/ui/bulk-action-bar'
import { RowGutter } from '@/shared/ui/row-gutter'
import { type DataTableFrameHeader, DataTableFrame } from '@/shared/ui/table/data-table-frame'
import { useRowSelection, type RowSelection } from '@/shared/lib/hooks/use-row-selection'
import type { DataTableSort } from '@/shared/ui/data-table-header'

/**
 * dnd-kit wiring from `useRowRerank()` — pass to enable drag-to-rank. `children`
 * is omitted because SelectableTable supplies the body itself
 * (`<SortableContext {...sortableContextProps}>{body}</SortableContext>`); callers
 * pass only the behavioural props (sensors / collision / onDragEnd, items / strategy).
 */
export interface SelectableTableDnd {
  dndContextProps: Omit<React.ComponentProps<typeof DndContext>, 'children'>
  sortableContextProps: Omit<React.ComponentProps<typeof SortableContext>, 'children'>
}

export interface SelectableTableProps<Row extends { id: string }, K extends string> {
  /** Visible rows — the selection scope (select-all covers exactly these). */
  rows: readonly Row[]
  /** Render one row; receives live selection state. The row owns its own
   *  `<RowGutter>` (grip + checkbox) so drag + alignment stay page-controlled. */
  renderRow: (row: Row, ctx: { selected: boolean; onToggleSelect: () => void }) => ReactNode

  /** `useDataTable().headerProps`. */
  headerProps: DataTableFrameHeader<K>
  /** Click-to-sort wiring for the header. */
  sort?: DataTableSort
  /** Horizontal padding for header/totals bars (match the row padding). */
  padClassName?: string

  /** Multi-select on (renders the checkbox gutter + bulk bar). Default true. */
  selectable?: boolean
  /** aria-label for the header select-all checkbox. */
  selectAllAriaLabel?: string
  /** Extra header-leading nodes rendered AFTER the select-all gutter (e.g. a
   *  `#` row-number column). The row must render a matching cell so columns
   *  stay aligned. */
  leadingExtra?: ReactNode
  /** Provide to share selection state with the page; else owned internally. */
  selection?: RowSelection
  /** Bulk actions rendered inside the BulkActionBar; receives live selection. */
  bulkActions?: (selection: RowSelection) => ReactNode
  /** Inline error surfaced by a failed bulk action. */
  bulkError?: string | null

  /** Enable drag-to-rank by passing `useRowRerank()` context props. */
  dnd?: SelectableTableDnd

  /** Optional totals row node (a `<TableTotalsRow>`), rendered under the header. */
  totals?: ReactNode
  /** Footer below the scroll region — e.g. a `<PaginationFooter>` (client or cursor). */
  footer?: ReactNode
  loading?: boolean
  skeleton?: { rows?: number; cols?: number }
  error?: ReactNode
  empty?: ReactNode
  bodyBackground?: string
  className?: string
}

export function SelectableTable<Row extends { id: string }, K extends string>({
  rows,
  renderRow,
  headerProps,
  sort,
  padClassName,
  selectable = true,
  selectAllAriaLabel = 'Select all',
  leadingExtra,
  selection: externalSelection,
  bulkActions,
  bulkError,
  dnd,
  totals,
  footer,
  loading = false,
  skeleton,
  error,
  empty,
  bodyBackground,
  className,
}: SelectableTableProps<Row, K>) {
  // Own selection over the visible rows unless the page supplies its own.
  const internalSelection = useRowSelection(rows as readonly { id: string }[])
  const selection = externalSelection ?? internalSelection

  const leadingSelectAll =
    selectable || leadingExtra ? (
      <>
        {selectable && (
          <RowGutter
            dragDisabled
            checkbox={{
              checked: selection.allSelected,
              indeterminate: selection.someSelected,
              onChange: selection.toggleAll,
              ariaLabel: selectAllAriaLabel,
            }}
          />
        )}
        {leadingExtra}
      </>
    ) : undefined

  const body = rows.map((row) =>
    renderRow(row, {
      selected: selectable && selection.isSelected(row.id),
      onToggleSelect: () => selection.toggle(row.id),
    }),
  )
  const wrappedBody = dnd ? (
    <DndContext {...dnd.dndContextProps}>
      <SortableContext {...dnd.sortableContextProps}>{body}</SortableContext>
    </DndContext>
  ) : (
    body
  )

  return (
    <>
      {selectable && selection.count > 0 && (
        <BulkActionBar selectedCount={selection.count} onClear={selection.clear} error={bulkError}>
          {bulkActions?.(selection)}
        </BulkActionBar>
      )}

      <DataTableFrame
        // Only override sort when the page passes it explicitly; otherwise keep
        // whatever `headerProps` already carries (some pages bake sort in).
        header={sort ? { ...headerProps, sort } : headerProps}
        leading={leadingSelectAll}
        padClassName={padClassName}
        totals={totals}
        footer={footer}
        loading={loading}
        skeleton={skeleton}
        error={error}
        empty={empty}
        bodyBackground={bodyBackground}
        className={className}
      >
        {wrappedBody}
      </DataTableFrame>
    </>
  )
}

export type { RowSelection }
