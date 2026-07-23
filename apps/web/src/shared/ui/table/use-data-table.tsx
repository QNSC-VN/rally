import { useCallback, useMemo, type ReactNode } from 'react'

import { useColumnDrag } from '@/shared/lib/hooks/use-column-drag'
import { useColumnLayout } from '@/shared/lib/hooks/use-column-layout'
import {
  type DataTableColumnDrag,
  type DataTableHeaderColumn,
  type DataTableSort,
} from '@/shared/ui/data-table-header'
import { DateField } from '@/shared/ui/date-field'
import { cn } from '@/shared/lib/utils'

import { type ColStyleMap, type ColumnSpec, toColumnDef } from './types'

/**
 * Built-in read-only renderer for a column's generic {@link ColumnSpec.type}
 * (used when the column declares no `cell`). Keeps date/number/text display
 * identical across every config-driven grid.
 */
function renderTypedCell<Row, Ctx, K extends string>(
  c: ColumnSpec<Row, Ctx, K>,
  row: Row,
): ReactNode {
  if (!c.type) return null
  const raw = c.accessor
    ? c.accessor(row)
    : (row as Record<string, unknown>)[c.key] as string | number | null | undefined
  switch (c.type) {
    case 'date':
      return <DateField value={raw == null ? null : String(raw)} readOnly />
    case 'number':
      return (
        <span className="w-full text-right font-mono text-ui-sm tabular-nums text-foreground">
          {raw ?? '—'}
        </span>
      )
    case 'text':
    default:
      return <span className="truncate text-ui-sm text-foreground">{raw ?? '—'}</span>
  }
}

interface UseDataTableOptions {
  /** localStorage key for column widths + order + visibility persistence. */
  storageKey: string
  /** Optional click-to-sort wiring, forwarded to the shared header. */
  sort?: DataTableSort
  /**
   * Combined px width of any page-specific leading cells rendered before the
   * columns (select-all checkbox, row-number gutter, expand spacer). Added to
   * the computed table width so the horizontal scroll region is correct.
   */
  leadingWidth?: number
}

/**
 * `useDataTable` — the headless engine that turns a {@link ColumnSpec} catalog
 * into everything a grid needs, wiring the shared column-layout + column-drag
 * hooks once so no page re-implements resize / reorder / show-hide / sort
 * plumbing. Returns ready-to-spread props for `<DataTableHeader>` and
 * `<ColumnFieldsMenu>`, plus `renderCells(row, ctx)` for the row body.
 *
 * Pages keep ownership of their own row *structure* (DnD wrapper, selection
 * checkbox, expand chevron, grouping) — only the per-column cells, header and
 * behaviour are centralised here.
 *
 * @typeParam Row - row data shape.
 * @typeParam Ctx - per-render context passed to each cell.
 * @typeParam K   - column-key union.
 */
export function useDataTable<Row, Ctx, K extends string>(
  columns: ColumnSpec<Row, Ctx, K>[],
  { storageKey, sort, leadingWidth = 0 }: UseDataTableOptions,
) {
  const columnDefs = useMemo(() => columns.map(toColumnDef), [columns])

  const { widths, startResize, order, hidden, toggleVisible, reorder, styleFor } = useColumnLayout(
    columnDefs,
    storageKey,
  )

  const {
    activeDragKey,
    dropIndicator,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  } = useColumnDrag<K>({ onReorder: reorder })

  const headerColumns = useMemo<DataTableHeaderColumn<K>[]>(
    () =>
      columns.map((c) => ({
        key: c.key,
        label: c.label,
        align: c.align,
        sortCol: c.sortCol,
      })),
    [columns],
  )

  const colStyles = useMemo<ColStyleMap<K>>(
    () => Object.fromEntries(columns.map((c) => [c.key, styleFor(c.key)])) as ColStyleMap<K>,
    [columns, styleFor],
  )

  const columnDrag = useMemo<DataTableColumnDrag<K>>(
    () => ({
      activeDragKey,
      dropIndicator,
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      onDragEnd: handleDragEnd,
    }),
    [
      activeDragKey,
      dropIndicator,
      handleDragStart,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleDragEnd,
    ],
  )

  const tableWidth = useMemo(() => {
    const cols = leadingWidth + order.reduce((sum, k) => (hidden.has(k) ? sum : sum + widths[k]), 0)
    return cols
  }, [leadingWidth, order, hidden, widths])

  const fieldsMenuProps = useMemo(
    () => ({ columns: columnDefs, order, hidden, onToggle: toggleVisible, onReorder: reorder }),
    [columnDefs, order, hidden, toggleVisible, reorder],
  )

  const headerProps = useMemo(
    () => ({ columns: headerColumns, colStyles, onResize: startResize, columnDrag, sort }),
    [headerColumns, colStyles, startResize, columnDrag, sort],
  )

  /**
   * Render the ordered, width/visibility-aware body cells for one row. Columns
   * are mapped in their declared array order; the CSS `order` carried by
   * `colStyles` reorders them visually (header + body must both be flex rows),
   * and hidden columns collapse via `display:none`.
   */
  // Base `px-2` matches the shared header's per-column padding so body cells
  // always align under their header label (tailwind-merge lets a column
  // override via its own `px-*` in `cellClassName`).
  const renderCells = useCallback(
    (row: Row, ctx: Ctx) =>
      columns.map((c) => (
        <div key={c.key} style={colStyles[c.key]} className={cn('px-2', c.cellClassName)}>
          {c.cell ? c.cell(row, ctx) : renderTypedCell(c, row)}
        </div>
      )),
    [columns, colStyles],
  )

  return {
    // layout state
    widths,
    order,
    hidden,
    toggleVisible,
    reorder,
    styleFor,
    startResize,
    // derived, ready-to-spread
    colStyles,
    headerColumns,
    columnDrag,
    fieldsMenuProps,
    headerProps,
    tableWidth,
    // body
    renderCells,
  }
}
