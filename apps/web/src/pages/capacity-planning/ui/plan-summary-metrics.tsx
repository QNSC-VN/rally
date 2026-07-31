import { useTranslation } from 'react-i18next'

import { BRAND } from '@/shared/config/brand'
import { CAPACITY_SEGMENTS, CompositeBar } from '@/shared/ui/composite-bar'
import { planTotals, pctOfCapacity } from '@/features/capacity-planning/plan-totals'
import type { CapacityPlan } from '@/features/capacity-planning/api'

/**
 * Rally's plan summary line: `■ Complete 3079 85%  □ Rollup 3104 86%  ▨ Estimated 3284 91%
 * ▩ Capacity 3591 base`.
 *
 * Each metric carries the SWATCH of the bar segment it names, drawn from `CAPACITY_SEGMENTS` — the
 * same source the bars use, so the legend cannot drift from what it explains. That link is the
 * reason this exists as a component rather than four `MetricCard`s: cards have no swatch, and the
 * first version of this header used them, which left the reader to guess which number was which
 * band.
 *
 * Capacity is marked `base` rather than `100%`: it is the denominator the other three are
 * percentages OF, and printing 100% invites reading it as "capacity is full".
 */
export function PlanSummaryMetrics({ plan, unitLabel }: { plan: CapacityPlan; unitLabel: string }) {
  const { t } = useTranslation('capacity')
  const totals = planTotals(plan)

  const metrics = [
    { key: 'complete', segment: CAPACITY_SEGMENTS.complete, value: totals.complete },
    { key: 'rollup', segment: CAPACITY_SEGMENTS.rollup, value: totals.rollup },
    { key: 'estimated', segment: CAPACITY_SEGMENTS.estimated, value: totals.estimated },
  ] as const

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1">
      {/* The PLAN's own bar, the same `CompositeBar` every team row draws — Rally puts one in the
          header so the whole plan can be read as over or under before scanning any row. Same
          component, so the header bar and the row bars cannot layer or colour differently. */}
      <div className="w-40 shrink-0">
        <CompositeBar
          complete={totals.complete}
          rollup={totals.rollup}
          estimated={totals.estimated}
          capacity={totals.capacity}
          targetLoadPct={plan.targetLoadPct}
        />
      </div>

      {metrics.map(({ key, segment, value }) => {
        const pct = pctOfCapacity(value, totals.capacity)
        return (
          <span key={key} className="flex items-center gap-1.5 text-ui-sm">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ background: segment.fill, border: `1px solid ${segment.border}` }}
            />
            <span className="text-muted-foreground">{t(`breakdown.${key}`)}</span>
            <span className="font-semibold text-foreground tabular-nums">{value}</span>
            {pct !== null && (
              <span className="text-ui-xs text-foreground-subtle tabular-nums">{pct}%</span>
            )}
          </span>
        )
      })}

      <span className="flex items-center gap-1.5 text-ui-sm">
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{
            background: CAPACITY_SEGMENTS.capacity.fill,
            border: `1px solid ${CAPACITY_SEGMENTS.capacity.border}`,
          }}
        />
        <span className="text-muted-foreground">{t('breakdown.capacity')}</span>
        {totals.capacity === null ? (
          <span className="text-ui-sm text-foreground-subtle">{t('row.notEntered')}</span>
        ) : (
          <>
            <span className="font-semibold text-foreground tabular-nums">{totals.capacity}</span>
            {/* Rally's own word for it. */}
            <span className="text-ui-xs" style={{ color: BRAND.warning }}>
              {t('summary.base')}
            </span>
          </>
        )}
      </span>

      <span className="text-ui-sm text-muted-foreground">
        {t('summary.assignedSplit', {
          assigned: totals.assignedItems,
          unassigned: totals.unassignedItems,
        })}
        {/* Rally colours a NON-ZERO unassigned count: it is the number that means work in this plan
            has nowhere to go. Zero stays muted — there is nothing to act on. */}
        {totals.unassignedItems > 0 && (
          <span className="ml-1 font-semibold" style={{ color: BRAND.warning }}>
            ⚠
          </span>
        )}
      </span>

      <span className="text-ui-xs text-foreground-subtle">{unitLabel}</span>
    </div>
  )
}
