import { useCallback, useMemo } from 'react'

import { useColumnDrag } from '@/shared/lib/hooks/use-column-drag'
import { useColumnLayout } from '@/shared/lib/hooks/use-column-layout'
import {
  type DataTableColumnDrag,
  type DataTableHeaderColumn,
  type DataTableSort,
} from '@/shared/ui/data-table-header'

import { type ColStyleMap, type ColumnSpec, toColumnDef } from './types'

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
  const renderCells = useCallback(
    (row: Row, ctx: Ctx) =>
      columns.map((c) => (
        <div key={c.key} style={colStyles[c.key]} className={c.cellClassName}>
          {c.cell(row, ctx)}
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
