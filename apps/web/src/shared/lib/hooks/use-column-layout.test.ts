import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useColumnLayout, type ColumnDef } from './use-column-layout'

type K = 'id' | 'name' | 'status'

const COLUMNS: ColumnDef<K>[] = [
  { key: 'id', label: 'ID', defaultWidth: 60, locked: true },
  { key: 'name', label: 'Name', defaultWidth: 200 },
  { key: 'status', label: 'Status', defaultWidth: 120 },
]

const KEY = 'test-layout'

describe('useColumnLayout', () => {
  beforeEach(() => localStorage.clear())

  it('defaults order to the column order and nothing hidden', () => {
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    expect(result.current.order).toEqual(['id', 'name', 'status'])
    expect(result.current.hidden.size).toBe(0)
  })

  it('toggles a column hidden and persists it', () => {
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    act(() => result.current.toggleVisible('status'))
    expect(result.current.hidden.has('status')).toBe(true)
    const stored = JSON.parse(localStorage.getItem(`${KEY}:layout`)!)
    expect(stored.hidden).toContain('status')
  })

  it('refuses to hide a locked column', () => {
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    act(() => result.current.toggleVisible('id'))
    expect(result.current.hidden.has('id')).toBe(false)
  })

  it('un-hides on a second toggle', () => {
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    act(() => result.current.toggleVisible('status'))
    act(() => result.current.toggleVisible('status'))
    expect(result.current.hidden.has('status')).toBe(false)
  })

  it('reorders a column before another and persists', () => {
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    act(() => result.current.reorder('status', 'name'))
    expect(result.current.order).toEqual(['id', 'status', 'name'])
    const stored = JSON.parse(localStorage.getItem(`${KEY}:layout`)!)
    expect(stored.order).toEqual(['id', 'status', 'name'])
  })

  it('reorders a column after another (left-to-right drag)', () => {
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    act(() => result.current.reorder('id', 'name', 'after'))
    expect(result.current.order).toEqual(['name', 'id', 'status'])
  })

  it('is a no-op when reordering a column onto itself', () => {
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    act(() => result.current.reorder('name', 'name'))
    expect(result.current.order).toEqual(['id', 'name', 'status'])
  })

  it('hydrates stored order/hidden and appends newly-added columns', () => {
    localStorage.setItem(
      `${KEY}:layout`,
      JSON.stringify({ order: ['status', 'name'], hidden: ['status'] }),
    )
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    // stored order first (known keys), then any columns missing from storage ('id')
    expect(result.current.order).toEqual(['status', 'name', 'id'])
    expect(result.current.hidden.has('status')).toBe(true)
  })

  it('styleFor returns display:none for a hidden column', () => {
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    act(() => result.current.toggleVisible('status'))
    expect(result.current.styleFor('status').display).toBe('none')
  })

  it('styleFor pins width and strips inherited flex sizing', () => {
    const { result } = renderHook(() => useColumnLayout(COLUMNS, KEY))
    const style = result.current.styleFor('name', { flexGrow: 1, flexShrink: 1 })
    expect(style.width).toBe(200)
    expect(style.minWidth).toBe(200)
    expect(style.maxWidth).toBe(200)
    expect(style.flex).toBe('0 0 200px')
    expect(style.flexGrow).toBeUndefined()
    expect(style.flexShrink).toBeUndefined()
  })
})
