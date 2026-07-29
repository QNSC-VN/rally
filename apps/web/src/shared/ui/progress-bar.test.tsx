import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from './progress-bar'

/** The filled element is the only one carrying an inline width. */
function fillWidth(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLElement>('[style*="width"]')?.style.width
}

describe('ProgressBar', () => {
  it('renders a ratio as a percentage', () => {
    const { container } = render(<ProgressBar ratio={0.25} />)
    expect(screen.getByText('25%')).toBeTruthy()
    expect(fillWidth(container)).toBe('25%')
  })

  it('shows the placeholder for a null ratio rather than 0%', () => {
    // A Feature with no estimate has no denominator. Rendering "0%" would claim no
    // progress, which is a different statement from "not measurable".
    render(<ProgressBar ratio={null} />)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('CLAMPS the fill at 100% but NOT the label, so overrun stays visible', () => {
    // Estimated Progress divides by a top-down forecast, so delivering twice the
    // estimate is genuinely 200%. The bar must not overflow its track, but hiding
    // the number would conceal exactly the overrun this column exists to show.
    const { container } = render(<ProgressBar ratio={2} />)
    expect(screen.getByText('200%')).toBeTruthy()
    expect(fillWidth(container)).toBe('100%')
  })

  it('floors the fill at 0% for a negative ratio', () => {
    const { container } = render(<ProgressBar ratio={-0.5} />)
    expect(fillWidth(container)).toBe('0%')
  })

  it('treats a non-finite ratio as unmeasurable', () => {
    // Guards a 0/0 division upstream reaching the UI as NaN%.
    render(<ProgressBar ratio={Number.NaN} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('can hide the label when the caller shows the numbers itself', () => {
    render(<ProgressBar ratio={0.5} showLabel={false} />)
    expect(screen.queryByText('50%')).toBeNull()
  })
})
