import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { RatioMeter } from './ratio-meter'

/** The filled element is the only one carrying an inline width. */
function fillWidth(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLElement>('[style*="width"]')?.style.width
}

describe('RatioMeter', () => {
  it('prints the percentage the CALLER computed, not its own rounding', () => {
    // Release Tracking floors (RT-BR-05). Re-deriving here would turn 99.6% into "100%" — a number
    // that says finished about work that is not.
    render(<RatioMeter ratio={0.996} percent={99} accepted={249} total={250} />)
    expect(screen.getByText('99%')).toBeTruthy()
    expect(screen.queryByText('100%')).toBeNull()
  })

  it('still draws the bar when the percentage is suppressed', () => {
    // A Derived Feature shows `accepted/total` and no percentage, because its denominator is a slice
    // of the Feature. The PROPORTION of that slice is still real and still drawn — reading the fill
    // off the (null) percentage left a half-done row with an empty track.
    const { container } = render(
      <RatioMeter ratio={0.5} percent={null} hidePercent accepted={5} total={10} />,
    )
    expect(fillWidth(container)).toBe('50%')
    expect(screen.queryByText('50%')).toBeNull()
    expect(screen.getByText('5/10')).toBeTruthy()
  })

  it('clamps the fill but not the number', () => {
    // Over-delivery against a top-down forecast is real and is the point of the number; a fill wider
    // than its track is a broken layout.
    const { container } = render(<RatioMeter ratio={2} percent={200} accepted={20} total={10} />)
    expect(screen.getByText('200%')).toBeTruthy()
    expect(fillWidth(container)).toBe('100%')
  })

  it('renders the placeholder for no denominator rather than 0%', () => {
    const { container } = render(<RatioMeter ratio={null} accepted={0} total={0} />)
    expect(screen.getByText('--')).toBeTruthy()
    expect(fillWidth(container)).toBe('0%')
  })

  it("takes the caller's wording for the ratio when it carries the unit", () => {
    // `Chart Unit` switches points and counts, so the cell says which it is.
    render(
      <RatioMeter ratio={0.5} percent={50} accepted={5} total={10} label="5/10 points accepted" />,
    )
    expect(screen.getByText('5/10 points accepted')).toBeTruthy()
  })
})
