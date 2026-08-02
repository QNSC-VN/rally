import type { ReactNode } from 'react'

import { BRAND } from '@/shared/config/brand'

/**
 * A labelled ratio meter: the percentage and the raw `accepted/total` pair on one line, with a
 * thin progress bar UNDER them.
 *
 * Rally's "Total Accepted Children" meter, and the shape is genuinely different from
 * `ProgressBar`. That one is a single hairline row with the percentage beside it, sized for a
 * grid cell. This is two stacked rows, and the percentage takes the BAR's colour so the number
 * and the fill read as one object.
 *
 * The colour is threshold-based, matching Rally: amber while there is work outstanding, and the
 * brand blue once everything is accepted. Rally reserves the blue for "done" — an amber 100%
 * would read as a warning about a finished item.
 *
 * Lives in `shared/ui` because the fill needs a computed `width`, and
 * `apps/web/src/test/fe-consistency.ratchet.test.ts` only permits an inline style here.
 *
 * `ratio` is null when there is no denominator — nothing linked — and renders as `--` with an
 * empty track rather than 0%: "no children" is a different fact from "no children accepted".
 */
export function RatioMeter({
  ratio,
  accepted,
  total,
  title,
  percent,
  hidePercent = false,
  label,
}: {
  /** Completion ratio, NOT a percentage: `0.25` renders as 25%. Null when total is 0. */
  ratio: number | null
  accepted: number | string
  total: number | string
  title?: string
  /**
   * The percentage to PRINT, when the server computes it and the client must not re-derive it.
   *
   * Release Tracking floors (`Math.floor`, RT-BR-05) where this component rounds, so 99.6% is 99
   * there and would read 100 here — a number that says "finished" about work that is not.
   */
  percent?: number | null
  /**
   * Print the ratio bar but NOT the percentage.
   *
   * For a population whose denominator is a slice rather than the whole: a Derived Feature's Status
   * counts only the children in the selected release and scope, so a percentage would be read as the
   * Feature's own progress (RT-BR-05 omits it deliberately). The bar still fills, because the
   * proportion of the counted work is exactly what it shows.
   */
  hidePercent?: boolean
  /**
   * Replaces the bare `accepted/total` with the caller's own wording.
   *
   * Release Tracking says "5/10 points accepted" — the unit belongs in the cell, because `Chart Unit`
   * switches it and a reader comparing two rows should not have to look back at a selector to know
   * what they are counting.
   */
  label?: ReactNode
}) {
  const pct = percent !== undefined ? percent : ratio === null ? null : Math.round(ratio * 100)
  /**
   * The FILL comes from the RATIO, not from the printed percentage.
   *
   * They are usually the same number, but not always: a suppressed percentage (`hidePercent`) still
   * has a real proportion to draw, and a floored `percent` differs from the ratio in the last unit.
   * Reading the bar off `pct` drew an empty track for a Derived row that was half done.
   *
   * It clamps and the LABEL does not — over-delivery against a forecast is real and the number is the
   * point, but a fill wider than its track would break the layout.
   */
  const measured = ratio !== null ? ratio * 100 : pct
  const fill = measured === null ? 0 : Math.max(0, Math.min(100, measured))
  // The colour follows the number the READER SEES, so a cell can never print a blue "100%" beside an
  // amber bar. Where no percentage is printed it falls back to the measured proportion.
  const shown = pct ?? (measured === null ? null : Math.round(measured))
  const color = shown !== null && shown >= 100 ? BRAND.primaryLight : BRAND.warning

  return (
    <div className="min-w-0 flex-1" title={title}>
      <div className="flex items-baseline justify-between gap-2 text-ui-xs">
        {!hidePercent && (
          <span className="font-semibold tabular-nums" style={{ color }}>
            {pct === null ? '--' : `${pct}%`}
          </span>
        )}
        <span className="truncate font-mono text-foreground-subtle tabular-nums">
          {label ?? `${accepted}/${total}`}
        </span>
      </div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-border-subtle">
        <div
          className="h-full rounded-full"
          style={{ width: `${fill}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
