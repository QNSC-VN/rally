import type { CSSProperties, ReactNode } from 'react'

import type { ColumnDef } from '@/shared/lib/hooks/use-column-layout'

/**
 * `ColumnSpec` — the single per-column source of truth for a config-driven grid.
 *
 * It is a superset of {@link ColumnDef} (the layout/resize/visibility contract),
 * adding the presentation concerns a table needs: how the header aligns/sorts and
 * how each body cell renders. A page declares ONE array of these; the
 * {@link useDataTable} engine derives the header descriptors, per-column styles,
 * the Show-Fields menu wiring and the row cells from it — so behaviour is
 * identical across every grid and adding a field is a one-line change.
 *
 * @typeParam Row - the row data shape for this grid (e.g. a defect / work item).
 * @typeParam Ctx - per-render context handed to each cell (callbacks, perms, lookups).
 * @typeParam K   - the string-literal union of column keys for this grid.
 */
export interface ColumnSpec<Row, Ctx, K extends string = string> {
  /** Stable column identifier; also the persistence + reorder key. */
  key: K
  /** Header label. */
  label: string
  /** Initial width in px (used until the user resizes). */
  defaultWidth: number
  /** Minimum resize width in px. */
  minWidth?: number
  /** When true the column cannot be hidden via the Show-Fields menu (e.g. ID/Name). */
  locked?: boolean
  /** Header + (via `cellClassName`) body horizontal alignment. */
  align?: 'center' | 'right'
  /** When set, the header cell is click-to-sort and shows a direction arrow. */
  sortCol?: string
  /** Renders the body cell for a given row. */
  cell: (row: Row, ctx: Ctx) => ReactNode
  /**
   * Extra classes for the body-cell wrapper `<div>` (padding/flex/alignment).
   * The engine always applies the resolved width/order/visibility style on top.
   */
  cellClassName?: string
}

/** Narrowing helper: the {@link ColumnDef} slice the layout hook consumes. */
export function toColumnDef<Row, Ctx, K extends string>(
  spec: ColumnSpec<Row, Ctx, K>,
): ColumnDef<K> {
  return {
    key: spec.key,
    label: spec.label,
    defaultWidth: spec.defaultWidth,
    minWidth: spec.minWidth,
    locked: spec.locked,
  }
}

/** A resolved per-column CSS map (width + flex + order + hidden), keyed by column. */
export type ColStyleMap<K extends string> = Record<K, CSSProperties>

/** Convenience alias for the rendered ordered cell list. */
export type RenderedCells = ReactNode
