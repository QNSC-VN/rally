/**
 * Permission Model — the capability matrix, after the migration onto `Card` + `PanelTable`.
 *
 * The assertion that matters is the placeholder. `renderCell` returned `'—'`, and `EMPTY_VALUE`'s
 * own docblock forbids exactly that ("not an em-dash, because that is what real Rally renders").
 * It was the only file in Settings still doing it, and it is the kind of drift that survives review
 * because the two glyphs look alike at a glance — which is why it is pinned by identity here rather
 * than by eye.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EMPTY_VALUE } from '@/shared/lib/utils'
import { PermissionModelTab } from './permission-model-tab'

describe('PermissionModelTab', () => {
  it('uses EMPTY_VALUE for a level that holds nothing, never an em-dash', () => {
    render(<PermissionModelTab />)

    // `Project Settings` is Full / nothing / nothing, so it carries two absent cells.
    expect(screen.getAllByText(EMPTY_VALUE).length).toBeGreaterThan(0)

    // Asserted on the CELLS, not on the page text. An em-dash is legitimate typography here —
    // `Backlog — Work Items` is a capability name and the summary sentence uses one — so a
    // document-wide ban would fail on prose while saying nothing about the placeholder. The rule
    // is about the value rendered for ABSENCE, which is what this reads.
    const absentCells = screen.getAllByText(EMPTY_VALUE)
    for (const cell of absentCells) expect(cell.textContent).toBe(EMPTY_VALUE)
    expect(screen.queryByText('—', { exact: true }), 'no cell renders a bare em-dash').toBeNull()
  })

  it('names every level column, and renders a row per capability', () => {
    render(<PermissionModelTab />)

    for (const heading of ['Feature', 'Workspace Admin', 'Admin', 'Editor']) {
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0)
    }
    // A capability with a real action list, and one that is Full across the board.
    expect(screen.getAllByText('create, edit, delete').length).toBeGreaterThan(0)
    expect(screen.getByText('Iteration Status')).toBeTruthy()
  })

  it('still renders the surrounding explanatory sections', () => {
    // The three Cards are the page: the model summary, the matrix, and the No Access note. A
    // migration that dropped one would still pass the assertions above.
    render(<PermissionModelTab />)

    expect(screen.getAllByText('3-Level Access Model').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No Access').length).toBeGreaterThan(0)
    expect(screen.getByText(/Authorization is fixed/)).toBeTruthy()
  })
})
