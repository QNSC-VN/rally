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
}: {
  /** Completion ratio, NOT a percentage: `0.25` renders as 25%. Null when total is 0. */
  ratio: number | null
  accepted: number | string
  total: number | string
  title?: string
}) {
  const pct = ratio === null ? null : Math.round(ratio * 100)
  // The FILL clamps, the LABEL does not — over-delivery against a forecast is real and the
  // number is the point, but a fill wider than its track would break the layout.
  const fill = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  const color = pct !== null && pct >= 100 ? BRAND.primaryLight : BRAND.warning

  return (
    <div className="min-w-0 flex-1" title={title}>
      <div className="flex items-baseline justify-between gap-2 text-ui-xs">
        <span className="font-semibold tabular-nums" style={{ color }}>
          {pct === null ? '--' : `${pct}%`}
        </span>
        <span className="font-mono text-foreground-subtle tabular-nums">
          {accepted}/{total}
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
