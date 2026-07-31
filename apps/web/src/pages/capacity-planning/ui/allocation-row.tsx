import { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'

import {
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
import { EstimateTierIcon } from './estimate-tier-badge'

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
  rankPosition,
  planProjectId,
}: {
  planId: string
  allocation: CapacityAllocation
  unitLabel: string
  canManage: boolean
  colStyleFor: (key: AllocColKey, base?: CSSProperties) => CSSProperties
  onOpenFeature: (portfolioItemId: string) => void
  /** This row's team name, for the "make primary" label — ids make a useless accessible name. */
  teamName: string | null
  /** The Feature's 1-based position in the plan's rank order, resolved by the table. */
  rankPosition: number | null
  /** The PLAN's project, so a Feature from elsewhere can be marked as such. */
  planProjectId: string
}) {
  const { t } = useTranslation('capacity')
  /**
   * The Feature's project when it is NOT the plan's — Rally's `← from` provenance.
   *
   * Null for a native Feature, which is why the column is empty on most rows: a plan mostly holds
   * its own project's Features, and printing "from <this project>" on every one of them would be
   * noise.
   */
  const foreignProjectName =
    allocation.projectId === planProjectId ? null : (allocation.projectName ?? null)
  // The Feature state vocabulary lives in the portfolio namespace — the same labels the Portfolio
  // page shows, so a state cannot read one way there and another way inside a plan.
  const { t: tPortfolio } = useTranslation('portfolio')
  const warningText = useCapacityWarningText()
  const update = useUpdateAllocation()
  const setPrimary = useSetPrimaryAllocation()
  const { metrics } = allocation

  function commit(raw: string) {
    const trimmed = raw.trim()
    // Emptying the cell CLEARS the explicit allocation (sends null) rather than committing 0: this
    // team is still planned to work on the Feature, it just has no slice of its own again.
    if (trimmed === '') {
      if (allocation.value === null) return
      update.mutate(
        { id: planId, allocationId: allocation.id, value: null },
        {
          onSuccess: () => notify.success(t('row.allocationCleared')),
          onError: (err) => notify.error(err.message),
        },
      )
      return
    }
    const next = Number(trimmed)
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
      {/* The FEATURE's plan-wide rank, not a position in this team's list: a planner reading one
          team still wants to know where each Feature sits in the plan's priority order. */}
      <div
        style={colStyleFor('rank', { flexShrink: 0 })}
        className="px-2 text-right text-muted-foreground tabular-nums"
      >
        {rankPosition ?? '—'}
      </div>

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
        <span className="truncate text-foreground" title={allocation.name}>
          {allocation.name}
        </span>
        {/* Rally marks the primary assignment on the Features tab's `Planned Team Assignment`
            field, not in this table — but that field is not editable here yet, so the badge and
            the promote action stay in this cell as the only surface for them. The TIER moved out
            to its own trailing column, where Rally keeps it. */}
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

      {/* Rally's `Allocation`: where this Feature came FROM, printed as `← from <project>` when the
          Feature belongs to a project other than the plan's, and blank when it is native.
          NOT a number — the allocated points live in the trailing `Estimate` tooltip, which is where
          Rally puts them, and are edited in the `Estimated` cell. */}
      <div style={colStyleFor('allocation', { flexShrink: 0 })} className="min-w-0 px-2">
        {foreignProjectName !== null && (
          <span
            className="truncate text-ui-sm text-muted-foreground italic"
            title={t('row.allocatedFrom', { project: foreignProjectName })}
          >
            ← {t('row.from')} <span className="font-medium">{foreignProjectName}</span>
          </span>
        )}
      </div>

      {/* The FEATURE's own state — Rally's `State` column on this table. Read-only here: the state
          belongs to the Feature and is edited on the Portfolio page, not inside a plan. */}
      <div style={colStyleFor('state', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="truncate text-muted-foreground">
          {tPortfolio(`states.${allocation.state}`)}
        </span>
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
      {/* `Estimated` is the row's charge AND its editor: typing here allocates an explicit slice to
          this team, clearing it hands the row back to the Feature's own estimate. Rally edits the
          allocation through its assignment dialog; we put it on the number it changes, which is the
          same cell a reader is already looking at. */}
      <div
        style={colStyleFor('estimated', { flexShrink: 0 })}
        className="min-w-0 px-0"
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          fullCell
          value={allocation.value === null ? '' : String(allocation.value)}
          canEdit={canManage}
          onCommit={commit}
          ariaLabel={t('row.allocationLabel', { feature: allocation.itemKey })}
          displayValue={
            <span className="block w-full text-right">
              <MetricValue value={metrics.estimated} pct={null} />
            </span>
          }
          className="block w-full text-right"
          inputClassName="w-full rounded border border-primary bg-transparent px-1 py-0.5 text-right text-ui-sm text-foreground focus:outline-none"
        />
      </div>

      {/* Rally's trailing `Estimate` glyph: which tier this row's Estimated came from. */}
      <div
        style={colStyleFor('tier', { flexShrink: 0 })}
        className="flex items-center justify-center px-1"
      >
        <EstimateTierIcon tier={allocation.tier} breakdown={allocation.estimateBreakdown} />
      </div>
    </div>
  )
}
