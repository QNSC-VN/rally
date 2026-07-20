import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'
import type { IterationState } from './api'

/**
 * Iteration (timebox) state → badge colors. Single source of truth shared by the
 * timeboxes list page, the iteration detail header and its sidebar (previously a
 * page-local `StateBadge`). Render with `<StatusBadge style={ITERATION_STATE_STYLE[state]} />`.
 */
export const ITERATION_STATE_STYLE: Record<IterationState, StatusStyle> = {
  planning: {
    bg: BRAND.primaryLighter,
    text: BRAND.primary,
    border: BRAND.accentBorder,
    label: 'Planning',
  },
  committed: {
    bg: BRAND.warningBg,
    text: BRAND.warning,
    border: BRAND.warningBorder,
    label: 'Committed',
  },
  accepted: {
    bg: BRAND.successBg,
    text: BRAND.success,
    border: BRAND.successBorder,
    label: 'Accepted',
  },
}
