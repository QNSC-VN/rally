import { AlertTriangle } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'

/**
 * Rally's red `⚠ N` pill: how many warnings a row carries, not merely that it carries one.
 *
 * The count is the point. A bare triangle says "something is wrong here"; `⚠ 5` says which row to
 * look at first when a dozen of them are flagged, which is the whole job of this column on a plan
 * with a dozen teams.
 *
 * Renders nothing at zero rather than a grey `0` — an absent warning is not a warning of zero.
 */
export function WarningCountBadge({
  count,
  label,
  heading,
}: {
  count: number
  label: string
  /**
   * A one-line summary shown ABOVE the rules — Rally's "1 Feature requires attention".
   *
   * The count answers "how bad?" before the reader has parsed a single rule, which is what a hover
   * over a red pill is asking. The rules follow it; both are in the accessible name, because a
   * hover-only explanation does not exist for a screen reader.
   */
  heading?: string
}) {
  if (count <= 0) return null
  const full = heading === undefined ? label : `${heading}. ${label}`
  return (
    <span
      role="img"
      aria-label={full}
      title={full}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-ui-xs font-semibold"
      style={{ backgroundColor: BRAND.danger, color: BRAND.primaryForeground }}
    >
      <AlertTriangle size={10} />
      {count}
    </span>
  )
}
