/**
 * ReportSurface — the one card frame every Reports type renders inside.
 *
 * Phase 6 shipped three reports with three different compositions: Burndown and Velocity each
 * hand-assembled a `ChartFrame` actions row, Team Capacity hand-rolled its own card + a
 * `flex gap-8` metric row, and none of them agreed on where the title, the scope caption or the
 * per-report control sat. Switching `Type` therefore moved the iteration picker, the heading and
 * the KPI numbers to a different place on every selection — the drift `DataTableFrame` and
 * `MetricStrip` were each written to end, reappearing one layer up.
 *
 * The contract:
 *   `[title] [caption]` left, `controls` right, an optional full-bleed `strip` of MetricCards
 *   beneath, then the body. A table body gets a flush edge-to-edge frame; a chart body sits on
 *   the card's own padding. Reports only supply content.
 *
 * `ChartFrame` still owns axis/grid/tooltip/legend styling — this owns the chrome AROUND the
 * chart, so the two compose rather than compete.
 */
import type { ReactNode } from 'react'

import { SkeletonList } from '@/shared/ui/skeleton'

export function ReportSurface({
  title,
  caption,
  controls,
  strip,
  children,
  /** Charts need the card's padding; tables render their own edge-to-edge frame. */
  padBody = false,
  loading = false,
}: {
  title: ReactNode
  /** Muted provenance line beside the title (e.g. "Team Status hours"). */
  caption?: ReactNode
  /** Per-report controls, right-aligned (iteration picker, window select, fields menu). */
  controls?: ReactNode
  /** Optional KPI strip rendered full-bleed under the header. */
  strip?: ReactNode
  children: ReactNode
  padBody?: boolean
  /**
   * Swap the BODY for a skeleton while keeping the header, controls and strip mounted.
   * The chart reports used to early-return a bare `<SkeletonList>` instead, so switching
   * `Type` or changing the iteration blanked the whole card — title, picker and all — then
   * popped them back. `DataTableFrame` already draws its header through a load for the same
   * reason; this gives the chart reports that behaviour.
   */
  loading?: boolean
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border-strong bg-card">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <p className="truncate text-ui-sm font-semibold text-foreground">{title}</p>
          {caption != null && (
            <>
              <div className="h-4 w-px shrink-0 bg-border" />
              <span className="truncate text-ui-xs text-foreground-subtle">{caption}</span>
            </>
          )}
        </div>
        {controls != null && <div className="flex shrink-0 items-center gap-2">{controls}</div>}
      </div>

      {strip}

      <div className={`flex min-h-0 flex-1 flex-col ${padBody ? 'p-4' : ''}`}>
        {loading ? <SkeletonList rows={6} cols={3} /> : children}
      </div>
    </div>
  )
}
