/**
 * Manage Filters — the shared chooser's contract, for both grids that use it.
 *
 * Pins `P2-BL-FR-005` / `-020` and Backlog AC-7 ("Manage Filters allows selecting multiple columns
 * and combines active filters after Apply"), which `P2-IS-FR-022` inherits, and the two properties
 * that make the control honest rather than decorative:
 *
 *  • **Nothing filters before Apply.** AC-7 makes Apply the moment filters combine, so a value typed
 *    into a control must not reach the query until then — otherwise the button is a lie and the list
 *    re-queries on every keystroke.
 *  • **Un-checking a column drops its value.** A filter still narrowing the list while its control is
 *    hidden is invisible state — the "value HIDDEN on read" smell CLAUDE.md records: the banner reads
 *    as unfiltered, the grid is not, and there is no control left to clear.
 *
 * `P2-BL-TS-015` (quick search independent of Manage Filters) is asserted where it lives — quick
 * search is not a field here at all, which is the structural half of that guarantee; the query-level
 * half is in `test/e2e/manage-filters.e2e.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
// Real copy, not raw keys: every label and every accessible name here comes from `t()`.
import '@/shared/i18n/i18n'
import { useManageFilters, type FilterFieldDef, type FilterValues } from '../model/manage-filters'
import { ManageFiltersBar } from './manage-filters-bar'

type Key = 'itemKey' | 'title' | 'assigneeId'

const FIELDS: FilterFieldDef<Key>[] = [
  { key: 'itemKey', label: 'ID', kind: 'text' },
  { key: 'title', label: 'Name', kind: 'text' },
  {
    key: 'assigneeId',
    label: 'Owner',
    kind: 'select',
    defaultVisible: true,
    options: [
      { value: 'u-1', label: 'Marcus Webb' },
      { value: 'u-2', label: 'Ada Lovelace' },
    ],
  },
]

/** Renders the real bar and exposes what a page would send to the server. */
function Harness({ onApplied }: { onApplied: (v: FilterValues<Key>) => void }) {
  const state = useManageFilters(FIELDS)
  onApplied(state.applied)
  return (
    <div>
      <ManageFiltersBar state={state} />
      <output data-testid="active-count">{state.activeCount}</output>
    </div>
  )
}

function setup() {
  let applied: FilterValues<Key> = {}
  render(<Harness onApplied={(v) => (applied = v)} />)
  return { current: () => applied }
}

const openChooser = () => fireEvent.click(screen.getByRole('button', { name: /Manage Filters/ }))
const applyInBanner = () => fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0])

describe('Manage Filters (shared by Backlog and Iteration Status)', () => {
  it('shows only the default columns until a column is chosen', () => {
    setup()
    // Owner ships visible on both screens; ID and Name are opt-in via the chooser.
    expect(screen.getByLabelText('Owner filter value')).toBeTruthy()
    expect(screen.queryByLabelText('Name filter value')).toBeNull()
  })

  it('P2-BL-TS-014: combines TWO chosen columns into one applied filter set', () => {
    const { current } = setup()

    // Choose Name in the popover — the checkbox column selection FR-020 specifies.
    openChooser()
    fireEvent.click(screen.getByLabelText('Filter by Name'))

    // Both controls are now in the banner; set a value in each.
    fireEvent.change(screen.getByLabelText('Name filter value'), { target: { value: 'SSO' } })
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-1' } })

    applyInBanner()
    expect(current()).toEqual({ title: 'SSO', assigneeId: 'u-1' })
    expect(screen.getByTestId('active-count').textContent).toBe('2')
  })

  it('applies NOTHING before Apply is pressed (AC-7)', () => {
    const { current } = setup()
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-2' } })
    // The control holds the value…
    expect((screen.getByLabelText('Owner filter value') as HTMLSelectElement).value).toBe('u-2')
    // …and the query does not.
    expect(current()).toEqual({})
  })

  it('un-checking a column clears the filter it had applied', () => {
    const { current } = setup()
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-1' } })
    applyInBanner()
    expect(current()).toEqual({ assigneeId: 'u-1' })

    openChooser()
    fireEvent.click(screen.getByLabelText('Filter by Owner'))

    // Gone from the query as well as from the banner — not hidden while still narrowing.
    expect(current()).toEqual({})
    expect(screen.queryByLabelText('Owner filter value')).toBeNull()
  })

  it('Clear removes every applied value', () => {
    const { current } = setup()
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-1' } })
    applyInBanner()
    expect(current()).toEqual({ assigneeId: 'u-1' })

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0])
    expect(current()).toEqual({})
  })

  it('drops an emptied control rather than filtering on an empty string', () => {
    const { current } = setup()
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-1' } })
    applyInBanner()
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: '' } })
    applyInBanner()
    // `assigneeId: ''` would reach the API as a param with no value — a filter that reads as absent.
    expect(current()).toEqual({})
  })
})
