/**
 * `useDetailBack` — the two branches, and why both exist.
 *
 * The defect it fixes was measured in a browser: `/item/$itemKey` sent the reader to `/backlog` from
 * Home > My Work, from Iteration Status and from Quality > Defects alike, because every detail page
 * hardcoded its own list route. So the case that matters is the FIRST one — back walks history — and
 * the fallback is what keeps a deep link from stepping outside the app.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const back = vi.fn()
const navigate = vi.fn()
const canGoBack = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { back }, navigate }),
  useCanGoBack: () => canGoBack(),
}))

import { useDetailBack } from './use-detail-back'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useDetailBack', () => {
  it('walks history when there is an earlier entry in this app', () => {
    canGoBack.mockReturnValue(true)
    const { result } = renderHook(() => useDetailBack({ to: '/backlog' }))

    result.current()

    expect(back).toHaveBeenCalledTimes(1)
    // The list is NOT visited: navigating there instead is the whole defect — a third place, with
    // different filters, and on a cross-project surface a project the reader never chose.
    expect(navigate).not.toHaveBeenCalled()
  })

  it("falls back to the entity's list on a deep link, where there is no earlier entry", () => {
    canGoBack.mockReturnValue(false)
    const { result } = renderHook(() => useDetailBack({ to: '/releases' }))

    result.current()

    expect(navigate).toHaveBeenCalledWith({ to: '/releases' })
    // `history.back()` here would leave the app entirely, or do nothing at all.
    expect(back).not.toHaveBeenCalled()
  })

  it('re-reads the branch on every call, so a first navigation makes back available', () => {
    canGoBack.mockReturnValue(false)
    const { result, rerender } = renderHook(() => useDetailBack({ to: '/backlog' }))

    result.current()
    expect(navigate).toHaveBeenCalledTimes(1)

    canGoBack.mockReturnValue(true)
    rerender()
    result.current()

    expect(back).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})
