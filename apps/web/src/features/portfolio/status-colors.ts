import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'
import type { PortfolioItemState } from './api'

/**
 * Portfolio item state → badge colours, for `<StatusBadge style={PORTFOLIO_STATE_STYLE[state]} />`.
 *
 * The 11 states had NO badge anywhere: `StatusBadge` had zero usages under `pages/portfolio/**`, and
 * the vocabulary rendered four different ways — a bare `SearchableSelect` label on the list row, on the
 * disclosed child row and in the detail rail, plain muted text on the Epic Children tab, and plain
 * muted text again inside Capacity Planning's allocation row. Every other entity in the app (releases,
 * iterations, milestones, projects, capacity plans, teams, SCM) resolves its state through this pattern.
 *
 * FIVE styles for eleven states, deliberately. The badge carries the PHASE — nothing started yet,
 * discovery, delivery, finished, abandoned — and the label carries the exact state, which is what a
 * reader needs the words for. Eleven hues would be eleven things to learn and, at pill size, several
 * indistinguishable pairs; the funnel only has these five meanings.
 *
 * Labels come from i18n (`states.*` in the portfolio namespace) rather than from here, unlike the older
 * maps: this vocabulary is already translated for the filter and every picker, and a second copy in
 * English would drift from it. Call sites spread the style and add the label — see `portfolioStateStyle`.
 */
const PHASE = {
  /** Nothing has started: no state recorded, or the item is still queueing for attention. */
  pending: { bg: BRAND.surfaceSubtle, text: BRAND.textSecondary, border: BRAND.border },
  /** Being figured out — the three discovery/prioritisation states. */
  discovery: {
    bg: BRAND.accentBgSubtle,
    text: BRAND.primaryLight,
    border: BRAND.accentBorderStrong,
  },
  /** Being built or verified. */
  active: { bg: BRAND.primaryLighter, text: BRAND.primary, border: BRAND.accentBorderActive },
  /** Delivered. */
  done: { bg: BRAND.successBg, text: BRAND.success, border: BRAND.successBorder },
  /** Abandoned. Muted rather than alarming: cancelling is a decision, not a failure. */
  cancelled: { bg: BRAND.dangerBg, text: BRAND.textSecondary, border: BRAND.dangerBorder },
} as const

const STATE_PHASE: Record<PortfolioItemState, keyof typeof PHASE> = {
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

/**
 * The badge style for one state, with its translated label.
 *
 * `label` is a parameter because the words live in i18n; passing them in keeps ONE colour map and one
 * translation source instead of a hardcoded English copy per surface.
 */
export function portfolioStateStyle(state: PortfolioItemState, label: string): StatusStyle {
  return { ...PHASE[STATE_PHASE[state] ?? 'pending'], label }
}
