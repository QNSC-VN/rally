import { StatusBadge } from '@/shared/ui/status-badge'
import { CompositeBar } from '@/shared/ui/composite-bar'
import { CAPACITY_STATUS_STYLE } from '@/features/capacity-planning/status-colors'
import { planTotals } from '@/features/capacity-planning/plan-totals'
import { useCapacityWarningText } from '@/features/capacity-planning/warning-labels'
import type { CapacityPlan } from '@/features/capacity-planning/api'
import { CapacityBarTooltip } from './capacity-bar-tooltip'

/**
 * The detail header's status cluster: state badge, release pill and the PLAN's own bar.
 *
 * Extracted from `capacity-plan-detail-page.tsx` because it is self-contained — it reads the plan
 * and nothing else on the page — and the page is at the file-length ratchet.
 */
export function PlanHeaderStatus({ plan }: { plan: CapacityPlan }) {
  const warningText = useCapacityWarningText()
  // The same totals the summary panel and the Breakdown overlay read, so the header bar cannot
  // disagree with the numbers printed beside it.
  const totals = planTotals(plan)

  return (
    <div className="flex items-center gap-2">
      {/* Same `StatusBadge` + feature-owned colour map as releases, iterations, milestones and
          projects — a capacity plan's state should not be the one status in the app rendered as
          bare text. */}
      <StatusBadge style={CAPACITY_STATUS_STYLE[plan.status]} />
      {/* Light-on-dark, NOT the page's muted greys: this bar is `bg-primary-dark`, where
          `text-muted-foreground` on a subtle border is very nearly invisible. Same `bg-white/10` +
          `text-white` treatment the bar's own controls use. */}
      {plan.releaseName !== null && (
        <span className="rounded-full bg-white/10 px-2 py-px text-ui-xs text-white">
          {plan.releaseName}
        </span>
      )}
      {/* The PLAN's own bar, in the header — Rally's position for it. The same `CompositeBar` every
          team row draws, so the whole plan can be read as over or under before any row is scanned,
          and the header bar cannot layer or colour differently from the rows it summarises. */}
      <div className="w-56 shrink-0">
        <CompositeBar
          onDark
          complete={totals.complete}
          rollup={totals.rollup}
          estimated={totals.estimated}
          capacity={totals.capacity}
          /* The PLAN's own warnings, which this bar had none of: `computeCapacityWarnings` ran for
             every row and never over the totals, so a plan whose combined demand exceeded its
             combined capacity read as clean while the rows beneath it flagged. */
          warningLabels={warningText(plan.warnings)}
          tooltip={
            <CapacityBarTooltip
              complete={totals.complete}
              rollup={totals.rollup}
              estimated={totals.estimated}
              capacity={totals.capacity}
            />
          }
        />
      </div>
    </div>
  )
}
