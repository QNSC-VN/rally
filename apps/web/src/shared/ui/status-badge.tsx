import { cn } from '@/shared/lib/utils'
import type { StatusStyle } from '@/shared/config/status-colors'

interface StatusBadgeProps {
  /** Resolved color style, e.g. `RELEASE_STATUS_STYLE[status]`. */
  style: StatusStyle
  className?: string
}

/**
 * Presentational status pill. Pages pass a resolved {@link StatusStyle} from
 * `@/shared/config/status-colors` — this component owns only the shared markup
 * so the badge looks identical everywhere (releases, milestones, …).
 */
export function StatusBadge({ style, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-px text-[11px] font-medium whitespace-nowrap',
        className,
      )}
      style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}
    >
      {style.label}
    </span>
  )
}
