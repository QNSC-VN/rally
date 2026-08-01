import { BRAND } from '@/shared/config/brand'

/**
 * A framed ratio meter with the percentage and the raw ratio INSIDE the track.
 *
 * Rally's "Total Accepted Children" bar, and the shape it needs is genuinely different from
 * `ProgressBar`: that one is a 6px hairline with the percentage outside, sized to sit in a
 * grid cell. This is a bordered, text-height track carrying two labels over the fill — the
 * percentage left-aligned inside, the `accepted/total` pair right-aligned inside. Trying to
 * make one component do both would mean a variant that changes the height, the border, the
 * label count AND the label placement, which is two components wearing one name.
 *
 * Lives in `shared/ui` because the fill needs a computed `width`, and
 * `apps/web/src/test/fe-consistency.ratchet.test.ts` only permits an inline style here.
 *
 * `ratio` is null when there is no denominator — nothing linked — and renders as an empty
 * track rather than 0%: "no children" is a different fact from "no children accepted".
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
  // number is the point, but a fill wider than its track would break the frame.
  const fill = pct === null ? 0 : Math.max(0, Math.min(100, pct))

  return (
    <div
      className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-sm border border-border bg-card"
      title={title}
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{ width: `${fill}%`, backgroundColor: BRAND.primaryLight }}
      />
      {/* Both labels sit ABOVE the fill and are painted in the same colour regardless of how
          far the fill has travelled. Rally does the same; switching to white-on-fill at some
          threshold makes the number flicker as the value crosses it. */}
      <div className="relative flex h-full items-center justify-between px-1.5 text-ui-xs font-medium text-foreground">
        <span>{pct === null ? '--' : `${pct}%`}</span>
        <span className="font-mono tabular-nums">
          {accepted}/{total}
        </span>
      </div>
    </div>
  )
}
