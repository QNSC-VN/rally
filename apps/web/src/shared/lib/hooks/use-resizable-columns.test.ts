import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useResizableColumns } from './use-resizable-columns'

function fireDrag(startResize: (col: 'name', e: React.MouseEvent) => void, startX: number, endX: number) {
  act(() => {
    startResize('name', {
      preventDefault: () => {},
      clientX: startX,
    } as unknown as React.MouseEvent)
  })
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: endX }))
  })
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup'))
  })
}

describe('useResizableColumns', () => {
  it('starts at the given default widths', () => {
    const { result } = renderHook(() => useResizableColumns({ name: 100 }))
    expect(result.current.widths.name).toBe(100)
  })

  it('grows a column width by the drag delta', () => {
    const { result } = renderHook(() => useResizableColumns({ name: 100 }))
    fireDrag(result.current.startResize, 0, 40)
    expect(result.current.widths.name).toBe(140)
  })

  it('clamps to the configured min width', () => {
    const { result } = renderHook(() => useResizableColumns({ name: 100 }, { min: { name: 80 } }))
    fireDrag(result.current.startResize, 0, -1000)
    expect(result.current.widths.name).toBe(80)
  })

  it('persists widths to localStorage under storageKey', () => {
    const key = 'test-col-widths'
    localStorage.removeItem(key)
    const { result } = renderHook(() => useResizableColumns({ name: 100 }, { storageKey: key }))
    fireDrag(result.current.startResize, 0, 20)
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ name: 120 })
  })

  it('clamps to the configured max width', () => {
    const { result } = renderHook(() => useResizableColumns({ name: 100 }, { max: { name: 150 } }))
    fireDrag(result.current.startResize, 0, 1000)
    expect(result.current.widths.name).toBe(150)
  })
})
