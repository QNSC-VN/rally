/**
 * `useDragRowStyle` — the drag-row style contract seven grids used to hand-write.
 *
 * The two assertions that matter are the ones the copies disagreed on: `position: 'relative'`
 * must accompany `zIndex` (a static element ignores z-index, so a dragged row without it still
 * slides under its neighbours), and a row at rest must carry no drag decoration at all.
 */
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useDragRowStyle } from './use-drag-row-style'

const transform = { x: 0, y: 12, scaleX: 1, scaleY: 1 }

describe('useDragRowStyle', () => {
  it('lifts a dragging row with BOTH zIndex and position, or the lift does nothing', () => {
    const { result } = renderHook(() =>
      useDragRowStyle({ transform, transition: 'transform 200ms', isDragging: true }),
    )

    expect(result.current.zIndex).toBe(1)
    // The half of the pair the copies kept forgetting.
    expect(result.current.position).toBe('relative')
    expect(result.current.opacity).toBe(0.5)
    expect(result.current.transform).toContain('translate3d')
  })

  it('leaves a resting row undecorated', () => {
    const { result } = renderHook(() => useDragRowStyle({ transform: null, isDragging: false }))

    expect(result.current.opacity).toBe(1)
    expect(result.current.zIndex).toBeUndefined()
    expect(result.current.position).toBeUndefined()
    expect(result.current.backgroundColor).toBeUndefined()
  })

  it('keeps a resting highlight but lets a drag override it', () => {
    const resting = renderHook(() =>
      useDragRowStyle({ transform: null, isDragging: false, highlight: '#eef' }),
    )
    expect(resting.result.current.backgroundColor).toBe('#eef')

    // While dragging, THAT is what the row is doing — the reveal highlight loses.
    const dragging = renderHook(() =>
      useDragRowStyle({ transform, isDragging: true, highlight: '#eef' }),
    )
    expect(dragging.result.current.backgroundColor).not.toBe('#eef')
  })
})
