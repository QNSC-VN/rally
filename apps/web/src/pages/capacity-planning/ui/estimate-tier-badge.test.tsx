import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import '@/shared/i18n/i18n'
import { EstimateTierIcon } from './estimate-tier-badge'

/**
 * The `Estimate` panel is a REPLICA of Rally's, matched against a screenshot of the real product's
 * capacity-plan team tab:
 *
 *     Estimate
 *     👤 Allocated      10   ✓   ← in force: plain text, green disc with a white tick
 *     ★  ~~Refined~~    ~~—~~    ← beaten: struck through, em dash for absent
 *     🏆 ~~Preliminary~~ ~~10~~  ← beaten even though its number is equal
 *
 * Four details are easy to lose in a refactor and each carries meaning, so each is pinned here: the
 * strikethrough (a candidate was considered and beaten — dimming alone does not say that), the em dash
 * (Rally's placeholder inside this panel, deliberately not the app's `--`), the tick on exactly one row,
 * and the fact that a LOSING row is still shown with its number, because the comparison is the point.
 *
 * The panel renders inside a hover tooltip, so these assertions read the glyph's accessible NAME, which
 * carries the same three rows and the winner's tick. That is also the only version a screen reader gets.
 */
function renderIcon(over: Parameters<typeof EstimateTierIcon>[0]) {
  render(<EstimateTierIcon {...over} />)
  return screen.getByRole('img')
}

describe('EstimateTierIcon', () => {
  it('names all three candidates and ticks the one in force', () => {
    const glyph = renderIcon({
      tier: 'allocated',
      breakdown: { allocated: 10, refined: null, preliminary: 10 },
    })

    // The screenshot's exact numbers: Allocated 10 wins, Refined is absent, Preliminary is an equal 10
    // and still loses — the tick follows the TIER, not the largest number.
    expect(glyph).toHaveAccessibleName('Estimate: Allocated 10 ✓, Refined —, Preliminary 10')
  })

  it('uses Rally’s em dash for an absent candidate, not the app’s `--`', () => {
    const glyph = renderIcon({
      tier: 'preliminary',
      breakdown: { allocated: null, refined: null, preliminary: 5 },
    })

    expect(glyph.getAttribute('aria-label')).toContain('Allocated —')
    expect(glyph.getAttribute('aria-label')).not.toContain('--')
  })

  it('moves the tick when a lower tier is in force', () => {
    const glyph = renderIcon({
      tier: 'refined',
      breakdown: { allocated: 0, refined: 13, preliminary: 5 },
    })

    // Allocated keeps its `0`: a row committing zero is a real commitment (§246's Team-picker default),
    // unlike a zero FORECAST.
    expect(glyph).toHaveAccessibleName('Estimate: Allocated 0, Refined 13 ✓, Preliminary 5')
  })

  it('shows a ZERO forecast as absent, because zero is not a forecast', () => {
    /**
     * `refined_estimate` is NOT NULL DEFAULT 0 and size `no_entry` maps to 0, and the tier chain requires
     * `> 0` — so a zero candidate can never win. Printing `Refined 0` would offer a candidate that is not
     * one, and Rally's screenshot shows `—` in exactly that row: FE-1 has preliminary M and no refined
     * forecast, and its panel reads `Refined —`.
     */
    const glyph = renderIcon({
      tier: 'allocated',
      breakdown: { allocated: 5, refined: 0, preliminary: 5 },
    })

    expect(glyph).toHaveAccessibleName('Estimate: Allocated 5 ✓, Refined —, Preliminary 5')
  })

  it('appends the allocation SOURCE, which Rally’s panel has no row for', () => {
    // §185-186 label a row `Manual` or `Feature Estimate` — a finer distinction than Rally draws, so it
    // rides the accessible name rather than adding a fourth row the screenshot does not have.
    const glyph = renderIcon({
      tier: 'allocated',
      breakdown: { allocated: 10, refined: null, preliminary: 10 },
      sourceNote: 'Feature Estimate',
    })

    expect(glyph.getAttribute('aria-label')).toContain('. Feature Estimate')
  })

  it('renders nothing when no candidate produced a number', () => {
    // Tier `none` means the Feature is unsized: an empty panel would be a tooltip about nothing.
    render(
      <EstimateTierIcon
        tier="none"
        breakdown={{ allocated: null, refined: null, preliminary: null }}
      />,
    )
    expect(screen.queryByRole('img')).toBeNull()
  })
})
