/**
 * Collapse-to-summary selection — WID-FR-003 / WID-AC-07.
 *
 * The BA's field table reads "Collapse icon | `onMinimize` | Trở về Backlog + summary panel
 * selected", and AC 7 is "Collapse icon returns user to summary panel state WITHOUT LOSING
 * SELECTED ITEM". So a collapse is two facts, not one: leave the full page, and keep the item
 * selected on the surface you land on. The mockup does exactly that —
 * `minimizeFullDetail(item)` sets `activeItem` (what drives `DetailPanel`) and then closes the
 * full detail (`03_Mockup Design/src/app/App.tsx`).
 *
 * WHERE THE COLLAPSED / EXPANDED STATE LIVES: in the ROUTE, and nowhere else. `/item/$itemKey`
 * IS the expanded state and `/backlog` IS the collapsed one — our detail surface is a routed
 * page (ADR-001 §2.2), unlike the mockup's overlay. Adding a boolean would create a second
 * source of truth for "which surface am I on" that the browser's back button could contradict.
 *
 * WHAT THIS STORE HOLDS: the selection that has to OUTLIVE the collapse. The detail route
 * unmounts and a different route's component has to read it, so it cannot be either page's
 * `useState`, and the `/backlog` route declares no search params (adding one is a router
 * change). A module-scoped store is the smallest thing that spans the two.
 *
 * It holds ONLY THE ITEM KEY — never a copy of the work item. A materialised copy would be a
 * draft that shadows its source: taken while `useWorkItemByKey` was still in flight it would
 * freeze whatever was known then (nothing), and the real row could never reach it. The panel
 * resolves the row from the query every time, so `undefined` there means "not yet known" and
 * renders as loading, never as an absent value.
 *
 * NOT persisted. A collapse is a within-session gesture; restoring a summary panel days later
 * would be state nobody chose. (Contrast `app-context.store`, which persists deliberately.)
 */
import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { create } from 'zustand'

interface SummarySelectionState {
  /** The selected item's key, or `null` when no summary panel is open. */
  itemKey: string | null
  select: (itemKey: string) => void
  clear: () => void
}

export const useSummarySelection = create<SummarySelectionState>((set) => ({
  itemKey: null,
  select: (itemKey) => set({ itemKey }),
  clear: () => set({ itemKey: null }),
}))

/**
 * The `onCollapse` handler for a work item's detail page: select, then navigate.
 *
 * Both steps, in this order, are AC 7. Dropping the `select` call leaves a plain "go back",
 * which is what `onBack` already is.
 */
export function useCollapseToSummary(itemKey: string | undefined) {
  const navigate = useNavigate()
  const select = useSummarySelection((s) => s.select)

  return useCallback(() => {
    if (!itemKey) return
    select(itemKey)
    void navigate({ to: '/backlog' })
  }, [itemKey, navigate, select])
}
