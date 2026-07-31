import { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Star, Trash2 } from 'lucide-react'

import {
  useRemoveAllocation,
  useSetPrimaryAllocation,
  useUpdateAllocation,
  type CapacityAllocation,
} from '@/features/capacity-planning/api'
import { BRAND } from '@/shared/config/brand'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { CompositeBar } from '@/shared/ui/composite-bar'
import { MetricValue } from '@/shared/ui/metric-value'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { IconButton } from '@/shared/ui/icon-button'
import { notify } from '@/shared/lib/toast'
import { useCapacityWarningText } from '@/features/capacity-planning/warning-labels'
import { type AllocColKey } from '../model/columns'
import { EstimateTierBadge } from './estimate-tier-badge'

/**
 * One allocated Feature inside its team's sub-table (or the Unallocated bucket's).
 *
 * Laid out against `AllocColKey`, the nested table's own columns — see
 * `TeamAllocationsTable` for why the child grid does not reuse the parent's headers.
 *
 * The Estimated cell edits in place. A Feature row has NO capacity of its own, so its bar
 * scales against its own largest value and only the two Feature rules can fire: Rally's
 * missing-estimate error and rollup-exceeds-estimated. `computeCapacityWarnings` returns
 * exactly those for `kind: 'feature'`, so there is no separate code path here.
 */
export function AllocationRow({
  planId,
  allocation,
  unitLabel,
  canManage,
  colStyleFor,
  onOpenFeature,
  teamName,
}: {
  planId: string
  allocation: CapacityAllocation
  unitLabel: string
  canManage: boolean
  colStyleFor: (key: AllocColKey, base?: CSSProperties) => CSSProperties
  onOpenFeature: (portfolioItemId: string) => void
  /** This row's team name, for the "make primary" label — ids make a useless accessible name. */
  teamName: string | null
}) {
  const { t } = useTranslation('capacity')
  const warningText = useCapacityWarningText()
  const update = useUpdateAllocation()
  const setPrimary = useSetPrimaryAllocation()
  const remove = useRemoveAllocation()
  const { metrics } = allocation

  function commit(raw: string) {
    const next = Number(raw.trim())
    if (!Number.isFinite(next) || next < 0) {
      notify.error(t('row.capacityInvalid'))
      return
    }
    if (next === allocation.value) return
    update.mutate(
      { id: planId, allocationId: allocation.id, value: next },
      {
        onSuccess: () => notify.success(t('row.allocationUpdated')),
        onError: (err) => notify.error(err.message),
      },
    )
  }

  return (
    <div className="group flex min-h-[30px] items-center border-b border-border-inner px-2 text-ui-md transition-colors hover:bg-primary-lighter">
      <div style={colStyleFor('id', { flexShrink: 0 })} className="min-w-0 px-2">
        <IdCell
          type="feature"
          itemKey={allocation.itemKey}
          onOpen={() => onOpenFeature(allocation.portfolioItemId)}
        />
      </div>

      <div
        style={colStyleFor('name', { flexShrink: 0 })}
        className="flex min-w-0 items-center gap-2 px-2"
      >
        <span className="break-words whitespace-normal text-foreground" title={allocation.name}>
          {allocation.name}
        </span>
        <EstimateTierBadge tier={allocation.tier} />
        {/* Rally assigns a Feature to ONE team and allocates to the rest. The badge says which row
            owns it; the button on a contributor moves that ownership without a dialog, because it
            is a single-field change whose result is visible immediately. */}
        {allocation.isPrimary ? (
          <span
            className="shrink-0 rounded-sm px-1 py-px text-ui-xs font-medium"
            style={{
              backgroundColor: BRAND.accentBg,
              color: BRAND.primaryLight,
              border: `1px solid ${BRAND.accentBorder}`,
            }}
          >
            {t('row.primaryBadge')}
          </span>
        ) : (
          canManage &&
          allocation.teamId !== null && (
            <IconButton
              aria-label={t('row.makePrimary', {
                team: teamName ?? '',
                item: allocation.itemKey,
              })}
              onClick={() =>
                setPrimary.mutate(
                  { id: planId, allocationId: allocation.id },
                  {
                    onSuccess: () => notify.success(t('row.primaryUpdated')),
                    onError: (err) => notify.error(err.message),
                  },
                )
              }
              disabled={setPrimary.isPending}
            >
              <Star size={12} />
            </IconButton>
          )
        )}
      </div>

      {/* Rally's `Allocation`: this team's promised slice, edited in place. Under the parent's
          headers this number sat below one reading "Capacity", which is the team's ceiling — a
          different figure entirely. */}
      <div
        style={colStyleFor('allocation', { flexShrink: 0 })}
        className="min-w-0 px-0"
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          fullCell
          value={String(allocation.value)}
          canEdit={canManage}
          onCommit={commit}
          ariaLabel={t('row.allocationLabel', { feature: allocation.itemKey })}
          className="block w-full text-right"
          inputClassName="w-full rounded border border-primary bg-transparent px-1 py-0.5 text-right text-ui-sm text-foreground focus:outline-none"
        />
      </div>

      <div style={colStyleFor('progress', { flexShrink: 0 })} className="min-w-0 px-2">
        <CompositeBar
          complete={metrics.complete}
          rollup={metrics.rollup}
          estimated={metrics.estimated}
          capacity={metrics.capacity}
          warningLabels={warningText(metrics.warnings)}
          title={t('row.barTooltip', {
            complete: metrics.complete,
            rollup: metrics.rollup,
            estimated: metrics.estimated,
            unit: unitLabel,
          })}
        />
      </div>

      {/* No percentages: a Feature has no capacity of its own to be a share OF — the ceiling
          belongs to the team whose sub-table this is. */}
      <div style={colStyleFor('complete', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={metrics.complete} pct={null} />
      </div>
      <div style={colStyleFor('rollup', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={metrics.rollup} pct={null} />
      </div>
      <div style={colStyleFor('estimated', { flexShrink: 0 })} className="px-2 text-right">
        <MetricValue value={metrics.estimated} pct={null} />
      </div>

      <div
        style={colStyleFor('actions', { flexShrink: 0 })}
        className="flex items-center justify-center px-2"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage && (
          <IconButton
            aria-label={t('row.removeAllocation', { feature: allocation.itemKey })}
            onClick={() =>
              remove.mutate(
                { id: planId, allocationId: allocation.id },
                {
                  onSuccess: () => notify.success(t('row.allocationRemoved')),
                  onError: (err) => notify.error(err.message),
                },
              )
            }
            disabled={remove.isPending}
          >
            <Trash2 size={13} />
          </IconButton>
        )}
      </div>
    </div>
  )
}
