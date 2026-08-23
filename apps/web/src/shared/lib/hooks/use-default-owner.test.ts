/**
 * The Owner default is a RULE with two halves, and each half was a real defect once.
 *
 * `WIC-FR-006` reversed `GAP-P1-WID-007`/`P6-TC-007`, so the gate is the only thing standing between
 * this default and the defect the reversal came from — a creator seeded UNCONDITIONALLY, owning work
 * on a team they need not belong to. And the `touched` half is what four create surfaces disagreed
 * about: one wrote `ownerId || <default>`, where `Unassigned` is `''` and therefore falsy, so a
 * cleared Owner was handed straight back.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useDefaultOwner } from './use-default-owner'

const ME = 'user-me'
const OTHER = 'user-other'

function signIn(id: string | undefined) {
  useAuthStore.setState({ user: id ? ({ id } as never) : undefined } as never)
}

describe('useDefaultOwner', () => {
  beforeEach(() => signIn(ME))

  it('defaults to the current user when the feed offers them', () => {
    const { result } = renderHook(() => useDefaultOwner([{ userId: OTHER }, { userId: ME }]))
    expect(result.current.ownerId).toBe(ME)
    expect(result.current.touched).toBe(false)
  })

  it('defaults to UNASSIGNED when the feed does not offer them', () => {
    // The gate. Without it this is `GAP-P1-WID-007`: a creator owning work on a team they are not
    // on, which a Task then inherits and Team Capacity attributes to a named member.
    const { result } = renderHook(() => useDefaultOwner([{ userId: OTHER }]))
    expect(result.current.ownerId).toBe('')
  })

  it('defaults to UNASSIGNED when nobody is signed in', () => {
    signIn(undefined)
    const { result } = renderHook(() => useDefaultOwner([{ userId: ME }]))
    expect(result.current.ownerId).toBe('')
  })

  it('KEEPS an explicit Unassigned — the `ownerId || default` bug', () => {
    const { result } = renderHook(() => useDefaultOwner([{ userId: ME }]))
    expect(result.current.ownerId).toBe(ME)

    act(() => result.current.setOwnerId(''))

    // The whole point: `''` is falsy, so a `value || default` spelling reasserts the default here
    // and the reader can never clear the field.
    expect(result.current.ownerId).toBe('')
    expect(result.current.touched).toBe(true)
  })

  it('lets a chosen owner survive a feed change', () => {
    const { result, rerender } = renderHook(({ feed }) => useDefaultOwner(feed), {
      initialProps: { feed: [{ userId: ME }, { userId: OTHER }] },
    })
    act(() => result.current.setOwnerId(OTHER))
    rerender({ feed: [{ userId: ME }] })
    expect(result.current.ownerId, 'a deliberate choice is never overwritten').toBe(OTHER)
  })

  it('FOLLOWS the feed while untouched — the default is derived, not stored', () => {
    // A Team change swaps the candidate feed. A default written into state by an effect would be
    // stale here (and would cascade a render); recomputing is what keeps it right.
    const { result, rerender } = renderHook(({ feed }) => useDefaultOwner(feed), {
      initialProps: { feed: [{ userId: OTHER }] },
    })
    expect(result.current.ownerId).toBe('')

    rerender({ feed: [{ userId: ME }] })
    expect(result.current.ownerId).toBe(ME)
  })
})

/**
 * `resetOwner` versus `setOwnerId('')` — the pair that made a reported bug possible.
 *
 * A Team change has to drop an owner belonging to the previous team, and the obvious spelling for
 * that is `setOwnerId('')`. It is wrong: `''` IS the reader's explicit `Unassigned`, a choice they
 * are entitled to keep, so recording it suppressed the default for the rest of the form's life —
 * open with `All Teams`, pick a Team containing yourself, and Owner stayed `— No Entry —`
 * (reported 2026-08-23). "Forget what was chosen" and "choose nobody" are different intents.
 */
describe('useDefaultOwner — resetOwner', () => {
  beforeEach(() => signIn(ME))

  it('falls back to the default again, where setOwnerId("") would not', () => {
    const { result, rerender } = renderHook(({ feed }) => useDefaultOwner(feed), {
      initialProps: { feed: [] as { userId: string }[] },
    })

    // The reported sequence: no team, so no candidates and no default.
    expect(result.current.ownerId).toBe('')

    // What the Team-change handler used to do.
    act(() => result.current.setOwnerId(''))
    rerender({ feed: [{ userId: ME }] })
    expect(
      result.current.ownerId,
      'an explicit Unassigned is a CHOICE and must survive a feed change',
    ).toBe('')

    // What it does now.
    act(() => result.current.resetOwner())
    expect(result.current.ownerId, 'resetOwner forgets the choice, so the default applies').toBe(ME)
    expect(result.current.touched).toBe(false)
  })

  it('still lets the reader hold Unassigned deliberately after a reset', () => {
    // The control: reset must not make `Unassigned` unreachable, or it has traded one bug for the
    // `ownerId || default` bug this hook was written to fix.
    const { result } = renderHook(() => useDefaultOwner([{ userId: ME }]))
    act(() => result.current.resetOwner())
    expect(result.current.ownerId).toBe(ME)

    act(() => result.current.setOwnerId(''))
    expect(result.current.ownerId).toBe('')
    expect(result.current.touched).toBe(true)
  })
})
