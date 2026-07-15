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
