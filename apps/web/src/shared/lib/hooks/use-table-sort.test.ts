import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTableSort } from './use-table-sort'

type F = 'name' | 'created'

describe('useTableSort', () => {
  it('defaults to null (unsorted)', () => {
    const { result } = renderHook(() => useTableSort<F>())
    expect(result.current.sort).toBeNull()
    expect(result.current.sortField).toBeNull()
    expect(result.current.sortDir).toBeNull()
  })

  it('toggling a new column sorts it ascending', () => {
    const { result } = renderHook(() => useTableSort<F>())
    act(() => result.current.toggle('name'))
    expect(result.current.sort).toEqual({ field: 'name', dir: 'asc' })
  })

  it('toggling the active column flips direction', () => {
    const { result } = renderHook(() => useTableSort<F>())
    act(() => result.current.toggle('name'))
    act(() => result.current.toggle('name'))
    expect(result.current.sortDir).toBe('desc')
    act(() => result.current.toggle('name'))
    expect(result.current.sortDir).toBe('asc')
  })

  it('toggling a different column resets to ascending on that column', () => {
    const { result } = renderHook(() => useTableSort<F>({ field: 'name', dir: 'desc' }))
    act(() => result.current.toggle('created'))
    expect(result.current.sort).toEqual({ field: 'created', dir: 'asc' })
  })

  it('clear() removes sort', () => {
    const { result } = renderHook(() => useTableSort<F>({ field: 'name', dir: 'asc' }))
    act(() => result.current.clear())
    expect(result.current.sort).toBeNull()
  })
})
