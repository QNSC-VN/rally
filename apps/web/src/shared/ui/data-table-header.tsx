import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import type { DropIndicator } from '@/shared/lib/hooks/use-column-drag'
import { ResizeHandle } from '@/shared/ui/resize-handle'

/**
 * Shared design tokens for the sticky table header — single source of truth for
 * every work-item grid (Iteration Status, Backlog, Team Status). Keeping them
 * here guarantees the header bar, separators and drop-indicator look identical
 * across pages.
 */
const HEADER_BG = BRAND.pageBg
const HEADER_BORDER = BRAND.avatarBg
const HEADER_TEXT = BRAND.textSecondary
const SEPARATOR = BRAND.border
const INDICATOR_COLOR = BRAND.primary
const INDICATOR_GLOW = '0 0 6px rgba(29,63,115,0.45)'

/** Column descriptor consumed by {@link DataTableHeader}. */
export interface DataTableHeaderColumn<K extends string> {
  key: K
  label: string
  /** When set, the header cell is click-to-sort and shows a direction arrow. */
  sortCol?: string
  align?: 'center' | 'right'
}

/** Optional click-to-sort wiring. */
export interface DataTableSort {
  col: string | null
  dir: 'asc' | 'desc'
  onSort: (col: string) => void
}

/** Optional native HTML5 column drag-to-reorder wiring (from `useColumnDrag`). */
export interface DataTableColumnDrag<K extends string> {
  activeDragKey: K | null
  dropIndicator: DropIndicator<K> | null
  onDragStart: (key: K, e: React.DragEvent) => void
  onDragOver: (key: K, e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}

interface DataTableHeaderProps<K extends string> {
  columns: DataTableHeaderColumn<K>[]
  /** Per-column CSS from `useColumnLayout().styleFor` (width + order + hidden). */
  colStyles: Record<string, React.CSSProperties>
  onResize: (key: K, e: React.MouseEvent) => void
  /**
   * Page-specific leading cells rendered before the columns — e.g. a
   * select-all checkbox, a row-rerank grip spacer, a row-number column or an
   * expand/collapse spacer. Kept as a slot because each grid differs here.
   */
  leading?: React.ReactNode
  /** Enables click-to-sort headers. Omit for non-sortable grids. */
  sort?: DataTableSort
  /** Enables column drag-to-reorder. Omit to disable. */
  columnDrag?: DataTableColumnDrag<K>
  /** Extra classes for the outer bar (used for per-page horizontal padding). */
  className?: string
}

/**
 * `<DataTableHeader>` — the single, reusable sticky header row shared by every
 * work-item grid. It renders (in order): the page-specific `leading` slot, then
 * one {@link HeaderColumn} per column with consistent separators, optional
 * click-to-sort, resize handle and column drag-reorder + drop indicators.
 */
export function DataTableHeader<K extends string>({
  columns,
  colStyles,
  onResize,
  leading,
  sort,
  columnDrag,
  className,
}: DataTableHeaderProps<K>) {
  return (
    <div
      className={`sticky top-0 z-10 flex items-center select-none ${className ?? ''}`}
      style={{
        // Taller than the 34px body rows so the header has breathing room above
        // and below the label and reads as a distinct header band, not just
        // another row. Shared across every table.
        height: 40,
        backgroundColor: HEADER_BG,
        borderBottom: `1px solid ${HEADER_BORDER}`,
        // 12px so the header is never smaller than the densest body rows
        // (some grids render rows at text-ui-md/12px); a header must read as
        // >= its body.
        fontSize: 12,
        fontWeight: 700,
        color: HEADER_TEXT,
        minWidth: 'max-content',
      }}
    >
      {leading}
      {columns.map((col, i) => (
        <HeaderColumn
          key={col.key}
          column={col}
          style={colStyles[col.key]}
          onResize={onResize}
          sort={sort}
          columnDrag={columnDrag}
          isLast={i === columns.length - 1}
        />
      ))}
    </div>
  )
}

interface HeaderColumnProps<K extends string> {
  column: DataTableHeaderColumn<K>
  style: React.CSSProperties
  onResize: (key: K, e: React.MouseEvent) => void
  sort?: DataTableSort
  columnDrag?: DataTableColumnDrag<K>
  /** The last column omits its right separator so the trailing header
   *  background isn't boxed into a phantom empty column on narrow tables. */
  isLast?: boolean
}

function HeaderColumn<K extends string>({
  column,
  style,
  onResize,
  sort,
  columnDrag,
  isLast,
}: HeaderColumnProps<K>) {
  const before =
    columnDrag?.dropIndicator?.type === 'before' && columnDrag.dropIndicator.key === column.key
  const after =
    columnDrag?.dropIndicator?.type === 'after' && columnDrag.dropIndicator.key === column.key
  const dragging = columnDrag?.activeDragKey === column.key
  const align =
    column.align === 'center'
      ? 'justify-center text-center'
      : column.align === 'right'
        ? 'justify-end text-right'
        : ''

  const dragProps = columnDrag
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          // Never hijack a column-resize drag started on the resize handle.
          if ((e.target as HTMLElement).closest('[role="separator"]')) {
            e.preventDefault()
            return
          }
          columnDrag.onDragStart(column.key, e)
        },
        onDragOver: (e: React.DragEvent) => columnDrag.onDragOver(column.key, e),
        onDragLeave: columnDrag.onDragLeave,
        onDrop: columnDrag.onDrop,
        onDragEnd: columnDrag.onDragEnd,
      }
    : {}

  return (
    <div
      style={{
        ...style,
        borderRight: isLast ? undefined : `1px solid ${SEPARATOR}`,
        opacity: dragging ? 0.4 : 1,
        cursor: columnDrag ? 'grab' : undefined,
      }}
      className={`group relative flex items-center px-2 ${align}`}
      aria-label={`${column.label} column`}
      {...dragProps}
    >
      {before && (
        <div
          className="pointer-events-none absolute inset-y-1 left-0 z-30 w-[2px] -translate-x-px rounded-full"
          style={{ backgroundColor: INDICATOR_COLOR, boxShadow: INDICATOR_GLOW }}
        />
      )}
      {column.sortCol && sort ? (
        <SortHeader
          label={column.label}
          col={column.sortCol}
          activeCol={sort.col}
          dir={sort.dir}
          onSort={sort.onSort}
          rightAlign={column.align === 'right'}
        />
      ) : (
        <span className="truncate">{column.label}</span>
      )}
      <ResizeHandle
        onMouseDown={(e) => onResize(column.key, e)}
        ariaLabel={`Resize ${column.label} column`}
      />
      {after && (
        <div
          className="pointer-events-none absolute inset-y-1 right-0 z-30 w-[2px] translate-x-px rounded-full"
          style={{ backgroundColor: INDICATOR_COLOR, boxShadow: INDICATOR_GLOW }}
        />
      )}
    </div>
  )
}

