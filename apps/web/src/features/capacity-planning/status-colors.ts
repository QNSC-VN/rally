import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'
import type { CapacityPlanStatus } from './api'

/**
 * Capacity plan status → badge colours, so the plan header reads like every other status in the
 * app rather than as plain text.
 *
 * Same feature-owned map + shared `StatusBadge` split that releases, iterations, milestones and
 * projects already use — the `shared` layer never learns a capacity vocabulary.
 *
 * Draft is deliberately neutral rather than a warning colour: a draft is the normal state of a plan
 * being written, not a problem. Published is green because it is the state that makes the plan
 * visible to everyone — Rally shows it as the positive, finished-work colour too.
 */
export const CAPACITY_STATUS_STYLE: Record<CapacityPlanStatus, StatusStyle> = {
  draft: {
    bg: BRAND.surfaceSubtle,
    text: BRAND.textSecondary,
    border: BRAND.borderSubtle,
    label: 'Draft',
  },
  published: {
    bg: BRAND.successBg,
    text: BRAND.success,
    border: BRAND.successBorder,
    label: 'Published',
  },
}
