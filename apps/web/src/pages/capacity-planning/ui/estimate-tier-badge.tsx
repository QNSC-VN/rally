import { useTranslation } from 'react-i18next'
import { Check, Trophy, Star, Users } from 'lucide-react'

import { Tooltip } from '@/shared/ui/tooltip'

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

/**
 * Rally's trailing `Estimate` control: one glyph, and on hover a panel naming ALL THREE candidate
 * estimates with the one in force ticked.
 *
 *     Estimate
 *     👤 Allocated    60   ✓
 *     ★  Refined      —
 *     🏆 Preliminary  250
 *
 * The panel is the point, not the glyph. The same number means different things — an allocated value
 * is a commitment a planner typed, a refined one a top-down forecast, a preliminary one a T-shirt
 * size mapped through settings — and the question a planner actually has is "is this 60 real, or is
 * it a placeholder that will move?". Only showing the losers answers it.
 *
 * Glyphs follow Rally: a person for allocated (someone committed it), a star for refined, a trophy
 * for preliminary. Colours come from `TIER_STYLE`, shared with {@link EstimateTierBadge}, so the two
 * renderings of one fact cannot drift.
 */
const TIER_ICON = { allocated: Users, refined: Star, preliminary: Trophy } as const

export interface EstimateBreakdown {
  allocated: number | null
  refined: number | null
  preliminary: number | null
}

export function EstimateTierIcon({
  tier,
  breakdown,
}: {
  tier: EstimateTier
  /** All three candidates. Omit to render the glyph alone (no panel to show). */
  breakdown?: EstimateBreakdown
}) {
  const { t } = useTranslation('capacity')
  if (tier === 'none') return null

  const Icon = TIER_ICON[tier]
  const style = TIER_STYLE[tier]
  const rows = (['allocated', 'refined', 'preliminary'] as const).map((key) => ({
    key,
    value: breakdown?.[key] ?? null,
    RowIcon: TIER_ICON[key],
    inForce: key === tier,
  }))
  // The accessible name says what the panel says: a hover-only tooltip is invisible to a screen
  // reader, and the tier is the fact the row is reporting. FULL tier names, not the badge's
  // 5-character abbreviations — this string is read aloud, and "Alloc" is not a word.
  const label = rows
    .map((r) => `${t(`tiers.${r.key}Full`)} ${r.value ?? '—'}${r.inForce ? ' ✓' : ''}`)
    .join(', ')

  const glyph = (
    <span role="img" aria-label={`${t('tiers.heading')}: ${label}`} className="flex items-center">
      <Icon size={13} style={{ color: style.color }} />
    </span>
  )
  if (breakdown === undefined) return glyph

  return (
    // The shared `Tooltip`, which PORTALS: a panel rendered inline was clipped by the nested
    // table's scroll container, so the bottom two tiers were cut off — exactly the rows the
    // tooltip exists to show.
    <Tooltip
      side="left"
      delayDuration={150}
      content={
        <span className="block w-40">
          <span className="mb-1 block font-semibold">{t('tiers.heading')}</span>
          {rows.map(({ key, value, RowIcon, inForce }) => (
            <span key={key} className="flex items-center gap-1.5 py-px">
              {/* Non-winning tiers are dimmed rather than hidden: the comparison IS the point, and
                  a planner asking "is this 60 real?" needs to see what it beat. */}
              <RowIcon size={11} className={inForce ? '' : 'opacity-40'} />
              <span className={inForce ? 'flex-1' : 'flex-1 opacity-40'}>
                {t(`tiers.${key}Full`)}
              </span>
              <span className={inForce ? 'tabular-nums' : 'tabular-nums opacity-40'}>
                {value ?? '—'}
              </span>
              {/* Rally's tick marks the one in force. */}
              <Check
                size={11}
                className={inForce ? '' : 'invisible'}
                style={{ color: BRAND.success }}
              />
            </span>
          ))}
        </span>
      }
    >
      {glyph}
    </Tooltip>
  )
}
