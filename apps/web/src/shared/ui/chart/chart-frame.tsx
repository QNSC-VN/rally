/**
 * The shared chart shell — one place that owns axis, grid, tooltip and legend styling for
 * every chart in the app.
 *
 * Before Phase 6 there was exactly one recharts consumer (the old Reports dashboard) and no
 * abstraction, so its tick sizes, grid stroke and tooltip border were written inline. Four
 * chart surfaces arrive with Phase 6 (Burndown, Velocity, the Release burnup, and whatever
 * follows), and four copies of `tick={{ fontSize: 9, fill: … }}` is exactly how the tables
 * drifted apart before `DataTableFrame` existed.
 *
 * Series colours are NOT defined here — a caller passes them from `BRAND.report*`, because
 * which measure is teal and which is green is a contract with the BA, not a chart default.
 */
import type { ReactElement, ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'

import { BRAND } from '@/shared/config/brand'
import { EmptyState } from '@/shared/ui/empty-state'

/** Axis/tick defaults, spread onto `<XAxis>` / `<YAxis>` so every chart matches. */
export const CHART_AXIS = {
  tick: { fontSize: 10, fill: BRAND.textSecondary },
  axisLine: { stroke: BRAND.border },
  tickLine: false,
} as const

/** Grid defaults. */
export const CHART_GRID = { stroke: BRAND.reportGrid, strokeDasharray: '3 3' } as const

/** Tooltip container, matching the app's popovers rather than recharts' default. */
export const CHART_TOOLTIP = {
  fontSize: 11,
  border: `1px solid ${BRAND.border}`,
  borderRadius: 3,
  backgroundColor: BRAND.surface,
  color: BRAND.textPrimary,
} as const

/** An axis label, positioned the way the mockup's rotated captions are. */
export function axisLabel(value: string, side: 'left' | 'right' | 'bottom') {
  const style = { fontSize: 10, fill: BRAND.textSecondary } as const
  if (side === 'bottom') return { value, position: 'insideBottom' as const, offset: -4, style }
  return {
    value,
    angle: side === 'left' ? (-90 as const) : (90 as const),
    position: side === 'left' ? ('insideLeft' as const) : ('insideRight' as const),
    style,
  }
}

/**
 * A titled chart card with a fixed height and an explicit empty state.
 *
 * `isEmpty` is a required decision rather than a derived one: every Phase 6 report has to
 * distinguish "no data" from "zero", and the cross-report contract forbids rendering the
 * second as the first. The caller knows which of its several empty reasons applies, so it
 * supplies the message.
 */
export function ChartFrame({
  title,
  subtitle,
  actions,
  height = 360,
  isEmpty = false,
  emptyTitle,
  emptyDescription,
  legend,
  footer,
  children,
}: {
  title?: ReactNode
  /** The centred, bold context line — `{Project} - {Team|All Teams}` on Burndown (IB §7). */
  subtitle?: ReactNode
  actions?: ReactNode
  height?: number
  isEmpty?: boolean
  emptyTitle?: string
  emptyDescription?: string
  legend?: ReactNode
  footer?: ReactNode
  /** A single recharts chart element. */
  children: ReactElement
}) {
  return (
    <div className="rounded border border-border-strong bg-card p-4">
      {(title != null || actions != null) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title != null && <p className="text-ui-sm font-semibold text-foreground">{title}</p>}
          {actions}
        </div>
      )}
      {subtitle != null && (
        <div className="mb-3 text-center text-ui-lg font-semibold text-foreground">{subtitle}</div>
      )}
      {isEmpty ? (
        <div className="flex items-center justify-center" style={{ height }}>
          <EmptyState title={emptyTitle ?? ''} description={emptyDescription} />
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
      {!isEmpty && legend != null && <ChartLegendBar>{legend}</ChartLegendBar>}
      {footer}
    </div>
  )
}

/** The bordered strip the mockup puts the burndown legend in. */
export function ChartLegendBar({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded border border-border-subtle bg-background px-3 py-2.5 text-ui-xs text-muted-foreground">
      {children}
    </div>
  )
}

/** One legend entry: a swatch (bar) or a rule (line) plus its series name. */
export function ChartLegendItem({
  color,
  label,
  shape = 'bar',
}: {
  color: string
  label: ReactNode
  shape?: 'bar' | 'line'
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={shape === 'bar' ? 'h-2.5 w-2.5 rounded-sm' : 'h-0.5 w-4'}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}
