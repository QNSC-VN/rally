import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CompositeBar } from './composite-bar'

/**
 * A named segment's width.
 *
 * By NAME, not by DOM order: Rally layers estimated → rollup → complete, and an earlier version
 * of this test asserted positions, so re-layering the bar broke assertions that were still true.
 */
function width(container: HTMLElement, segment: 'complete' | 'rollup' | 'estimated'): string {
  const el = container.querySelector<HTMLElement>(`[data-segment="${segment}"]`)
  return el?.style.width ?? 'absent'
}

describe('CompositeBar', () => {
  it('scales against CAPACITY when there is one', () => {
    const { container } = render(
      <CompositeBar complete={25} rollup={50} estimated={0} capacity={100} />,
    )
    expect(width(container, 'rollup')).toBe('50%')
    expect(width(container, 'complete')).toBe('25%')
  })

  it('scales against the LARGEST value when there is no capacity', () => {
    // A Feature row has no capacity of its own; scaling to an invented baseline would imply
    // a ceiling nobody set, and dividing by zero would make every width NaN.
    const { container } = render(
      <CompositeBar complete={5} rollup={20} estimated={10} capacity={null} />,
    )
    // Scale is the largest value (rollup 20), so rollup fills the track and complete is a quarter.
    expect(width(container, 'rollup')).toBe('100%')
    expect(width(container, 'complete')).toBe('25%')
    expect(width(container, 'estimated')).toBe('50%')
  })

  it('renders nothing filled when every value is zero', () => {
    const { container } = render(
      <CompositeBar complete={0} rollup={0} estimated={0} capacity={null} />,
    )
    expect(width(container, 'rollup')).toBe('0%')
    expect(width(container, 'complete')).toBe('0%')
    // Nothing committed either, so the hatch is not drawn at all.
    expect(width(container, 'estimated')).toBe('absent')
  })

  it('treats a capacity of zero as no ceiling rather than dividing by it', () => {
    // An entered ceiling of 0 is a real state, but it cannot be a denominator.
    const { container } = render(
      <CompositeBar complete={0} rollup={10} estimated={0} capacity={0} />,
    )
    expect(width(container, 'rollup')).toBe('100%')
  })

  it('clamps an over-capacity bar to the track instead of overflowing it', () => {
    const { container } = render(
      <CompositeBar complete={0} rollup={150} estimated={0} capacity={100} />,
    )
    expect(width(container, 'rollup')).toBe('100%')
  })

  it('shows the warning glyph only when a rule fired', () => {
    const quiet = render(<CompositeBar complete={0} rollup={1} estimated={1} capacity={10} />)
    expect(quiet.container.querySelector('svg')).toBeNull()

    const loud = render(
      <CompositeBar
        complete={0}
        rollup={20}
        estimated={1}
        capacity={10}
        warningLabels={['Child work already exceeds the capacity']}
      />,
    )
    expect(loud.container.querySelector('svg')).not.toBeNull()
  })

  it('makes the glyph say WHY, to a mouse and to a screen reader', () => {
    // The glyph used to carry no title and no accessible name, so the planner could see
    // that something was wrong and had no way to find out what.
    const { getByRole } = render(
      <CompositeBar
        complete={0}
        rollup={20}
        estimated={0}
        capacity={10}
        warningLabels={['No capacity entered', 'Child work already exceeds the capacity']}
      />,
    )
    const glyph = getByRole('img', { name: /No capacity entered/ })
    // Every rule that fired is listed, not just the first.
    expect(glyph.getAttribute('title')).toContain('Child work already exceeds the capacity')
    expect(glyph.getAttribute('aria-label')).toContain('Child work already exceeds the capacity')
  })

  it('draws the target marker only with a real capacity and a sub-100 target', () => {
    const withTarget = render(
      <CompositeBar complete={0} rollup={1} estimated={1} capacity={100} targetLoadPct={80} />,
    )
    // The marker is positioned by `left`, not `width`, so it is the only such element.
    expect(withTarget.container.querySelector('[style*="left: 80%"]')).not.toBeNull()

    // 100% means "reserve no headroom" — there is nothing to mark.
    const noTarget = render(
      <CompositeBar complete={0} rollup={1} estimated={1} capacity={100} targetLoadPct={100} />,
    )
    expect(noTarget.container.querySelector('[style*="left: 100%"]')).toBeNull()

    // No capacity means no baseline for a percentage marker either.
    const noCapacity = render(
      <CompositeBar complete={0} rollup={1} estimated={1} capacity={null} targetLoadPct={80} />,
    )
    expect(noCapacity.container.querySelector('[style*="left: 80%"]')).toBeNull()
  })

  it('fills the HEADROOM with the capacity hatch, starting where the commitment ends', () => {
    // Rally's green tail. It begins at `estimated`, not at `rollup`: the commitment is what has
    // claimed the space, even where no child work exists yet.
    const { container } = render(
      <CompositeBar complete={10} rollup={20} estimated={40} capacity={100} />,
    )
    const headroom = container.querySelector<HTMLElement>('[data-segment="capacity"]')
    expect(headroom).not.toBeNull()
    expect(headroom?.style.left).toBe('40%')
  })

  it('draws NO headroom when the commitment fills the ceiling', () => {
    const { container } = render(
      <CompositeBar complete={0} rollup={0} estimated={100} capacity={100} />,
    )
    expect(container.querySelector('[data-segment="capacity"]')).toBeNull()
  })

  it('draws no headroom for a row with no ceiling of its own', () => {
    // A Feature has no capacity, so there is no room to be left over.
    const { container } = render(
      <CompositeBar complete={1} rollup={2} estimated={3} capacity={null} />,
    )
    expect(container.querySelector('[data-segment="capacity"]')).toBeNull()
  })

  it('pins the warning to the LEFT edge when the row is over its ceiling', () => {
    // Over capacity the bar is already full, so position cannot encode the amount — Rally puts the
    // glyph at the start, where the overflow began.
    const { container } = render(
      <CompositeBar
        complete={0}
        rollup={150}
        estimated={150}
        capacity={100}
        warningLabels={['Child work already exceeds the capacity']}
      />,
    )
    const glyph = container.querySelector<HTMLElement>('[data-segment="warning"]')
    expect(glyph?.style.left).toBe('0px')
  })

  it('puts the warning at the END of the longest band when the row still fits', () => {
    const { container } = render(
      <CompositeBar
        complete={0}
        rollup={0}
        estimated={0}
        capacity={100}
        warningLabels={['This Feature has no estimate']}
      />,
    )
    // Nothing drawn yet, so the boundary is the start of the track.
    expect(container.querySelector('[data-segment="warning"]')).not.toBeNull()
  })
})
