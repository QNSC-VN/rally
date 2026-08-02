import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useRowSelection } from './use-row-selection'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('useRowSelection', () => {
  it('replaces the selection outright', () => {
    /**
     * The state a partial bulk result needs. After "archive the rest and report the blocked ones"
     * (Portfolio FR-037), the useful next selection is the SKIPPED rows — `clear()` makes the
     * planner hunt for the failures again, and `toggle` per row cannot express it in one step.
     */
    const { result } = renderHook(() => useRowSelection(items))
    act(() => result.current.toggle('a'))
    act(() => result.current.toggle('b'))
    expect(result.current.count).toBe(2)

    act(() => result.current.replace(new Set(['c'])))
    expect([...result.current.selectedIds]).toEqual(['c'])
    expect(result.current.isSelected('a')).toBe(false)
  })

  it('COPIES the set it is handed, so a caller cannot mutate state behind React', () => {
    const { result } = renderHook(() => useRowSelection(items))
    const handed = new Set(['a'])
    act(() => result.current.replace(handed))

    handed.add('b')
    // The hook's state is unmoved: it took a copy, so a later mutation of the caller's set is not
    // a silent, un-rendered state change.
    expect(result.current.count).toBe(1)
    expect(result.current.isSelected('b')).toBe(false)
  })

  it('replaces with an empty set, which is a clear', () => {
    const { result } = renderHook(() => useRowSelection(items))
    act(() => result.current.toggleAll())
    expect(result.current.allSelected).toBe(true)

    act(() => result.current.replace(new Set()))
    expect(result.current.count).toBe(0)
    expect(result.current.allSelected).toBe(false)
  })
})
