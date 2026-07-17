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
const HEADER_TEXT = '#4b5563'
const SEPARATOR = '#d0d5dd'
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
        height: 34,
        backgroundColor: HEADER_BG,
        borderBottom: `1px solid ${HEADER_BORDER}`,
        fontSize: 11,
        fontWeight: 700,
        color: HEADER_TEXT,
        minWidth: 'max-content',
      }}
    >
      {leading}
      {columns.map((col) => (
        <HeaderColumn
          key={col.key}
          column={col}
          style={colStyles[col.key]}
          onResize={onResize}
          sort={sort}
          columnDrag={columnDrag}
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
}

function HeaderColumn<K extends string>({
  column,
  style,
  onResize,
  sort,
  columnDrag,
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
        borderRight: `1px solid ${SEPARATOR}`,
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
  return (
    <div
      className="group/sort flex cursor-pointer items-center gap-1 select-none"
      style={{ justifyContent: rightAlign ? 'flex-end' : 'flex-start', width: '100%' }}
      onClick={() => onSort(col)}
    >
      <span
        style={{
          color: isActive ? BRAND.primaryLight : HEADER_TEXT,
          fontWeight: 700,
          whiteSpace: 'nowrap',
        }}
        className="transition-colors duration-150 group-hover/sort:text-slate-800"
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
    </div>
  )
}
