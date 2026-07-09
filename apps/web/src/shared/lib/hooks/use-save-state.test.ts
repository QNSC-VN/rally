import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSaveState } from './use-save-state'

describe('useSaveState', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts idle', () => {
    const { result } = renderHook(() => useSaveState())
    expect(result.current.status).toBe('idle')
    expect(result.current.errorMsg).toBeNull()
  })

  it('resolves to saved and auto-resets to idle after the delay', async () => {
    const { result } = renderHook(() => useSaveState(2000))

    await act(async () => {
      await result.current.wrap(() => Promise.resolve('ok'))
    })
    expect(result.current.status).toBe('saved')

    // auto-reset back to idle after the reset delay
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.status).toBe('idle')
  })

  it('captures the error message on failure and returns undefined', async () => {
    const { result } = renderHook(() => useSaveState())

    let ret: unknown
    await act(async () => {
      ret = await result.current.wrap(() => Promise.reject(new Error('boom')))
    })
    expect(ret).toBeUndefined()
    expect(result.current.status).toBe('error')
    expect(result.current.errorMsg).toBe('boom')
  })

  it('reset() returns to idle and clears the error', async () => {
    const { result } = renderHook(() => useSaveState())
    await act(async () => {
      await result.current.wrap(() => Promise.reject(new Error('x')))
    })
    expect(result.current.status).toBe('error')

    act(() => result.current.reset())
    expect(result.current.status).toBe('idle')
    expect(result.current.errorMsg).toBeNull()
  })
})
