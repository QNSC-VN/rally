import { BRAND } from '@/shared/config/brand'

interface ProgressBarProps {
  /**
   * Completion ratio, NOT a percentage — `0.25` renders as 25%. Ratios above 1
   * are allowed and meaningful (see `overflow`).
   */
  ratio: number | null
  /** Rendered when `ratio` is null (no denominator — e.g. an unestimated item). */
  placeholder?: string
  /** Tooltip, e.g. `10 / 40 points accepted`. */
  title?: string
  /** Hide the trailing "NN%" text when the caller shows the numbers elsewhere. */
  showLabel?: boolean
  /**
   * Overrides the fill colour, for surfaces where the bar's meaning is a STATUS
   * rather than a plain ratio.
   *
   * Rally's Portfolio Items page works this way: "Both of the Percent Done fields
   * are colored based on the status of the work needed to complete the portfolio
   * item" — green/yellow/red against the planned end date, blue once done. That
   * verdict cannot be derived from the ratio alone (it needs the dates), so the
   * caller resolves it and passes the colour in.
   */
  tone?: string
}

/**
 * A thin horizontal ratio bar with an optional percentage label.
 *
 * Lives in `shared/ui` for two reasons. It is the single bar used by every
 * progress surface, so the fill colours and thresholds cannot drift between
 * grids; and the fill needs a computed `width`, which only a non-consumer layer
 * may express as an inline style under
 * `apps/web/src/test/fe-consistency.ratchet.test.ts`.
 *
 * The FILL clamps to 100% but the LABEL does not. That asymmetry is deliberate:
 * Portfolio "Estimated Progress" is accepted-work over a top-down forecast, so a
 * Feature that delivered twice its estimate genuinely reads 200%. Clamping the
 * label would hide exactly the overrun the column exists to reveal, and letting
 * the fill exceed its track would overflow the grid cell.
 */
export function ProgressBar({
  ratio,
  placeholder = '—',
  title,
  showLabel = true,
  tone,
}: ProgressBarProps) {
  if (ratio === null || !Number.isFinite(ratio)) {
    // The tooltip rides the placeholder too. It is the ONLY explanation available on an
    // unmeasurable bar — a bare dash with no hover text reads as a rendering bug, and on
    // the portfolio grid the caller's tooltip is exactly the "no dates / nothing
    // estimated" note that says why there is no verdict.
    return (
      <span className="text-ui-xs text-foreground-subtle" title={title}>
        {placeholder}
      </span>
    )
  }

  const pct = Math.round(ratio * 100)
  const fill = Math.max(0, Math.min(100, pct))
  // Over-delivery is not "success" — it means the estimate was wrong, so it gets
  // its own colour rather than reusing the complete/green one. A caller-supplied
  // `tone` wins outright: a status colour already accounts for progress, so
  // blending the two would show green-for-complete on an item Rally calls late.
  const color = tone ?? (pct > 100 ? BRAND.warning : pct >= 100 ? BRAND.success : BRAND.primary)

  return (
    <div className="flex w-full items-center gap-1.5" title={title}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-subtle">
        <div
          className="h-full rounded-full"
          style={{ width: `${fill}%`, backgroundColor: color }}
        />
      </div>
      {showLabel && (
        <span className="min-w-8 text-right text-ui-xs text-muted-foreground">{pct}%</span>
      )}
    </div>
  )
}
