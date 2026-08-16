/**
 * The `Dependencies` cell of the FEATURES-tab grid — Rally's bordered count chip.
 *
 * `0`, not `EMPTY_VALUE`: SRS §157 for this tab says "It shows `0` until dependency modelling is
 * added" (catalog §353), and zero is the truthful count for a domain that models none, where a dash
 * would read as "unknown". This is the ONE place the app's absent-value rule is deliberately not
 * applied, and it is scoped to this grid: the EXPANDED TEAM table renders `EMPTY_VALUE`, because SRS
 * §9 asks for `—` there ("every row shows `—`"). Two grids, two sentences from the BA, both honoured
 * — see `allocation-row.tsx` for the other half.
 *
 * Shared by the Feature row and its split sub-rows because the sub-row cell used to be rendered as
 * an EMPTY div, which is the "not loaded" reading `allocation-row.tsx` argues against — in the same
 * column, one row below a chip that said `0`. One renderer is what makes that state unreachable
 * rather than merely fixed.
 *
 * Left-aligned, unlike the metric columns after it: Rally hangs the chip off the left edge of the
 * column, and right-aligning it parked the chip against the Rollup numbers so the two read as one
 * group.
 */
export function DependencyCount() {
  return (
    <span className="inline-flex min-w-6 justify-center rounded border border-border-strong px-1 text-ui-xs text-muted-foreground tabular-nums">
      0
    </span>
  )
}
