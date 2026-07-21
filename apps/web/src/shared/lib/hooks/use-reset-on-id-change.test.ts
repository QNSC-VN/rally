import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResetOnIdChange } from './use-reset-on-id-change'

describe('useResetOnIdChange', () => {
  it('does not reset on the initial render (id already synced)', () => {
    const reset = vi.fn()
    renderHook(({ id }) => useResetOnIdChange(id, reset), { initialProps: { id: 'a' } })
    expect(reset).not.toHaveBeenCalled()
  })

  it('resets when the id changes', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ id }) => useResetOnIdChange(id, reset), {
      initialProps: { id: 'a' },
    })
    rerender({ id: 'b' })
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('does not reset again when the id is unchanged (e.g. background refetch)', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ id }) => useResetOnIdChange(id, reset), {
      initialProps: { id: 'a' },
    })
    rerender({ id: 'a' })
    rerender({ id: 'a' })
    expect(reset).not.toHaveBeenCalled()
  })

  it('resets when the id first becomes defined (undefined -> value)', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useResetOnIdChange(id, reset),
      { initialProps: { id: undefined as string | undefined } },
    )
    rerender({ id: 'a' })
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
