/**
 * `OwnerCell` — the chip aligns with the WHOLE name, and clipping is the column's choice.
 *
 * Two reported faults, one component. The chip was `items-start`, which is indistinguishable from
 * centring on a one-line name and visibly top-heavy on a wrapped one — and a full name wrapping in a
 * narrow column is the ordinary case, not the exception. And Quality renders two people per row, so
 * a wrapped name there grew every row to two lines; a wide column like Home's should still wrap,
 * because a clipped name is unreadable and the name is the whole value.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OwnerCell } from './owner-cell'

const NAME = 'Hieu Vu Minh Bui'

describe('OwnerCell', () => {
  it('centres the chip against the name, however many lines it takes', () => {
    const { container } = render(<OwnerCell name={NAME} />)
    const row = container.firstElementChild as HTMLElement
    expect(row.className).toContain('items-center')
    expect(row.className).not.toContain('items-start')
  })

  it('WRAPS by default — a wide column must show the whole name', () => {
    render(<OwnerCell name={NAME} />)
    const label = screen.getByText(NAME)
    expect(label.className).toContain('whitespace-normal')
    expect(label.className).not.toContain('truncate')
    // No tooltip when nothing is hidden: repeating a fully visible name is noise.
    expect(label.getAttribute('title')).toBeNull()
  })

  it('CLIPS when the column asks, and keeps the full name reachable', () => {
    render(<OwnerCell name={NAME} truncate />)
    const label = screen.getByText(NAME)
    expect(label.className).toContain('truncate')
    expect(label.className).toContain('whitespace-nowrap')
    expect(label.getAttribute('title'), 'a clipped name must stay readable').toBe(NAME)
  })

  it('still renders the absent placeholder, never a blank cell', () => {
    // `--` is this app's only placeholder for an unknown value, and it predates both changes above.
    render(<OwnerCell name={null} />)
    expect(screen.getByText('--')).toBeTruthy()
  })
})
