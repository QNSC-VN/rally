import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InlineEditableCell } from './inline-editable-cell'

describe('InlineEditableCell', () => {
  it('does not enter edit mode when canEdit is false', () => {
    render(<InlineEditableCell value="10" canEdit={false} onCommit={vi.fn()} />)
    fireEvent.click(screen.getByText('10'))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('click enters edit mode, Enter commits the typed value', () => {
    const onCommit = vi.fn()
    render(<InlineEditableCell value="10" canEdit onCommit={onCommit} />)
    fireEvent.click(screen.getByText('10'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '20' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('20')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('Escape cancels without committing', () => {
    const onCommit = vi.fn()
    render(<InlineEditableCell value="10" canEdit onCommit={onCommit} />)
    fireEvent.click(screen.getByText('10'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByText('10')).toBeTruthy()
  })

  it('dblclick trigger only enters edit mode on double click', () => {
    render(<InlineEditableCell value="x" canEdit trigger="dblclick" onCommit={vi.fn()} />)
    fireEvent.click(screen.getByText('x'))
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.doubleClick(screen.getByText('x'))
    expect(screen.getByRole('textbox')).toBeTruthy()
  })
})
