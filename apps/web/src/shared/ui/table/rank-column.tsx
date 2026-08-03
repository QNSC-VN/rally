import { cn } from '@/shared/lib/utils'

import type { ColumnSpec } from './types'

/**
 * `Rank` — the row's position in the grid's stored order, as ONE column definition.
 *
 * Six rank-ordered grids had four different answers to what Rank looks like. Three rendered a
 * column, at 60 / 60 / 64px and centred / right / right; two put the number in the leading gutter
 * with a bespoke `RankSortHeader` beside the select-all box; the Portfolio Children tab showed
 * nothing at all while still dragging to reorder.
 *
 * The BA specifies a COLUMN, twice — Backlog's "Sort icon on Rank, Type, ID, Name…"
 * (`01_Backlog_Enhancement/SRS.md`) and Iteration Status's "List columns are: selection checkbox,
 * rank, ID, Type, Name…" (P2-IS-FR-018). The gutter placement was the deviation, and
 * `RankSortHeader` existed only to give it a sort affordance the real header already provides.
 *
 * A column also gets resize, reorder and show/hide for free, which the gutter could never have.
 *
 * NOTE the value is the row's 1-based POSITION, not `rank` itself: that column stores a LexoRank
 * string (`a0001`), which sorts as text and means nothing to a reader.
 *
 * Release Tracking deliberately does NOT use this: its header needs 72px for "Rank" plus the sort
 * caret (see the note there, added when it truncated to "Ran…"). Its label is also translated,
 * where every other grid's is literal. Spread this and override rather than forking it if a grid
 * needs the same.
 */
export const RANK_COLUMN_WIDTH = 60
export const RANK_COLUMN_MIN_WIDTH = 52

/** The canonical spec. Spread into a grid's column array as its first entry. */
export function rankColumn<Row, Ctx>(): ColumnSpec<Row, Ctx, 'rank'> {
  return {
    key: 'rank',
    label: 'Rank',
    defaultWidth: RANK_COLUMN_WIDTH,
    minWidth: RANK_COLUMN_MIN_WIDTH,
    align: 'right',
    sortCol: 'rank',
    // Locked: rank is the order every other column is read against, so it stays leftmost.
    locked: true,
  }
}

/**
 * The body cell for {@link rankColumn} — right-aligned, monospaced, tabular.
 *
 * Right, not centred: it is a number read down a column, and `tabular-nums` only lines up if the
 * cells share an edge. Iteration Status centred it and the digits wandered.
 */
export function RankCell({
  rowNum,
  actions,
  style,
  className,
}: {
  /** 1-based position in the CURRENT list, including any page offset. */
  rowNum: number
  /**
   * Reorder controls rendered AFTER the number, inside the same cell.
   *
   * Portfolio Items ranks this way — "up/down reorder buttons only, no drag-and-drop" (SRS §37) —
   * and the controls belong in the Rank cell because that is the number they change. A grid that
   * drags passes nothing and gets the plain number it always had.
   */
  actions?: React.ReactNode
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <div
      style={style}
      className={cn(
        'flex shrink-0 items-center justify-end gap-0.5 px-2 font-mono text-ui-xs text-muted-foreground tabular-nums',
        className,
      )}
    >
      {rowNum}
      {actions}
    </div>
  )
}
