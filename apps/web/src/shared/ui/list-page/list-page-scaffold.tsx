/**
 * ListPageScaffold — the single, shared layout for every entity LIST page
 * (Iteration Status, Milestones, Releases, Timeboxes/Iterations, …).
 *
 * Why this exists
 * ---------------
 * The list pages already shared the *pieces* (`PageToolbar`, `MetricStrip`,
 * `DataTableFrame`, `RowGutter`, `TableTotalsRow`, `PaginationFooter`,
 * `BulkActionBar`, `useRowSelection`) but each page re-wired them — the fixed
 * order, the selection gutter, the client-side pagination and the bulk bar —
 * so they drifted (some had a metric strip, some a totals row, some pagination).
 * This component composes those pieces in ONE fixed order that mirrors Broadcom
 * Rally's Iteration Status screen, and OWNS the shared state (client-side
 * pagination + row selection), so a page only declares its columns, rows,
 * metrics, filters and bulk actions.
 *
 * Fixed layout (top → bottom):
 *   header?            — title bar (title + context selector); page-supplied
 *   metrics?           — a MetricStrip of KPI cards
 *   PageToolbar        — search · actions · Show Filters · Show Fields
 *   BulkActionBar      — only when ≥1 row selected
 *   DataTableFrame     — sticky sortable header + selection gutter + totals
 *                        + body rows + pagination footer
 *
 * State ownership: the scaffold paginates `items` client-side and derives the
 * selection over the *visible page*. The page receives per-row selection wiring
 * via `renderRow`'s `gutter` node and the whole `RowSelection` via `bulkActions`.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import { BulkActionBar } from '@/shared/ui/bulk-action-bar'
import { type DataTableFrameHeader, DataTableFrame } from '@/shared/ui/table/data-table-frame'
import { PageToolbar, type PageToolbarSearch } from '@/shared/ui/page-toolbar'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { RowGutter } from '@/shared/ui/row-gutter'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'
import { useRowSelection, type RowSelection } from '@/shared/lib/hooks/use-row-selection'
import type { DataTableSort } from '@/shared/ui/data-table-header'

/** Optional totals row config — pass formatted values keyed by column. */
export interface ListPageTotals {
  label?: ReactNode
  values?: Record<string, ReactNode>
}

export interface ListPageScaffoldProps<Row extends { id: string }, K extends string> {
  // ── Chrome slots ───────────────────────────────────────────────────────────
  /** Title bar rendered above the metric strip (page-supplied, e.g. ListPageHeader). */
  header?: ReactNode
  /** A `<MetricStrip>` of KPI cards. */
  metrics?: ReactNode
  /** Toolbar search field. */
  search: PageToolbarSearch
  /** Primary action(s) — e.g. an "+ Add" button. */
  actions?: ReactNode
  /** Filter controls revealed under the "Show Filters" toggle. */
  filters?: ReactNode
  /** Active filter count (badge on the toggle; also auto-opens the panel). */
  activeFilterCount?: number
  /** "Show Fields" column menu. */
  fields?: ReactNode
  /**
   * Whether rows are multi-selectable (renders the checkbox gutter + bulk bar).
   * Default `true`. Set `false` for read-only lists with no bulk operations
   * (e.g. Iterations, whose lifecycle is commit/accept, not delete) — then no
   * selection gutter is shown and `renderRow`'s `gutter` is empty.
   */
  selectable?: boolean
  /** Bulk actions rendered inside the BulkActionBar; receives live selection. */
  bulkActions?: (selection: RowSelection) => ReactNode
  /** Inline error surfaced by a failed bulk action. */
  bulkError?: string | null

  // ── Grid ─────────────────────────────────────────────────────────────────
  /** `useDataTable().headerProps`. */
  headerProps: DataTableFrameHeader<K>
  /** Click-to-sort wiring for the header. */
  sort?: DataTableSort
  /** `useDataTable().headerColumns` (used for totals-cell alignment). */
  headerColumns: readonly { key: K; align?: 'center' | 'right' }[]
  /** `useDataTable().colStyles` (used for totals-cell widths). */
  colStyles: Record<string, CSSProperties>
  /** Horizontal padding for header/totals bars. Match the row padding. */
  padClassName?: string
  /** Optional totals row (rendered under the header when there are rows). */
  totals?: ListPageTotals

