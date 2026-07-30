import { BRAND } from '@/shared/config/brand'
import type { PortfolioItem } from './api'

export type PortfolioHealthState = PortfolioItem['health']['state']

/**
 * Rally's portfolio-item status colours, applied to the two Percent Done bars.
 *
 * "Both of the Percent Done fields are colored based on the status of the work needed
 * to complete the portfolio item" — Broadcom TechDocs, "Using the Portfolio Items
 * Page". The verdict compares the ACCEPTANCE RATE against the rate needed to finish by
 * the Planned End Date, so it is not derivable from the ratio the bar draws; the server
 * computes it (`computeHealth`) and the bar only paints it.
 *
 * Values are `var(--token)` references so the colours follow the dark-mode cascade —
 * an inline hex could not, and `no-raw-hex` forbids one here anyway.
 *
 * Scope note: this scheme is documented for PORTFOLIO ITEMS only. Releases and
 * iterations use a percent-complete state bar instead, which those pages already
 * render, and Rally's roadmap/Gantt view colours its bars on flat 25%/75% ratio
 * thresholds rather than on this schedule comparison. Don't spread this map to either.
 */
export const PORTFOLIO_HEALTH_COLOR: Record<PortfolioHealthState, string> = {
  // Blue, not green: Rally reserves blue for "current date is after the Planned End
  // Date AND the artifacts are 100% done", so finishing early stays green.
  complete: BRAND.primaryLight,
  on_track: BRAND.success,
  // >20% below the required acceptance rate.
  at_risk: BRAND.warning,
  // >40% below.
  late: BRAND.danger,
  // Grey: no verdict was possible (no dates, or nothing estimated). Rally warns about
  // the missing data rather than showing a colour that implies a judgement.
  not_started: BRAND.statusDefault,
}

/** i18n key under the `portfolio` namespace for the tooltip's status sentence. */
export function healthLabelKey(health: PortfolioItem['health']): string {
  if (health.indeterminate !== null) {
    return `health.indeterminate.${health.indeterminate}`
  }
  return `health.state.${health.state}`
}
