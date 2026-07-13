import type { DropIndicator } from '@/shared/lib/hooks/use-column-drag'
import { ResizeHandle } from '@/shared/ui/resize-handle'

/**
 * Visual design tokens for the drag indicator line.
 * Centralised so every table page shares the exact same look.
 * Brand navy (matches --primary in globals.css), not Fluent blue.
 */
const INDICATOR_COLOR = '#1d3f73'
const INDICATOR_GLOW = '0 0 6px rgba(29,63,115,0.45)'

interface HeaderCellProps<K extends string> {
  colKey: K
  label: string
  style: React.CSSProperties
  /** Right-aligned columns get `justify-end text-right`. */
  isRight?: boolean
  /** True while this column is being dragged (semi-transparent). */
  isDragging?: boolean
  /** Show the blue insertion line at the LEFT edge. */
  indicatorBefore?: boolean
  /** Show the blue insertion line at the RIGHT edge. */
  indicatorAfter?: boolean
  /** Fires on the cell's `dragOver` (drop target from Show Fields menu). */
  onDragOver?: (key: K, e: React.DragEvent) => void
  /** Fires on the cell's `dragLeave`. */
  onDragLeave?: (e: React.DragEvent) => void
  /** Fires on the cell's `drop`. */
  onDrop?: (e: React.DragEvent) => void
  /** Fires on the ResizeHandle's `mouseDown`. */
  onResize: (key: K, e: React.MouseEvent) => void
  /**
   * Optional override for the drop indicator — useful when the parent
   * computes indicator state from a different source (e.g. ColumnFieldsMenu).
   */
  dropIndicator?: DropIndicator<K> | null
}

/**
 * `<HeaderCell>` — a single column header with:
 *
 * 1. **Drop indicator** — a 2 px blue line with glow that appears at the
 *    left or right edge when a column is being dragged via Show Fields.
 * 2. **Drag feedback** — the dragged header becomes 35 % opaque.
 * 3. **Resize handle** — delegates to the existing `<ResizeHandle>`.
 *
 * This component is generic over the column key type so it can be used
 * by Team Status, Iteration Status, Backlog, Releases, etc.
 */
export function HeaderCell<K extends string>({
  colKey,
  label,
  style,
  isRight = false,
  isDragging = false,
  indicatorBefore = false,
  indicatorAfter = false,
  onDragOver,
  onDragLeave,
  onDrop,
  onResize,
}: HeaderCellProps<K>) {
  return (
    <div
      className={`group relative flex shrink-0 items-center gap-1 px-2 ${
        isRight ? 'justify-end text-right' : ''
      }`}
      style={{
        ...style,
        opacity: isDragging ? 0.35 : 1,
        transition: 'opacity 0.15s ease',
      }}
      onDragOver={onDragOver ? (e) => onDragOver(colKey, e) : undefined}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      role="columnheader"
      aria-label={`${label} column`}
    >
      {/* ── Left drop indicator ── */}
      {indicatorBefore && (
        <div
          className="absolute top-1 bottom-1 left-0 z-30 w-[2px] -translate-x-px rounded-full"
          style={{ backgroundColor: INDICATOR_COLOR, boxShadow: INDICATOR_GLOW }}
        />
      )}

      {/* ── Label ── */}
      <span className="truncate select-none">{label}</span>

      {/* ── Resize handle ── */}
      <ResizeHandle onMouseDown={(e) => onResize(colKey, e)} ariaLabel={`Resize ${label} column`} />

      {/* ── Right drop indicator ── */}
      {indicatorAfter && (
        <div
          className="absolute top-1 right-0 bottom-1 z-30 w-[2px] translate-x-px rounded-full"
          style={{ backgroundColor: INDICATOR_COLOR, boxShadow: INDICATOR_GLOW }}
        />
      )}
    </div>
  )
}
