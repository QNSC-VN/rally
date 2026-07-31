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
export function WarningCountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-ui-xs font-semibold"
      style={{ backgroundColor: BRAND.danger, color: BRAND.primaryForeground }}
    >
      <AlertTriangle size={10} />
      {count}
    </span>
  )
}
