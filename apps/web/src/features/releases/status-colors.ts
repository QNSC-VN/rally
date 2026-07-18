import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'
import type { ReleaseStatus } from './api'

/**
 * Release status → badge colors. Single source of truth shared by the releases
 * list page and the release detail page (previously copy-pasted in both).
 */
export const RELEASE_STATUS_STYLE: Record<ReleaseStatus, StatusStyle> = {
  planning: { bg: '#eef3fb', text: '#1d3f73', border: '#bdd0ef', label: 'Planning' },
  active: {
    bg: BRAND.warningBg,
    text: BRAND.warning,
    border: BRAND.warningBorder,
    label: 'Active',
  },
  accepted: { bg: '#eaf5ed', text: '#1e6930', border: BRAND.successBorder, label: 'Accepted' },
}
