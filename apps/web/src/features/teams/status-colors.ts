import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'

/**
 * Team status → badge colours. Render with `<StatusBadge style={TEAM_STATUS_STYLE[status]} />`.
 *
 * Deliberately the same palette as `PROJECT_STATUS_STYLE`: both are LIFECYCLE states, and the BA's
 * own component set covers project, team and user lifecycle with one `Entity Status Badge`
 * (P4_PROGRESS: "a distinct domain from the work-item Status Badge"). An archived team reading
 * differently from an archived project would suggest a difference that does not exist.
 */
export const TEAM_STATUS_STYLE: Record<'active' | 'archived', StatusStyle> = {
  active: {
    bg: BRAND.successBg,
    text: BRAND.success,
    border: BRAND.successBorder,
    label: 'Active',
  },
  archived: {
    bg: BRAND.primaryLighter,
    text: BRAND.textSecondary,
    border: BRAND.border,
    label: 'Archived',
  },
}
