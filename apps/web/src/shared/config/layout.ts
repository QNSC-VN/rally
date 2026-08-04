/**
 * Shared grid-layout tokens.
 * Single source of truth for spacing decisions that must stay consistent across
 * every data-grid page — keep them here, not inline in individual pages.
 */

/**
 * Left indent applied to a nested "dropdown detail" child row's ID cell so it
 * visually nests one level under its parent. Reused by every expand-to-reveal
 * table (Team Status, Iteration Status, …); change this one token to re-tune the
 * nesting depth everywhere at once.
 *
 * Kept as a literal Tailwind class so it composes into `className` and is picked
 * up by the Tailwind content scanner. Paired grid ID columns must stay wide
 * enough (≥ 132px) so the indented item key never clips.
 */
export const NESTED_ROW_INDENT = 'pl-10'

/**
 * Height of a `PageToolbar`'s action row, and of any panel heading that has to sit ON that line.
 *
 * Rally's Capacity Planning puts the `Project Capacity` rail's heading level with the Feature list's
 * toolbar, and the rail's own column headings level with the grid's — so a reader sweeping across the
 * divider reads one table, not two that happen to be adjacent. Two panels in separate flex columns can
 * only line up if they agree on a number, so the number lives here.
 *
 * It is the toolbar's NATURAL height (a `size="sm"` Button at 28px inside `py-2`), pinned as a minimum
 * so a toolbar with no button is not shorter than one with.
 */
export const TOOLBAR_ROW_H = 44

/**
 * Height of a data grid's heading band — `DataTableHeader`'s own fixed 40px.
 *
 * Any heading row that must align with a grid's, in a panel beside it, reads this rather than
 * re-guessing it. See {@link TOOLBAR_ROW_H}.
 */
export const TABLE_HEADER_H = 40
