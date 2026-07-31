import { useTranslation } from 'react-i18next'

import { BRAND } from '@/shared/config/brand'
import { CAPACITY_SEGMENTS } from '@/shared/ui/composite-bar'
import { planTotals, pctOfCapacity } from '@/features/capacity-planning/plan-totals'
import type { CapacityPlan } from '@/features/capacity-planning/api'

/** One swatch + label + value + percentage, the unit Rally's summary panel is built from. */
function SummaryMetric({
  segment,
  label,
  value,
  pct,
  suffix,
}: {
  segment: { fill: string; border: string }
  label: string
  value: string
  pct: number | null
  /** Replaces the percentage — `base` on Capacity, which every other figure is a share OF. */
  suffix?: string
}) {
  return (
    <span className="flex items-center gap-1.5 text-ui-sm whitespace-nowrap">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 rounded-sm"
        style={{ background: segment.fill, border: `1px solid ${segment.border}` }}
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
      {suffix !== undefined ? (
        <span className="text-ui-xs" style={{ color: BRAND.warning }}>
          {suffix}
        </span>
      ) : (
        pct !== null && (
          <span className="text-ui-xs text-foreground-subtle tabular-nums">{pct}%</span>
        )
      )}
    </span>
  )
}

/**
 * Rally's plan summary PANEL: a bordered box holding the four Breakdown figures with the bar
 * segment swatch each one names, the plan's unit down its left edge, and `Breakdown` as a link in
 * the corner.
 *
 * A box rather than a run of text because Rally boxes it, and the border is doing work: these four
 * numbers are one reading of the plan (`Complete ⊆ Rollup ⊆ Estimated ≤ Capacity`), and unboxed
 * they ran into the assigned/unassigned counts beside them as if all six were the same list.
 *
 * Swatches come from `CAPACITY_SEGMENTS` — the same source the bars use, so the legend cannot
 * drift from what it explains. That link is why this is a component rather than four
 * `MetricCard`s: a card has no swatch, and the first version of this header used cards, leaving
 * the reader to guess which number was which band.
 *
 * Capacity is marked `base`, not `100%`: it is the denominator the other three are percentages OF,
 * and printing 100% invites reading it as "capacity is full".
 */
export function PlanSummaryMetrics({
  plan,
  unitLabel,
  onOpenBreakdown,
}: {
  plan: CapacityPlan
  unitLabel: string
  /** Opens the Breakdown overlay. Rally's link lives in this panel, not in the toolbar. */
  onOpenBreakdown: () => void
}) {
  const { t } = useTranslation('capacity')
  const totals = planTotals(plan)

  const metrics = [
    { key: 'complete', segment: CAPACITY_SEGMENTS.complete, value: totals.complete },
    { key: 'rollup', segment: CAPACITY_SEGMENTS.rollup, value: totals.rollup },
    { key: 'estimated', segment: CAPACITY_SEGMENTS.estimated, value: totals.estimated },
  ] as const

  return (
    <div className="flex min-w-0 items-stretch rounded-sm border border-border-subtle bg-card">
      {/* The unit, once, on the left edge — every figure in the panel is in it, so repeating
          "points" four times would be noise. Rally labels the box the same way. */}
      <div className="flex shrink-0 items-center border-r border-border-subtle px-3">
        <span className="text-ui-sm font-semibold text-muted-foreground">{unitLabel}</span>
      </div>

      {/* Two rows of two on Rally's own layout: the three measured figures, then Capacity as the
          base beneath them. `flex-wrap` rather than a grid so a narrow window folds it to one
          column instead of overflowing a fixed track. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1 px-3 py-1.5">
        {metrics.map(({ key, segment, value }) => (
          <SummaryMetric
            key={key}
            segment={segment}
            label={t(`breakdown.${key}`)}
            value={String(value)}
            pct={pctOfCapacity(value, totals.capacity)}
          />
        ))}
        <SummaryMetric
          segment={CAPACITY_SEGMENTS.capacity}
          label={t('breakdown.capacity')}
          value={totals.capacity === null ? t('row.notEntered') : String(totals.capacity)}
          pct={null}
          suffix={totals.capacity === null ? undefined : t('summary.base')}
        />
      </div>

      <button
        type="button"
        onClick={onOpenBreakdown}
        className="shrink-0 self-start px-3 py-1.5 text-ui-sm text-primary-light underline-offset-2 hover:underline"
      >
        {t('breakdown.action')}
      </button>
    </div>
  )
}

/**
 * The counts Rally prints OUTSIDE the panel, beside the portfolio-item type: how many items in the
 * plan have a team and how many do not.
 *
 * Separate from the panel because it answers a different question. The panel measures demand
 * against capacity; this says whether the demand has anywhere to go, and Rally keeps the two apart.
 */
export function PlanAssignmentCounts({ plan }: { plan: CapacityPlan }) {
  const { t } = useTranslation('capacity')
  const totals = planTotals(plan)

  return (
    <span className="text-ui-sm whitespace-nowrap text-muted-foreground">
      {t('summary.assignedSplit', {
        assigned: totals.assignedItems,
        unassigned: totals.unassignedItems,
      })}
      {/* A NON-ZERO unassigned count is coloured: it is the number that means work in this plan has
          nowhere to go. Zero stays muted — there is nothing to act on. */}
      {totals.unassignedItems > 0 && (
        <span className="ml-1 font-semibold" style={{ color: BRAND.warning }}>
          ⚠
        </span>
      )}
    </span>
  )
}
