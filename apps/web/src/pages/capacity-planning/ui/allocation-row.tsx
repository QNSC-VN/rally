import { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'

import {
  useRemoveAllocation,
  useUpdateAllocation,
  type CapacityAllocation,
} from '@/features/capacity-planning/api'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { CompositeBar } from '@/shared/ui/composite-bar'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { IconButton } from '@/shared/ui/icon-button'
import { notify } from '@/shared/lib/toast'
import { useCapacityWarningText } from '@/features/capacity-planning/warning-labels'
import { type TeamColKey } from '../model/columns'
import { EstimateTierBadge } from './estimate-tier-badge'

/**
 * One allocated Feature, indented under its team (or under the Unallocated bucket).
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
}: {
  planId: string
  allocation: CapacityAllocation
  unitLabel: string
  canManage: boolean
  colStyleFor: (key: TeamColKey, base?: CSSProperties) => CSSProperties
  onOpenFeature: (portfolioItemId: string) => void
}) {
  const { t } = useTranslation('capacity')
  const warningText = useCapacityWarningText()
  const update = useUpdateAllocation()
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
    <div className="group flex min-h-[34px] items-center border-b border-border-inner bg-surface-subtle/40 px-3 text-ui-md transition-colors hover:bg-primary-lighter">
      {/* Indented to read as a child of the team row above it. */}
      <div
        style={colStyleFor('team', { flexShrink: 0 })}
        className="flex min-w-0 items-center gap-2 pl-8"
      >
        <IdCell
          type="feature"
          itemKey={allocation.itemKey}
          onOpen={() => onOpenFeature(allocation.portfolioItemId)}
        />
        <span className="truncate text-muted-foreground" title={allocation.name}>
          {allocation.name}
        </span>
        <EstimateTierBadge tier={allocation.tier} />
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

      <div
        style={colStyleFor('capacity', { flexShrink: 0 })}
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
