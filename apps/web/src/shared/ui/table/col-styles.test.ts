/**
 * `useDataTable().colStyles` is the ONE source of column sizing.
 *
 * Five grids used to rebuild this map by hand, passing `{ flex: 1, minWidth }` for the Name column
 * and `{ flexShrink: 0 }` for the rest. That base was discarded in every case — `styleFor`'s
 * fixed-width branch overwrites `flex` outright, and its grow branch overwrites the long-hands —
 * so the blocks were inert duplication that still had to be kept in step across five files.
 *
 * They also read as if they controlled the sizing, which is how a real bug landed: a column later
 * marked `grow: true` emitted the long-hands AND the caller's `flex` shorthand, React warned
 * ("Updating a style property during rerender (flex) when a conflicting property is set"), and the
 * column lost its width ceiling so long text widened the table instead of wrapping.
 *
 * These assertions pin both halves of that: the base is inert, and `grow` is what decides.
 */
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { CSSProperties } from 'react'

import { useColumnLayout } from '@/shared/lib/hooks/use-column-layout'

const COLUMNS = [
  { key: 'id', label: 'ID', defaultWidth: 104, minWidth: 88 },
  { key: 'name', label: 'Name', defaultWidth: 260, minWidth: 160 },
  { key: 'grows', label: 'Grows', defaultWidth: 200, minWidth: 120, grow: true },
]

/** Resolved values only, key order normalised — `undefined` entries are absent styles. */
const defined = (style: CSSProperties) =>
  Object.fromEntries(
    Object.entries(style as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(),
  )

function layout() {
  return renderHook(() => useColumnLayout(COLUMNS as never, `colstyles-${Math.random()}`)).result
}

describe('column sizing', () => {
  it('discards a caller-supplied base on a FIXED column — the hand-built maps were inert', () => {
    const r = layout()
    for (const key of ['id', 'name']) {
      const withBase = r.current.styleFor(key as never, { flex: 1, minWidth: 150 } as never)
      expect(defined(withBase)).toEqual(defined(r.current.styleFor(key as never)))
    }
  })

  it('LEAKS a caller-supplied `flex` onto a GROW column — the collision itself', () => {
    // The grow branch writes flexGrow/flexShrink/flexBasis and does NOT clear an incoming
    // shorthand, so a callsite base survives beside them. React applies both and warns, and the
    // column ends up sized by whichever wins. This is why callsites must pass no base at all.
    const withBase = layout().current.styleFor('grows' as never, { flex: 1 } as never)
    expect(withBase.flex).toBe(1)
    expect(withBase.flexGrow).toBe(1)
  })

  it('gives a FIXED column a width ceiling, which is what lets its text wrap', () => {
    const style = layout().current.styleFor('name' as never)
    expect(style.width).toBe(260)
    // The ceiling is the point: without it there is no edge for `break-words` to wrap against.
    expect(style.maxWidth).toBe(260)
  })

  it('gives a GROW column a floor and no ceiling, so it expands instead of wrapping', () => {
    const style = layout().current.styleFor('grows' as never)
    expect(style.maxWidth).toBeUndefined()
    expect(style.minWidth).toBe(200)
    expect(style.flexGrow).toBe(1)
    // Long-hands only — mixing in the `flex` shorthand is the collision described above.
    expect(style.flex).toBeUndefined()
  })
})
