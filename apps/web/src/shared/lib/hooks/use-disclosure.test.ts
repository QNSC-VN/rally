import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDisclosure } from './use-disclosure'

describe('useDisclosure', () => {
  it('starts closed by default', () => {
    const { result } = renderHook(() => useDisclosure())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.data).toBeUndefined()
  })

  it('honours initialOpen', () => {
    const { result } = renderHook(() => useDisclosure(true))
    expect(result.current.isOpen).toBe(true)
  })

  it('open() stashes a payload and close() clears it', () => {
    const { result } = renderHook(() => useDisclosure<{ id: number }>())
    act(() => result.current.open({ id: 7 }))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.data).toEqual({ id: 7 })
    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.data).toBeUndefined()
  })

  it('toggle flips open state', () => {
    const { result } = renderHook(() => useDisclosure())
    act(() => result.current.toggle())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.isOpen).toBe(false)
  })
})
