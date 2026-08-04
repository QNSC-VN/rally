import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ChartLegendItem } from './chart-frame'

/**
 * A legend entry is Rally's series switch: CLICK one and its series leaves the chart, HOVER one and the
 * others recede so a single trajectory can be followed across a crowded plot.
 *
 * Pinned here rather than in the burnup page because the entry is shared by four charts, and the part
 * that is easy to lose in a refactor is the part that is not visual: a hidden entry must still be
 * findable and re-clickable, and it must say which state it is in to a reader who cannot see the swatch.
 */
describe('ChartLegendItem', () => {
  it('is a labelled toggle that reports whether its series is showing', async () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <ChartLegendItem
        color="#123456"
        label="Accepted Points"
        onToggle={onToggle}
        toggleLabel="Hide Accepted Points"
      />,
    )

    const entry = screen.getByRole('button', { name: 'Hide Accepted Points' })
    // `aria-pressed` carries the state a sighted reader gets from the grey swatch.
    expect(entry).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(entry)
    expect(onToggle).toHaveBeenCalledOnce()

    // Hidden, the entry stays a button with a name — hiding a series must not hide the way back.
    rerender(
      <ChartLegendItem
        color="#123456"
        label="Accepted Points"
        hidden
        onToggle={onToggle}
        toggleLabel="Show Accepted Points"
      />,
    )
    expect(screen.getByRole('button', { name: 'Show Accepted Points' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('reports hover both ways, so the highlight can be released', async () => {
    const onHover = vi.fn()
    render(
      <ChartLegendItem
        color="#123456"
        label="Planned Points"
        onToggle={() => {}}
        onHover={onHover}
        toggleLabel="Hide Planned Points"
      />,
    )

    const entry = screen.getByRole('button')
    await userEvent.hover(entry)
    expect(onHover).toHaveBeenLastCalledWith(true)
    await userEvent.unhover(entry)
    // Without the false the chart would stay dimmed forever after one pass of the mouse.
    expect(onHover).toHaveBeenLastCalledWith(false)
  })

  it('stays a plain span when no toggle is given', () => {
    // The three other charts pass no handler: their legends are a key, not a control, and a button
    // there would advertise an interaction that does nothing.
    render(<ChartLegendItem color="#123456" label="Velocity" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Velocity')).toBeInTheDocument()
  })
})
