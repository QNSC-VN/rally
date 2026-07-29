import { type PortfolioItemState, type PreliminaryEstimateSize } from '@/features/portfolio/api'

/**
 * The portfolio item lifecycle, in board order — the `portfolio_item_state` DB
 * enum. Single source for the list filter, the row's state cell and the detail
 * page, so the vocabulary cannot drift between them.
 *
 * This is NOT the work-item Schedule State. A portfolio item moves through an
 * investment funnel (intake → discovery → prioritisation → developing) while a
 * story moves through delivery (defined → in progress → accepted). The old
 * portfolio page rendered Schedule State steppers over Features, which was wrong
 * on both counts once Features stopped being work items.
 */
export const PORTFOLIO_STATES: PortfolioItemState[] = [
  'no_entry',
  'intake',
  'idea_prioritization',
  'problem_discovery',
  'solution_discovery',
  'feature_prioritization',
  'developing',
  'accepted',
  'measuring',
  'done',
  'cancelled',
]

/**
 * Preliminary estimate T-shirt sizes, in ascending order.
 *
 * The points/count each size maps to is a WORKSPACE setting resolved on the
 * server (`workspace_settings.preliminary_estimate_map`), so it is deliberately
 * absent here — an operator can retune XS…XL without a deploy, and hardcoding a
 * copy would make the UI disagree with the Estimated Progress column.
 */
export const PRELIMINARY_ESTIMATE_SIZES: PreliminaryEstimateSize[] = [
  'no_entry',
  'xs',
  's',
  'm',
  'l',
  'xl',
]
