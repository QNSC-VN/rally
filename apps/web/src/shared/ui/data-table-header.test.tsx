import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DataTableHeader } from './data-table-header'

/**
 * The sortable header, as a keyboard user meets it.
 *
 * This header is shared by every grid in the app — Backlog, Iteration Status, Team Status, Release
 * Tracking — so the sort control being a `div` with `onClick` made a documented feature (RT-AC-05:
 * "Rank, ID and Team sort both directions") reachable only with a pointer.
 */
const columns = [
  { key: 'rank' as const, label: 'Rank', sortCol: 'rank' },
  { key: 'name' as const, label: 'Name' },
]
const colStyles = { rank: { width: 72 }, name: { width: 200 } }

function renderHeader(onSort = vi.fn(), dir: 'asc' | 'desc' = 'asc', col: string | null = 'rank') {
  render(
    <DataTableHeader
      columns={columns}
      colStyles={colStyles}
      onResize={vi.fn()}
      sort={{ col, dir, onSort }}
    />,
  )
  return onSort
}

describe('DataTableHeader sorting', () => {
  it('is reachable by Tab and operable by Enter', async () => {
    const onSort = renderHeader()
    await userEvent.tab()
    const control = screen.getByRole('button', { name: /Rank/ })
    expect(document.activeElement).toBe(control)

    await userEvent.keyboard('{Enter}')
    expect(onSort).toHaveBeenCalledWith('rank')
  })

  it('is operable by Space', async () => {
    // A native `<button>` answers to both keys. The div it replaced answered to neither.
    const onSort = renderHeader()
    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(onSort).toHaveBeenCalledWith('rank')
  })

  it('announces the direction a caret can only show', () => {
    renderHeader(vi.fn(), 'desc', 'rank')
    expect(screen.getByRole('button', { name: /sorted descending/ })).toBeTruthy()
  })

  it('says a sortable column is sortable even when it is not the active sort', () => {
    // Without this the only cue is a hover-coloured chevron.
    renderHeader(vi.fn(), 'asc', 'name')
    expect(screen.getByRole('button', { name: /not sorted/ })).toBeTruthy()
  })

  it('leaves a non-sortable column as plain text, with no control to find', () => {
    renderHeader()
    expect(screen.queryByRole('button', { name: /^Name/ })).toBeNull()
    expect(screen.getByText('Name')).toBeTruthy()
  })
})