interface SortHeaderProps {
  label: string
  col: string
  activeCol: string | null
  dir: 'asc' | 'desc'
  onSort: (col: string) => void
  rightAlign?: boolean
}

function SortHeader({ label, col, activeCol, dir, onSort, rightAlign }: SortHeaderProps) {
  const isActive = activeCol === col
  /**
   * The current state, spoken.
   *
   * A caret is the only thing that conveyed the sort direction, so a screen-reader user was told
   * "Rank" and nothing else — not that the column was sortable, and not which way it was sorted.
   * `aria-sort` is the usual answer and is deliberately NOT used: it is only meaningful on a
   * `columnheader`, and these grids are divs with no `table`/`row` ancestry (`DataTableFrame` renders
   * a scroll container and each page renders its own rows). Adding the role here alone would
   * announce a one-row table, which is worse than no table semantics. The label carries the state
   * instead, which is true regardless of the surrounding structure.
   */
  const state = isActive ? (dir === 'asc' ? 'sorted ascending' : 'sorted descending') : 'not sorted'

  return (
    <button
      type="button"
      /**
       * A real `<button>`, because this is the only control for a documented feature (RT-AC-05:
       * "Rank, ID and Team sort both directions") and it was a `div` with `onClick` — unreachable by
       * Tab, unusable by Enter or Space, and invisible to assistive tech. Every grid in the app
       * shares this header, so every sortable column was mouse-only.
       *
       * `bg-transparent border-none p-0` keeps the rendered result pixel-identical to the div it
       * replaces; the header cell owns the padding.
       */
      className="group/sort flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
      style={{ justifyContent: rightAlign ? 'flex-end' : 'flex-start', width: '100%' }}
      onClick={() => onSort(col)}
      aria-label={`${label}, ${state}. Activate to sort.`}
    >
      {/* TRUNCATES, like the non-sortable branch above. Without `min-w-0` + `truncate` a long label
          (`Planned Team Assignment` at 160px) overflowed its own column and printed on top of the
          next header — a flex item will not shrink below its content width unless told it may. The
          sort caret keeps `shrink-0`, so the label yields first and the affordance never disappears. */}
      <span
        title={label}
        style={{ color: isActive ? BRAND.primaryLight : HEADER_TEXT, fontWeight: 700 }}
        className="min-w-0 truncate transition-colors duration-150 group-hover/sort:text-slate-800"
      >
        {label}
      </span>
      {isActive ? (
        dir === 'desc' ? (
          <ChevronDown size={11} className="shrink-0 text-primary" />
        ) : (
          <ChevronUp size={11} className="shrink-0 text-primary" />
        )
      ) : (
        <ChevronsUpDown
          size={11}
          className="shrink-0 text-slate-400 transition-colors duration-150 group-hover/sort:text-slate-600"
        />
      )}
    </button>
  )
}
