import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'

/**
 * Project status → badge colors. Single source of truth for the projects list
 * page. Render with `<StatusBadge style={PROJECT_STATUS_STYLE[status]} />`.
 */
export const PROJECT_STATUS_STYLE: Record<'active' | 'archived', StatusStyle> = {
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
