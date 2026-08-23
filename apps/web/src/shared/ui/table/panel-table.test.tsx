/**
 * `PanelTable`'s one job is that a heading cannot be squeezed by its neighbour's content.
 *
 * Home's two tables hand-rolled this layout and shared one defect: `flex-1` on the Name column with
 * no `min-w-0`, so a flex item's default `min-width: auto` stopped it shrinking below its content
 * and a long project name pushed the fixed columns until every remaining heading wrapped. jsdom
 * does not lay out, so this asserts the STYLE CONTRACT that produces the layout rather than pixels.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PanelTable, PanelTableCell, PanelTableRow, type PanelTableColumn } from './panel-table'

const COLUMNS: PanelTableColumn[] = [
  { key: 'key', label: 'Key', width: 112 },
  { key: 'name', label: 'Project Name' },
  { key: 'defects', label: 'Open Defects', width: 116, align: 'right' },
]

describe('PanelTable', () => {
  it('gives the flexible column `min-width: 0` — the whole defect', () => {
    render(<PanelTable columns={COLUMNS} />)
    const name = screen.getByText('Project Name')
    // Without this the column cannot shrink below its content and squeezes its neighbours until
    // their headings wrap.
    expect(name.style.minWidth).toBe('0px')
    expect(name.style.flex).toContain('1')
  })

  it('makes every fixed column immovable, so a heading always gets its declared room', () => {
    render(<PanelTable columns={COLUMNS} />)
    for (const [label, width] of [
      ['Key', '112px'],
      ['Open Defects', '116px'],
    ] as const) {
      const cell = screen.getByText(label)
      expect(cell.style.width).toBe(width)
      expect(cell.style.flexShrink).toBe('0')
    }
  })

  it('CLIPS a heading rather than wrapping it', () => {
    // A wrapped heading changes the header's height and stops it aligning with the body rows —
    // the visible half of the reported defect.
    render(<PanelTable columns={COLUMNS} />)
    expect(screen.getByText('Open Defects').className).toContain('truncate')
  })

  it('sizes a body cell from the SAME column object as its heading', () => {
    render(
      <PanelTable columns={COLUMNS}>
        <PanelTableRow>
          <PanelTableCell column={COLUMNS[0]}>NXP</PanelTableCell>
          <PanelTableCell column={COLUMNS[1]}>NX Platform</PanelTableCell>
        </PanelTableRow>
      </PanelTable>,
    )
    // The header and its column cannot be given different widths, which is how the two hand-rolled
    // Home tables had already drifted apart from each other.
    expect(screen.getByText('NXP').style.width).toBe('112px')
    expect(screen.getByText('NX Platform').style.minWidth).toBe('0px')
  })

  it('lets a row GROW for wrapped content instead of clipping it', () => {
    const { container } = render(
      <PanelTable columns={COLUMNS}>
        <PanelTableRow>
          <PanelTableCell column={COLUMNS[1]}>a very long title</PanelTableCell>
        </PanelTableRow>
      </PanelTable>,
    )
    // `min-h-*`, never a fixed height: a fixed one clips a wrapped cell rather than growing.
    const row = container.querySelector('.min-h-9')
    expect(row).not.toBeNull()
  })
})
