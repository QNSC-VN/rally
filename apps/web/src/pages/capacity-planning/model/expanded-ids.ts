/**
 * Expand/collapse bookkeeping for the two collapsible grids on the capacity-plan detail page
 * (Teams tab rows, Features tab per-team breakdowns).
 *
 * Both tabs held a byte-identical `useState<Set<string>>` + `useCallback` pair that rebuilt the
 * Set to add or remove one id — 22 lines of the page for one idea, on the file that holds the
 * `MAX_FILE_LINES` ratchet ceiling. Extracted here because `FRONTEND_CONVENTIONS.md` §1 puts
 * page-local helpers in `pages/<x>/model/`, not inside a `*-page.tsx`.
 *
 * Deliberately NOT a hook: `useState` stays on the page so React's rules-of-hooks lint keeps
 * seeing it, and the only thing worth sharing is the immutable toggle.
 */

/**
 * Return a NEW Set with `id` flipped. A new instance every time, because React bails out of a
 * re-render when the next state is `Object.is`-equal to the previous one — mutating and returning
 * the same Set would leave the row visually collapsed.
 */
export function toggleId(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
