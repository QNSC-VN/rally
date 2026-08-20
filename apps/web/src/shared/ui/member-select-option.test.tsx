/**
 * The two shared option builders every person / team dropdown goes through.
 *
 * They exist because the settings surface had seven pickers hand-rolling `{ value, label }`, so the
 * same person appeared with an avatar in a list and without one in the dropdown beside it, and typing an
 * email found nobody. `ownerSelectOptions` already did this for the Rally-parity OWNER picker; these are
 * the smaller piece, for the callers whose shape that one does not fit (a filter leading with "All
 * actors", an add-member list with no empty row, a multi-select of teams).
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { memberSelectOption, ownerSelectOptions } from './owner-cell'
import { teamSelectOption } from './team-cell'

const ALICE = { userId: 'u-1', displayName: 'Alice Smith', email: 'alice@qnsc.dev' }

describe('memberSelectOption', () => {
  it('labels with the display name and carries a glyph', () => {
    const option = memberSelectOption(ALICE)

    expect(option.value).toBe('u-1')
    expect(option.label).toBe('Alice Smith')
    expect(option.icon).toBeTruthy()
  })

  it('matches on EMAIL as well as name — the reason a person picker is a search box', () => {
    expect(memberSelectOption(ALICE).searchText).toContain('alice@qnsc.dev')
  })

  it('falls back to email, then to the id, so a nameless row is still selectable', () => {
    expect(memberSelectOption({ userId: 'u-2', email: 'b@qnsc.dev' }).label).toBe('b@qnsc.dev')
    expect(memberSelectOption({ userId: 'u-3' }).label).toBe('u-3')
  })

  it('can match an extra word, for a caller that badges a row', () => {
    // The add-member picker wants "Workspace Admin" to find them, without inventing a second glyph.
    expect(memberSelectOption(ALICE, { extraSearch: 'Workspace Admin' }).searchText).toContain(
      'Workspace Admin',
    )
  })

  it('renders a glyph that is INVISIBLE to the accessible name', () => {
    // The initials sat inside the name before this, so an option announced "AS Alice Smith" and both a
    // screen reader and a `getByRole(name)` query missed the person. Asserted through a ROLE, because
    // that is the computation that was wrong — `queryByText` reads aria-hidden nodes and would pass
    // either way.
    const option = memberSelectOption(ALICE)
    render(
      <button type="button">
        {option.icon}
        {option.label}
      </button>,
    )

    expect(screen.getByRole('button', { name: 'Alice Smith' })).toBeTruthy()
  })
})

describe('ownerSelectOptions still builds the Rally-parity picker', () => {
  it('leads with No Entry, then the current owner, then the members', () => {
    const options = ownerSelectOptions([ALICE], 'u-1', 'Alice Smith')

    expect(options[0]).toMatchObject({ value: '', group: 'Quick Picks' })
    expect(options[1]).toMatchObject({ value: 'u-1', group: 'Quick Picks' })
    expect(options.at(-1)).toMatchObject({ value: 'u-1', group: 'Team Members' })
  })

  it('names a current owner who is NOT in the member list', () => {
    // They may have left the team; a picker that reprinted the placeholder would read as unassigned.
    const options = ownerSelectOptions([], 'gone', 'Departed Person')

    expect(options[1]).toMatchObject({ value: 'gone', label: 'Departed Person' })
  })
})

describe('teamSelectOption', () => {
  it('labels with the team name and carries the square glyph', () => {
    const option = teamSelectOption({ id: 't-1', name: 'Team Beta', key: 'TB' })

    expect(option).toMatchObject({ value: 't-1', label: 'Team Beta' })
    expect(option.icon).toBeTruthy()
  })

  it('renders a glyph that is invisible to the accessible name', () => {
    // A team option used to announce "TB Team Beta" for the same reason.
    const option = teamSelectOption({ id: 't-1', name: 'Team Beta', key: 'TB' })
    render(
      <button type="button">
        {option.icon}
        {option.label}
      </button>,
    )

    expect(screen.getByRole('button', { name: 'Team Beta' })).toBeTruthy()
  })

  it('survives a team with no key', () => {
    expect(teamSelectOption({ id: 't-2', name: 'Keyless' }).label).toBe('Keyless')
  })
})
