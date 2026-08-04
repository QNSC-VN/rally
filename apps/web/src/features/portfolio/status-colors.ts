import { BRAND } from '@/shared/config/brand'
import type { PortfolioItemState } from './api'

/**
 * Portfolio item state → TEXT colour.
 *
 * NOT a `StatusBadge`, unlike every other entity's state. Rally prints a portfolio item's state as plain
 * coloured text — on the Portfolio list, on its disclosed rows, in the detail rail and inside a capacity
 * plan — and a pill there reads as a control the cell may not offer. This map briefly drove a bordered
 * chip in all five places; the border and the tint are gone, the colour is not.
 *
 * FIVE colours for eleven states, deliberately. The colour carries the PHASE — nothing started yet,
 * discovery, delivery, finished, abandoned — and the words carry the exact state, which is what a reader
 * needs them for. Eleven hues would be eleven things to learn and several indistinguishable pairs; the
 * funnel only has these five meanings.
 *
 * One map for all five surfaces, so `Developing` cannot be one colour on the Portfolio page and another
 * inside a plan. Labels stay in i18n (`states.*`), which is where the filter and every picker read them.
 */
const PHASE_COLOR = {
  /** Nothing has started: no state recorded, or the item is still queueing for attention. */
  pending: BRAND.textSecondary,
  /** Being figured out — the three discovery/prioritisation states. */
  discovery: BRAND.primaryLight,
  /** Being built or verified. */
  active: BRAND.primary,
  /** Delivered. */
  done: BRAND.success,
  /** Abandoned. Muted rather than alarming: cancelling is a decision, not a failure. */
  cancelled: BRAND.textSecondary,
} as const

const STATE_PHASE: Record<PortfolioItemState, keyof typeof PHASE_COLOR> = {
  no_entry: 'pending',
  intake: 'pending',
  idea_prioritization: 'discovery',
  problem_discovery: 'discovery',
  solution_discovery: 'discovery',
  feature_prioritization: 'discovery',
  developing: 'active',
  // Accepted but still being measured against the outcome it promised — work, not a finish line.
  measuring: 'active',
  accepted: 'done',
  done: 'done',
  cancelled: 'cancelled',
}

/** The text colour for one state. The words come from i18n at the call site. */
export function portfolioStateColor(state: PortfolioItemState): string {
  return PHASE_COLOR[STATE_PHASE[state] ?? 'pending']
}
