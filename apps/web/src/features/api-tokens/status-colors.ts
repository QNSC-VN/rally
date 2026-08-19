import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'
import type { TokenState } from './token-state'

/**
 * Token state → badge colours, following the release/milestone/SCM maps: the concrete map lives in
 * the owning feature so `shared` never depends on `features`.
 *
 * `expiring` is warning rather than success on purpose — the whole reason the state exists is to be
 * noticed, and a green badge is not noticed.
 */
export const TOKEN_STATE_STYLE: Record<TokenState, StatusStyle> = {
  active: {
    bg: BRAND.successBg,
    text: BRAND.success,
    border: BRAND.successBorder,
    label: 'Active',
  },
  expiring: {
    bg: BRAND.warningBg,
    text: BRAND.warning,
    border: BRAND.warningBorder,
    label: 'Expiring',
  },
  expired: {
    bg: BRAND.dangerBg,
    text: BRAND.danger,
    border: BRAND.dangerBorder,
    label: 'Expired',
  },
  revoked: {
    bg: BRAND.surfaceSubtle,
    text: BRAND.textMuted,
    border: BRAND.border,
    label: 'Revoked',
  },
}
