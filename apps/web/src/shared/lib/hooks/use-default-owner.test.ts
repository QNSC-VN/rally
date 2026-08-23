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
