import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CompositeBar } from './composite-bar'

/** Widths of the filled segments, in DOM order: rollup band, then complete band. */
function fills(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="width"]')].map(
    (el) => el.style.width,
  )
}

describe('CompositeBar', () => {
  it('scales against CAPACITY when there is one', () => {
    const { container } = render(
      <CompositeBar complete={25} rollup={50} estimated={0} capacity={100} />,
    )
    expect(fills(container).slice(0, 2)).toEqual(['50%', '25%'])
  })

  it('scales against the LARGEST value when there is no capacity', () => {
    // A Feature row has no capacity of its own; scaling to an invented baseline would imply
    // a ceiling nobody set, and dividing by zero would make every width NaN.
    const { container } = render(
      <CompositeBar complete={5} rollup={20} estimated={10} capacity={null} />,
    )
    expect(fills(container).slice(0, 2)).toEqual(['100%', '25%'])
  })

  it('renders nothing filled when every value is zero', () => {
    const { container } = render(
      <CompositeBar complete={0} rollup={0} estimated={0} capacity={null} />,
    )
    expect(fills(container).slice(0, 2)).toEqual(['0%', '0%'])
  })

  it('treats a capacity of zero as no ceiling rather than dividing by it', () => {
    // An entered ceiling of 0 is a real state, but it cannot be a denominator.
    const { container } = render(
      <CompositeBar complete={0} rollup={10} estimated={0} capacity={0} />,
    )
    expect(fills(container)[0]).toBe('100%')
  })

  it('clamps an over-capacity bar to the track instead of overflowing it', () => {
    const { container } = render(
      <CompositeBar complete={0} rollup={150} estimated={0} capacity={100} />,
    )
    expect(fills(container)[0]).toBe('100%')
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
        warnings={['rollup_exceeds_capacity']}
      />,
    )
    expect(loud.container.querySelector('svg')).not.toBeNull()
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
})
