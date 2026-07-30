import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { useDataTable } from '@/shared/ui/table'
import { ListPageScaffold } from './list-page-scaffold'

interface Thing {
  id: string
  name: string
}

/** 60 rows over a 25-per-page default: `row-30` is on page 2, `row-59` on page 3. */
const ROWS: Thing[] = Array.from({ length: 60 }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}` }))

/**
 * The scaffold takes its header wiring from `useDataTable`, so the harness uses the real hook
 * rather than a hand-built stub — a stub would drift from the shape the pages actually pass.
 */
function Harness({ revealRowId, items = ROWS }: { revealRowId?: string | null; items?: Thing[] }) {
  const table = useDataTable<Thing, unknown, 'name'>(
    [{ key: 'name', label: 'Name', defaultWidth: 200 }],
    { storageKey: 'test-reveal-columns' },
  )

  return (
    <ListPageScaffold<Thing, 'name'>
      header={<h1>Things</h1>}
      search={{ value: '', onChange: () => {} }}
      headerProps={table.headerProps}
      headerColumns={table.headerColumns}
      colStyles={table.colStyles}
      items={items}
      revealRowId={revealRowId}
      selectable={false}
      renderRow={(row, { revealed }) => (
        <div key={row.id} data-testid={row.id} data-revealed={revealed || undefined}>
          {row.name}
        </div>
      )}
    />
  )
}

const renderList = (revealRowId?: string | null, items?: Thing[]) =>
  render(<Harness revealRowId={revealRowId} items={items} />)

describe('ListPageScaffold — revealRowId', () => {
  it('shows page one and nothing revealed by default', () => {
    renderList()
    expect(screen.getByTestId('row-0')).toBeTruthy()
    expect(screen.queryByTestId('row-30')).toBeNull()
  })

  it('jumps to the page holding the named row', () => {
    // The actual bug this exists for: a newly created row is ranked LAST, so on a populated
    // list it lands on a page the user is not looking at and "Create" appears to do nothing.
    renderList('row-59')
    expect(screen.getByTestId('row-59')).toBeTruthy()
    expect(screen.queryByTestId('row-0')).toBeNull()
  })

  it('marks the revealed row so it can be highlighted', () => {
    renderList('row-30')
    expect(screen.getByTestId('row-30').getAttribute('data-revealed')).toBe('true')
    // Only that row — a flash on everything is not a hint.
    expect(screen.getByTestId('row-25').getAttribute('data-revealed')).toBeNull()
  })

  it('hands control back the moment the user pages by hand', () => {
    // The override is derived, so without this the user would be pinned to the revealed page
    // and the pager would look broken.
    renderList('row-59')
    expect(screen.getByTestId('row-59')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /previous page/i }))
    expect(screen.queryByTestId('row-59')).toBeNull()
    // And the flash goes with it.
    expect(screen.queryByText('[data-revealed="true"]')).toBeNull()
  })

  it('waits for a row that does not exist YET', () => {
    // The id usually arrives before the row does: the create returns, and the list is still
    // refetching. Keying the effect on the id alone would miss it forever.
    const { rerender } = renderList('row-99')
    expect(screen.getByTestId('row-0')).toBeTruthy()

    rerender(<Harness revealRowId="row-99" items={[...ROWS, { id: 'row-99', name: 'Row 99' }]} />)
    expect(screen.getByTestId('row-99')).toBeTruthy()
    expect(screen.getByTestId('row-99').getAttribute('data-revealed')).toBe('true')
  })

  it('does nothing at all when the id never matches', () => {
    // A stale id — the item was deleted, say — must not strand the user on a blank page.
    renderList('nope')
    expect(screen.getByTestId('row-0')).toBeTruthy()
  })
})
