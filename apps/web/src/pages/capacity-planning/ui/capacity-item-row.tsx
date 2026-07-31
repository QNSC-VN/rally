import { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import { IdCell } from '@/entities/work-item/ui/id-cell'
import { CompositeBar } from '@/shared/ui/composite-bar'
import { BRAND } from '@/shared/config/brand'
import { cn } from '@/shared/lib/utils'
import type { CapacityPlanItem } from '@/features/capacity-planning/api'
import { EstimateTierBadge } from './estimate-tier-badge'
import { type ItemColKey } from '../model/columns'

/**
 * One Feature on Rally's Items tab.
 *
 * The item-level counterpart to `AllocationRow`, which shows one team's slice. Both exist
 * because Rally reports a Feature's rollup ONCE on this tab while the team grid attributes it
 * per team — the same Feature legitimately shows different numbers on the two surfaces, and the
 * row that says which is which is the one the reader is looking at.
 *
 * Reuses `IdCell`, `CompositeBar` and `EstimateTierBadge` so a Feature reads identically here,
 * on the team grid, and on the Portfolio page.
 */
export function CapacityItemRow({
  item,
  position,
  unitLabel,
  primaryTeamName,
  belowCutline,
  colStyleFor,
  onOpenFeature,
}: {
  item: CapacityPlanItem
  /** 1-based rank position within this plan — the order the cutline accumulates down. */
  position: number
  unitLabel: string
  /** Name of the team that owns this Feature, resolved by the page from the plan's teams. */
  primaryTeamName: string | null
  /** Below the plan's cutline: this Feature does not fit the plan's total capacity. */
  belowCutline: boolean
  colStyleFor: (key: ItemColKey, base?: CSSProperties) => CSSProperties
  onOpenFeature: (portfolioItemId: string) => void
}) {
  const { t } = useTranslation('capacity')

  return (
    <div
      className={cn(
        'group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter',
        // Dimmed, not hidden: the commitment is real and still editable, and Rally's line
        // informs rather than gates.
        belowCutline && 'opacity-60',
      )}
      data-below-cutline={belowCutline || undefined}
    >
      <div
        style={colStyleFor('rank', { flexShrink: 0 })}
        className="px-2 text-right text-muted-foreground tabular-nums"
      >
        {position}
      </div>

      <div style={colStyleFor('id', { flexShrink: 0 })} className="min-w-0 px-2">
        <IdCell
          itemKey={item.itemKey}
          type="feature"
          onOpen={() => onOpenFeature(item.portfolioItemId)}
        />
      </div>

      <div style={colStyleFor('name', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="truncate text-foreground" title={item.name}>
          {item.name}
        </span>
      </div>

      <div style={colStyleFor('assignment', { flexShrink: 0 })} className="min-w-0 px-2">
        {/* Rally's Planned Project Assignment: the team(s) this Feature is planned against in
            THIS plan. An unassigned item carries a warning, because it is demand with nowhere
            to go — and Rally flags it the same way. */}
        {item.primaryTeamId === null ? (
          <span className="flex items-center gap-1" style={{ color: BRAND.warning }}>
            <AlertTriangle size={12} />
            <span className="text-ui-sm">{t('items.notAssigned')}</span>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            {/* The team that OWNS the Feature, named — Rally shows the assignment, not a count. */}
            <span className="truncate text-foreground" title={primaryTeamName ?? undefined}>
              {primaryTeamName ?? '—'}
            </span>
            {/* Contributors are counted beside it: "+1" says other teams hold work without
                pretending they own it. */}
            {item.teamIds.length > 1 && (
              <span className="shrink-0 text-ui-xs text-foreground-subtle">
                {t('items.plusContributors', { count: item.teamIds.length - 1 })}
              </span>
            )}
          </span>
        )}
      </div>

      <div style={colStyleFor('progress', { flexShrink: 0 })} className="min-w-0 px-2">
        {/* No capacity on an item row: a Feature has no ceiling of its own, so the bar scales
            against its own largest value — the same rule the team grid's Feature rows use. */}
        <CompositeBar
          complete={item.complete}
          rollup={item.rollup}
          estimated={item.estimated}
          capacity={null}
          title={t('row.barTooltip', {
            complete: item.complete,
            rollup: item.rollup,
            estimated: item.estimated,
            unit: unitLabel,
          })}
        />
      </div>

      <div
        style={colStyleFor('estimated', { flexShrink: 0 })}
        className="flex items-center justify-end gap-1.5 px-2"
      >
        <EstimateTierBadge tier={item.tier} />
        <span className="tabular-nums">{item.estimated}</span>
      </div>
    </div>
  )
}
