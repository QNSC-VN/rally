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
 *
 * FULLY ROUNDED, as Rally draws every status chip. The 2px corner it had read as a
 * table cell with a background rather than as a state, and it was the one place our
 * chips diverged from Rally's — deliberately changed here rather than per page, so
 * a status cannot be a pill on one surface and a box on the next.
 */
export function StatusBadge({ style, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-px text-ui-sm font-medium whitespace-nowrap',
        className,
      )}
      style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}
    >
      {style.label}
    </span>
  )
}
