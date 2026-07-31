import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { RowExpandToggle } from './row-expand-toggle'

describe('RowExpandToggle', () => {
  it('reports its state to a screen reader, not only by rotation', () => {
    // The chevron's angle is the visual cue; `aria-expanded` is the only one a screen reader
    // has, and a disclosure with neither is just a mystery button.
    const { rerender } = render(
      <RowExpandToggle expanded={false} onToggle={vi.fn()} label="Expand tasks" />,
    )
    expect(screen.getByRole('button', { name: 'Expand tasks' }).getAttribute('aria-expanded')).toBe(
      'false',
    )

    rerender(<RowExpandToggle expanded onToggle={vi.fn()} label="Collapse tasks" />)
    expect(
      screen.getByRole('button', { name: 'Collapse tasks' }).getAttribute('aria-expanded'),
    ).toBe('true')
  })

  it('calls back on click', () => {
    const onToggle = vi.fn()
    render(<RowExpandToggle expanded={false} onToggle={onToggle} label="Expand" />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('does NOT let the click reach the row underneath', () => {
    // Grid rows open a detail view when clicked. Disclosing children is not opening the row, so
    // the event must stop here — otherwise expanding a team navigates away from the plan.
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <RowExpandToggle expanded={false} onToggle={vi.fn()} label="Expand" />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(onRowClick).not.toHaveBeenCalled()
  })
})
