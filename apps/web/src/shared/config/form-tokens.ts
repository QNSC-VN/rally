/**
 * Shared form-control design tokens.
 *
 * Single source of truth for all input / select / textarea styling so every
 * modal, detail panel and dialog looks identical.  Import these instead of
 * declaring local `fieldCls` / `fieldStyle` constants in each component.
 *
 * Usage:
 *   import { FIELD_CLS, FIELD_STYLE, FIELD_STYLE_READONLY, INLINE_FIELD_CLS, INLINE_FIELD_STYLE } from '@/shared/config/form-tokens'
 */
import { BRAND } from './brand'

// ── Standard modal / detail-panel field ──────────────────────────────────────
/** Full-width input, select, or textarea inside a modal or detail sidebar. */
export const FIELD_CLS = 'w-full text-ui-md px-3 py-2 rounded bg-white focus:outline-none' as const

export const FIELD_STYLE = {
  border: `1px solid ${BRAND.borderInput}`,
  color: BRAND.textPrimary,
} as const

// ── Read-only display field (non-editable context value) ─────────────────────
/** Same geometry as FIELD_CLS/FIELD_STYLE but with a tinted background to
 *  signal the field is not editable (e.g. Project/Team on Iteration Detail). */
export const FIELD_STYLE_READONLY = {
  border: `1px solid ${BRAND.borderInput}`,
  color: BRAND.textPrimary,
  backgroundColor: BRAND.inputBg,
} as const

// ── Compact inline list-row edit ─────────────────────────────────────────────
/** Tight select/input used directly inside a table row (Backlog, Iteration
 *  Status). Smaller font and padding so the row height stays compact. */
export const INLINE_FIELD_CLS =
  'rounded bg-white text-ui-sm px-1 py-0.5 focus:outline-none' as const

export const INLINE_FIELD_STYLE = {
  border: `1px solid ${BRAND.borderSubtle}`,
  color: BRAND.textPrimary,
} as const
