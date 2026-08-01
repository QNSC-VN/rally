import { useTranslation } from 'react-i18next'

import { ProgressBar } from '@/shared/ui/progress-bar'
import type { PortfolioItem } from '../api'
import { PORTFOLIO_HEALTH_COLOR, healthLabelKey } from '../health-colors'

/**
 * A Percent Done bar coloured by the portfolio item's Rally status, with Rally's hover
 * callout.
 *
 * Exists so the grid row and the detail page cannot drift: both show the same two Percent
 * Done fields, Rally colours both by the same verdict, and both need the same callout. The
 * colour, the numbers and the status sentence are resolved here once instead of at four
 * call sites — which is also why the callout takes the whole `rollup` rather than a
 * pre-built string: the callout names BOTH denominators regardless of which bar you hover,
 * the way Rally's does ("Status, Accepted Points, Accepted User Stories, …").
 *
 * Only PERCENT DONE takes this treatment. The Estimated Progress bars keep
 * `ProgressBar`'s own over-delivery colouring, because they measure accepted work against
 * a top-down forecast rather than against the schedule — a Feature can be at 150% of its
 * forecast and still be late.
 */
export function PercentDoneBar({
  metric,
  health,
  progress,
  rollup,
}: {
  /** Which denominator this bar divides by. Rally shows the two as separate columns. */
  metric: 'points' | 'count'
  health: PortfolioItem['health']
  progress: PortfolioItem['progress']
  rollup: PortfolioItem['rollup']
}) {
  const { t } = useTranslation('portfolio')

  const ratio =
    metric === 'points' ? progress.percentDoneByPlanEstimate : progress.percentDoneByCount

  // Newline-separated, which a native `title` renders as separate lines. Deliberately not
  // a custom popover: this has to work identically inside a virtualised grid row and a
  // detail pane, and a `title` cannot be clipped by either one's overflow.
  const callout = [
    t('health.callout.status', { status: t(healthLabelKey(health)) }),
    t('health.callout.points', {
      accepted: rollup.acceptedPoints,
      total: rollup.rollupPoints,
    }),
    t('health.callout.items', {
      accepted: rollup.acceptedCount,
      total: rollup.rollupCount,
    }),
  ].join('\n')

  return (
    <ProgressBar
      // A NULL ratio renders as 0%, not as a dash. The API keeps null — it is the only way to
      // tell "nothing linked" from "nothing accepted", and the hover callout below still names
      // both denominators — but the SPEC and real Rally both display 0% here: SRS.md:192 ("a
      // Feature with no linked Story/Defect shows 0% progress"), HANDOFF:216 ("zero denominator
      // renders 0%, never NaN or infinity"), and Rally's own panel shows `Defects: 0% 0/0`.
      // The data gap stays visible in the RATIO text, which is where Rally puts it.
      ratio={ratio ?? 0}
      // Grey when there is no verdict: Rally shows a grey bar for an item whose Planned
      // Start Date is undefined or still in the future, and reserves the RAG colours for a
      // bar it can actually judge. `PORTFOLIO_HEALTH_COLOR` maps that case already.
      tone={PORTFOLIO_HEALTH_COLOR[health.state]}
      title={callout}
    />
  )
}
