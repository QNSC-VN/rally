import { type CSSProperties } from 'react'

import { MetricValue } from '@/shared/ui/metric-value'
import type { CapacityAllocation } from '@/features/capacity-planning/api'
import type { ItemColKey } from '../model/columns'

/**
 * One TEAM's slice of a Feature, nested under it on the Features tab — Rally's "each allocated
 * project is listed as a row underneath the portfolio item".
 *
 * Separate from `AllocationRow`, which is the same idea on the TEAM grid: that row is laid out
 * against `TeamColKey` and owns the inline estimate editor, the make-primary action and the delete.
 * This one reads against `ItemColKey` and is read-only, because the editing surface for an
 * allocation is the team it belongs to — showing two editors for one number invites a race between
 * them.
 *
 * No percentages: a Feature has no capacity, so a team's slice of it has no base to be a share of.
 */
export function ItemAllocationRow({
  allocation,
  teamName,
  colStyleFor,
}: {
  allocation: CapacityAllocation
  /** Resolved by the page from the plan's teams — an id makes a useless row label. */
  teamName: string | null
  colStyleFor: (key: ItemColKey, base?: CSSProperties) => CSSProperties
}) {
  const { metrics } = allocation

  return (
    <div className="flex min-h-[30px] items-center border-b border-border-inner bg-surface-subtle px-3 text-ui-md">
      <div style={colStyleFor('rank', { flexShrink: 0 })} />
      <div style={colStyleFor('id', { flexShrink: 0 })} />

      {/* The team is written in the NAME column, indented and marked — Rally nests these rows, and
          an indent plus the turnstile glyph is what says "part of the row above" without a second
          column that only child rows would ever fill. */}
      <div style={colStyleFor('name', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="flex min-w-0 items-center gap-1.5 pl-4 text-muted-foreground">
          <span aria-hidden>↳</span>
          <span className="truncate" title={teamName ?? undefined}>
            {teamName ?? '—'}
          </span>
        </span>
      </div>

      <div style={colStyleFor('project', { flexShrink: 0 })} />
      <div style={colStyleFor('assignment', { flexShrink: 0 })} />

      <div style={colStyleFor('complete', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={metrics.complete} pct={null} />
      </div>
      <div style={colStyleFor('rollup', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={metrics.rollup} pct={null} />
      </div>
      <div style={colStyleFor('estimated', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={metrics.estimated} pct={null} />
      </div>
    </div>
  )
}
