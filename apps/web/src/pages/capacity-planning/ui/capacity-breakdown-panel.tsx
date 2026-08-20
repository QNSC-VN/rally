import { EMPTY_VALUE } from '@/shared/lib/utils'
import { useTranslation } from 'react-i18next'

import { BRAND } from '@/shared/config/brand'
import { CAPACITY_SEGMENTS, CompositeBar } from '@/shared/ui/composite-bar'
import { planTotals, pctOfCapacity } from '@/features/capacity-planning/plan-totals'
import type { CapacityPlan } from '@/features/capacity-planning/api'
import { useCapacityWarningText } from '@/features/capacity-planning/warning-labels'

/**
 * Rally's Breakdown panel — `By Story Points`.
 *
 * Four stacked bars on ONE shared scale, each labelled with its value and its share of capacity,
 * and each annotated on the right with the GAP to the level above it:
 *
 *     ▬▬▬▬▬▬▬▬░░   (the plan's bar)
 *     3161 84%  ▬▬▬▬▬▬▬▬        ┤ Complete   3161
 *     3161 84%  ░░░░░░░░        ┤ Unfinished    —
 *     3565 95%  ▨▨▨▨▨▨▨▨▨       ┤ Remaining   404
 *     3721 base ▩▩▩▩▩▩▩▩▩▩      ┤ Remaining   156
 *
 * The gaps are the point, and they are what a table of four numbers cannot show: `Unfinished` is
 * rollup − complete (live work not yet done), the first `Remaining` is estimated − rollup (committed
 * work with no child stories yet), the second is capacity − estimated (headroom). A planner reading
 * the plan asks "where is the slack?", and the answer is which of those three gaps is wide.
 *
 * Replaces a modal table of the same four values. The table listed them per team, which Rally does
 * on the grid itself — the panel explains the PLAN, and it is a popover because it annotates the
 * summary line it hangs from rather than interrupting it.
 *
 * One shared scale: every row divides by the same denominator (capacity, else the largest value), so
 * the bars are comparable by length. Scaling each row to itself would make four full-width bars.
 */
export function CapacityBreakdownPanel({ plan }: { plan: CapacityPlan }) {
  const { t } = useTranslation('capacity')
  const warningText = useCapacityWarningText()
  const totals = planTotals(plan)

  const scale =
    totals.capacity !== null && totals.capacity > 0
      ? totals.capacity
      : Math.max(totals.estimated, totals.rollup, totals.complete, 1)
  const width = (value: number) => `${Math.max(0, Math.min(100, (value / scale) * 100))}%`

  /** A gap, or null when there is none to report — rendered as `—`, not 0. */
  const gap = (from: number, to: number | null) =>
    to === null || to - from <= 0 ? null : to - from

  const rows = [
    {
      key: 'complete',
      segment: CAPACITY_SEGMENTS.complete,
      value: totals.complete,
      // The first row's annotation is the value itself: there is no level below Complete to gap to.
      gapLabel: t('breakdown.complete'),
      gapValue: totals.complete,
    },
    {
      key: 'rollup',
      segment: CAPACITY_SEGMENTS.rollup,
      value: totals.rollup,
      gapLabel: t('breakdown.unfinished'),
      gapValue: gap(totals.complete, totals.rollup),
    },
    {
      key: 'estimated',
      segment: CAPACITY_SEGMENTS.estimated,
      value: totals.estimated,
      gapLabel: t('breakdown.remaining'),
      gapValue: gap(totals.rollup, totals.estimated),
    },
    {
      key: 'capacity',
      segment: CAPACITY_SEGMENTS.capacity,
      value: totals.capacity,
      gapLabel: t('breakdown.remaining'),
      gapValue: gap(totals.estimated, totals.capacity),
    },
  ] as const

  return (
    <div className="w-[26rem] p-3">
      {/* Rally titles the panel by the UNIT it is counting, right-aligned. */}
      <p className="mb-3 text-right text-ui-md font-semibold text-foreground">
        {plan.unit === 'points' ? t('breakdown.byPoints') : t('breakdown.byCount')}
      </p>

      {/* The plan's own bar first, so the rows beneath it read as that bar taken apart. */}
      <div className="mb-3 pl-24">
        <CompositeBar
          complete={totals.complete}
          rollup={totals.rollup}
          estimated={totals.estimated}
          capacity={totals.capacity}
          /* Same plan-level warnings the header bar names. The overlay is where a planner comes to
             read the totals apart, so a breach shown there and not here would be the worse gap. */
          warningLabels={warningText(plan.warnings)}
        />
      </div>

      <div className="flex flex-col gap-2">
        {rows.map(({ key, segment, value, gapLabel, gapValue }) => {
          const pct = key === 'capacity' ? null : pctOfCapacity(value ?? 0, totals.capacity)
          return (
            <div key={key} className="flex items-center gap-2">
              {/* Value + share on top, tier name underneath — Rally's stacked label. */}
              <div className="w-20 shrink-0 text-right">
                <div className="flex items-baseline justify-end gap-1">
                  <span className="text-ui-md font-semibold text-foreground tabular-nums">
                    {value === null ? EMPTY_VALUE : value}
                  </span>
                  <span className="text-ui-xs text-foreground-subtle tabular-nums">
                    {key === 'capacity'
                      ? value === null
                        ? ''
                        : t('summary.base')
                      : pct === null
                        ? ''
                        : `${pct}%`}
                  </span>
                </div>
                <div className="text-ui-xs text-muted-foreground">{t(`breakdown.${key}`)}</div>
              </div>

              <div className="relative h-4 flex-1 rounded-sm border border-border-subtle bg-card">
                <div
                  className="absolute inset-y-0 left-0 rounded-l-sm"
                  data-breakdown={key}
                  style={{
                    width: width(value ?? 0),
                    background: segment.fill,
                    borderRight: value === null ? undefined : `1px solid ${segment.border}`,
                  }}
                />
              </div>

              {/* The GAP to the level above, which is why the panel exists. */}
              <div className="w-24 shrink-0">
                <div className="text-ui-xs text-muted-foreground">{gapLabel}</div>
                <div
                  className="text-ui-md font-semibold tabular-nums"
                  style={{ color: gapValue === null ? BRAND.textMuted : BRAND.textPrimary }}
                >
                  {gapValue === null ? EMPTY_VALUE : gapValue}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
