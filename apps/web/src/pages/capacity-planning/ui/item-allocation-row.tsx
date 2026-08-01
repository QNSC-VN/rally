import { type CSSProperties } from 'react'

import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('capacity')
  const { metrics } = allocation

  return (
    <div className="flex min-h-[30px] items-center border-b border-border-inner bg-surface-subtle px-3 text-ui-md">
      {/* EVERY column the header declares gets a cell, even the empty ones. `name` is the `grow`
          column, so a missing cell is not a gap at the end — `name` absorbs the width and shifts every
          cell after it out from under its own heading. */}
      <div style={colStyleFor('marker', { flexShrink: 0 })} />
      <div style={colStyleFor('rank', { flexShrink: 0 })} />
      <div style={colStyleFor('id', { flexShrink: 0 })} />

      {/* Rally labels the child row itself `↳ Allocation` and puts the TEAM in the Planned Team
          Assignment column, under its parent's own assignment. The label says what KIND of row this
          is; the team belongs in the column that answers "which team?" for every row on the tab. */}
      <div style={colStyleFor('name', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="flex min-w-0 items-center gap-1.5 pl-4 text-muted-foreground italic">
          <span aria-hidden>↳</span>
          <span className="truncate">{t('items.allocationRow')}</span>
        </span>
      </div>

      <div style={colStyleFor('assignment', { flexShrink: 0 })} className="min-w-0 px-2">
        <span
          className="break-words whitespace-normal text-foreground"
          title={teamName ?? undefined}
        >
          {teamName ?? '--'}
        </span>
      </div>

      <div style={colStyleFor('project', { flexShrink: 0 })} />
      <div style={colStyleFor('dependencies', { flexShrink: 0 })} />

      <div style={colStyleFor('rollup', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={metrics.rollup} pct={null} />
      </div>
      <div style={colStyleFor('estimated', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={metrics.estimated} pct={null} />
      </div>
      <div style={colStyleFor('complete', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={metrics.complete} pct={null} />
      </div>
      <div style={colStyleFor('actions', { flexShrink: 0 })} />
    </div>
  )
}