  // ── Data + rows ────────────────────────────────────────────────────────────
  /** The fully filtered + sorted list (the scaffold paginates it). */
  items: Row[]
  loading?: boolean
  error?: ReactNode
  empty?: ReactNode
  skeleton?: { rows?: number; cols?: number }
  /**
   * Render one body row. Receives the per-row selection `gutter` node (an inert
   * grip + selection checkbox) to place at the start of the row so every grid's
   * columns stay aligned under the shared header.
   */
  renderRow: (row: Row, ctx: { gutter: ReactNode; selected: boolean }) => ReactNode
  /** Initial rows-per-page (default 25). */
  initialPageSize?: number
}

export function ListPageScaffold<Row extends { id: string }, K extends string>({
  header,
  metrics,
  search,
  actions,
  filters,
  activeFilterCount = 0,
  fields,
  selectable = true,
  bulkActions,
  bulkError,
  headerProps,
  sort,
  headerColumns,
  colStyles,
  padClassName,
  totals,
  items,
  loading = false,
  error,
  empty,
  skeleton,
  renderRow,
  initialPageSize = 25,
}: ListPageScaffoldProps<Row, K>) {
  // ── Client-side pagination ──────────────────────────────────────────────────
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [currentPage, setCurrentPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(currentPage, pageCount)
  const paged = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  )

  // ── Selection over the visible page (only when selectable) ───────────────────
  const selection = useRowSelection(paged)
  const leadingSelectAll = selectable ? (
    <RowGutter
      dragDisabled
      checkbox={{
        checked: selection.allSelected,
        indeterminate: selection.someSelected,
        onChange: selection.toggleAll,
        ariaLabel: 'Select all',
      }}
    />
  ) : undefined

  const hasRows = !loading && !error && items.length > 0

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {header}
      {metrics}

      <PageToolbar
        search={search}
        actions={actions}
        filters={filters}
        activeFilterCount={activeFilterCount}
        defaultFiltersOpen={activeFilterCount > 0}
        fields={fields}
      />

      {selectable && selection.count > 0 && (
        <BulkActionBar selectedCount={selection.count} error={bulkError} onClear={selection.clear}>
          {bulkActions?.(selection)}
        </BulkActionBar>
      )}

      <DataTableFrame
        header={{ ...headerProps, sort }}
        padClassName={padClassName}
        leading={leadingSelectAll}
        loading={loading}
        skeleton={skeleton}
        error={error}
        empty={empty}
        totals={
          hasRows && totals ? (
            <TableTotalsRow
              columns={headerColumns.map((c) => ({ key: c.key, align: c.align }))}
              colStyles={colStyles}
              leading={leadingSelectAll}
              label={totals.label}
              values={totals.values}
            />
          ) : undefined
        }
        footer={
          hasRows ? (
            <PaginationFooter
              pageSize={pageSize}
              setPageSize={(n) => {
                setPageSize(n)
                setCurrentPage(1)
              }}
              currentPage={page}
              rangeStart={(page - 1) * pageSize + 1}
              rangeEnd={(page - 1) * pageSize + paged.length}
              total={items.length}
              pageCount={pageCount}
              hasPrevPage={page > 1}
              hasNextPage={page < pageCount}
              onPrevPage={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
            />
          ) : undefined
        }
      >
        {paged.map((row) =>
          renderRow(row, {
            selected: selectable && selection.isSelected(row.id),
            gutter: selectable ? (
              <RowGutter
                dragDisabled
                stopPropagation
                checkbox={{
                  checked: selection.isSelected(row.id),
                  onChange: () => selection.toggle(row.id),
                  ariaLabel: 'Select row',
                }}
              />
            ) : null,
          }),
        )}
      </DataTableFrame>
    </div>
  )
}
