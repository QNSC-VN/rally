import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useColumnDrag } from './use-column-drag'

type K = 'name' | 'status' | 'owner'

// Minimal React.DragEvent stub: only the fields the hook touches.
function dragEvent(opts: { clientX?: number; clientY?: number; rect?: Partial<DOMRect> } = {}) {
  const rect = { left: 0, right: 100, top: 0, bottom: 20, width: 100, ...opts.rect }
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
  return {
    preventDefault: vi.fn(),
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    dataTransfer,
    currentTarget: { getBoundingClientRect: () => rect as DOMRect },
  } as unknown as React.DragEvent
}

describe('useColumnDrag', () => {
  it('sets activeDragKey on drag start and seeds dataTransfer', () => {
    const onReorder = vi.fn()
    const { result } = renderHook(() => useColumnDrag<K>({ onReorder }))
    const e = dragEvent()
    act(() => result.current.handleDragStart('name', e))
    expect(result.current.activeDragKey).toBe('name')
    expect(
      (e.dataTransfer as unknown as { setData: ReturnType<typeof vi.fn> }).setData,
    ).toHaveBeenCalledWith('text/plain', 'name')
  })

  it('shows a "before" indicator when hovering the left half of another column', () => {
    const { result } = renderHook(() => useColumnDrag<K>({ onReorder: vi.fn() }))
    act(() => result.current.handleDragStart('name', dragEvent()))
    act(() => result.current.handleDragOver('status', dragEvent({ clientX: 20 })))
    expect(result.current.dropIndicator).toEqual({ type: 'before', key: 'status' })
  })

  it('shows an "after" indicator when hovering the right half', () => {
    const { result } = renderHook(() => useColumnDrag<K>({ onReorder: vi.fn() }))
    act(() => result.current.handleDragStart('name', dragEvent()))
    act(() => result.current.handleDragOver('status', dragEvent({ clientX: 80 })))
    expect(result.current.dropIndicator).toEqual({ type: 'after', key: 'status' })
  })

  it('does not indicate when hovering the dragged column itself', () => {
    const { result } = renderHook(() => useColumnDrag<K>({ onReorder: vi.fn() }))
    act(() => result.current.handleDragStart('name', dragEvent()))
    act(() => result.current.handleDragOver('name', dragEvent({ clientX: 10 })))
    expect(result.current.dropIndicator).toBeNull()
  })

  it('fires onReorder(from, target, position) on drop and clears state', () => {
    const onReorder = vi.fn()
    const { result } = renderHook(() => useColumnDrag<K>({ onReorder }))
    act(() => result.current.handleDragStart('name', dragEvent()))
    act(() => result.current.handleDragOver('owner', dragEvent({ clientX: 10 })))
    act(() => result.current.handleDrop(dragEvent()))
    expect(onReorder).toHaveBeenCalledWith('name', 'owner', 'before')
    expect(result.current.activeDragKey).toBeNull()
    expect(result.current.dropIndicator).toBeNull()
  })

  it('does not reorder when dropping without a valid indicator', () => {
    const onReorder = vi.fn()
    const { result } = renderHook(() => useColumnDrag<K>({ onReorder }))
    act(() => result.current.handleDragStart('name', dragEvent()))
    act(() => result.current.handleDrop(dragEvent()))
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('clears the indicator when the pointer truly leaves the header', () => {
    const { result } = renderHook(() => useColumnDrag<K>({ onReorder: vi.fn() }))
    act(() => result.current.handleDragStart('name', dragEvent()))
    act(() => result.current.handleDragOver('status', dragEvent({ clientX: 20 })))
    // clientX outside the rect (right edge = 100)
    act(() => result.current.handleDragLeave(dragEvent({ clientX: 200 })))
    expect(result.current.dropIndicator).toBeNull()
  })

  it('resets state on drag end', () => {
    const { result } = renderHook(() => useColumnDrag<K>({ onReorder: vi.fn() }))
    act(() => result.current.handleDragStart('name', dragEvent()))
    act(() => result.current.handleDragEnd())
    expect(result.current.activeDragKey).toBeNull()
  })
})
