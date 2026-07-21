import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCursorPagination } from './use-cursor-pagination'

describe('useCursorPagination', () => {
  it('starts on the first page (null cursor, no prev)', () => {
    const { result } = renderHook(() => useCursorPagination())
    expect(result.current.cursor).toBeNull()
    expect(result.current.hasPrev).toBe(false)
  })

  it('goNext advances the cursor and enables prev', () => {
    const { result } = renderHook(() => useCursorPagination())
    act(() => result.current.goNext('c1'))
    expect(result.current.cursor).toBe('c1')
    expect(result.current.hasPrev).toBe(true)
  })

  it('goPrev walks back through history exactly', () => {
    const { result } = renderHook(() => useCursorPagination())
    act(() => result.current.goNext('c1'))
    act(() => result.current.goNext('c2'))
    expect(result.current.cursor).toBe('c2')
    act(() => result.current.goPrev())
    expect(result.current.cursor).toBe('c1')
    act(() => result.current.goPrev())
    expect(result.current.cursor).toBeNull()
    expect(result.current.hasPrev).toBe(false)
  })

  it('goPrev is a no-op on the first page', () => {
    const { result } = renderHook(() => useCursorPagination())
    act(() => result.current.goPrev())
    expect(result.current.cursor).toBeNull()
    expect(result.current.hasPrev).toBe(false)
  })

  it('reset returns to the first page', () => {
    const { result } = renderHook(() => useCursorPagination())
    act(() => result.current.goNext('c1'))
    act(() => result.current.goNext('c2'))
    act(() => result.current.reset())
    expect(result.current.cursor).toBeNull()
    expect(result.current.hasPrev).toBe(false)
  })
})
