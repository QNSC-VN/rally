/**
 * TableTotalsRow — the single, shared "Totals" footer row for every data grid.
 *
 * Before this existed, each page (Tasks tab, Team Status, Iteration Status)
 * hand-rolled its own totals row, so they drifted apart constantly — different
 * heights, colours, the "Totals" label under a different column, some missing a
 * label entirely. This component is the source of truth for that row's layout
 * and styling, so pages only supply the numbers.
 *
 * Alignment guarantee: pass the SAME ordered column list and `colStyles` object
 * used by <DataTableHeader>, plus the exact same `leading` node — every cell
 * then lines up under its header column automatically.
 *
 * The "Totals" label sits in the label column (the first column / Rank by
 * default), left-aligned. Value cells are keyed by column and right-aligned +
 * monospaced when that column is `align: 'right'`.
 */
import type { CSSProperties, ReactNode } from 'react'

import { BRAND } from '@/shared/config/brand'
import { cn } from '@/shared/lib/utils'

export interface TotalsColumn {
  key: string
  align?: 'left' | 'center' | 'right'
}

export interface TableTotalsRowProps {
  /** Ordered columns — MUST match the header's column order so cells line up. */
  columns: readonly TotalsColumn[]
  /** Per-column width styles — the same object passed to <DataTableHeader>. */
  colStyles: Record<string, CSSProperties>
  /** Leading gutter — pass the exact node used for the header's `leading`. */
  leading?: ReactNode
  /** Label shown in the label column (e.g. "Totals" or "Totals (3)"). */
  label?: ReactNode
  /** Column the label sits under. Defaults to the first column (Rank). */
  labelColKey?: string
  /** Formatted values keyed by column key — units included, e.g. "5h". */
  values?: Record<string, ReactNode>
  className?: string
}

export function TableTotalsRow({
  columns,
  colStyles,
  leading,
  label,
  labelColKey,
  values,
  className,
}: TableTotalsRowProps) {
  const labelKey = labelColKey ?? columns[0]?.key

  return (
    <div
      className={cn('flex h-8 items-center px-3 text-ui-md font-semibold', className)}
      style={{
        backgroundColor: BRAND.surfaceSubtle,
        borderBottom: `1px solid ${BRAND.borderInput}`,
        color: BRAND.textPrimary,
        minWidth: 'max-content',
      }}
    >
      {leading}
      {columns.map((col) => {
        const isLabel = col.key === labelKey
        return (
          <div
            key={col.key}
            className={cn(
              'shrink-0 px-2 whitespace-nowrap',
              !isLabel && col.align === 'right' && 'text-right font-mono',
              !isLabel && col.align === 'center' && 'text-center',
            )}
            style={colStyles[col.key]}
          >
            {isLabel ? label : values?.[col.key]}
          </div>
        )
      })}
    </div>
  )
}
