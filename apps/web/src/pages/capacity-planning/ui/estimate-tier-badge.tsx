import { useTranslation } from 'react-i18next'
import { BRAND } from '@/shared/config/brand'
import { type EstimateTier } from '@/features/capacity-planning/api'

/**
 * Which tier a Feature's Estimated figure came from.
 *
 * Worth surfacing because the same number means different things: an ALLOCATED value is a
 * commitment a planner typed, a REFINED one is a top-down forecast, and a PRELIMINARY one is
 * only a T-shirt size mapped through workspace settings. Without the badge a planner cannot
 * tell which of their numbers are real commitments and which are placeholders that will move.
 *
 * Order of precedence is Allocated → Refined → Preliminary → none, resolved server-side by
 * `resolveEstimate` so the badge and the arithmetic can never disagree.
 */
const TIER_STYLE: Record<EstimateTier, { color: string; bg: string }> = {
  // A real commitment — the strongest signal.
  allocated: { color: BRAND.primary, bg: BRAND.primaryLighter },
  refined: { color: BRAND.textSecondary, bg: BRAND.surfaceHover },
  // Only a T-shirt size: deliberately the quietest, since it is the least reliable.
  preliminary: { color: BRAND.textMuted, bg: BRAND.surfaceSubtle },
  none: { color: BRAND.textMuted, bg: 'transparent' },
}

export function EstimateTierBadge({ tier }: { tier: EstimateTier }) {
  const { t } = useTranslation('capacity')
  // Nothing to say when there is no estimate at all — an empty badge would be noise.
  if (tier === 'none') return null

  const style = TIER_STYLE[tier]
  return (
    <span
      className="shrink-0 rounded px-1 text-ui-2xs font-semibold uppercase"
      style={{ color: style.color, backgroundColor: style.bg }}
      title={t(`tiers.${tier}Hint`)}
    >
      {t(`tiers.${tier}`)}
    </span>
  )
}
