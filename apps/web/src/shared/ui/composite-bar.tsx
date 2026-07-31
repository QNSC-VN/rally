import { AlertTriangle } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'

/**
 * The four segment styles Rally draws a capacity bar from — ONE source of truth.
 *
 * The bar, the summary strip's swatches and the Breakdown overlay must agree: a legend whose
 * colours drift from the bar it explains is worse than no legend. Everything is a `var(--token)`
 * so the palette follows dark mode (and `no-raw-hex` forbids a literal here anyway).
 *
 * Rally's layering, outermost first: the TRACK is capacity (green outline), then hatching for
 * Estimated — committed demand, not work that exists — then a light band for Rollup (live child
 * work) and a solid band for Complete inside it. Reading left to right, each band is a subset of
 * the one behind it, which is what makes "Complete ⊆ Rollup" legible without a legend.
 */
export const CAPACITY_SEGMENTS = {
  complete: { fill: BRAND.primary, border: BRAND.primaryDark, label: 'complete' },
  rollup: { fill: BRAND.primaryLighter, border: BRAND.primaryLight, label: 'rollup' },
  /** Diagonal hatch — a commitment is not delivered work, so it must not read as a solid fill. */
  estimated: {
    // The gaps are the SURFACE colour, not transparent: this band is drawn over the green headroom
    // backdrop, and transparent gaps let the green show through, so a committed stretch and a free
    // stretch read as the same green hatch.
    fill: `repeating-linear-gradient(-45deg, ${BRAND.borderSubtle} 0, ${BRAND.borderSubtle} 3px, ${BRAND.surface} 3px, ${BRAND.surface} 6px)`,
    border: BRAND.border,
    label: 'estimated',
  },
  /**
   * Remaining capacity — a GREEN hatch, not empty space.
   *
   * Rally fills the headroom rather than leaving it blank: on a grid of twenty teams, an empty
   * tail and a bar that simply ends look identical, and the whole question the reader is asking
   * is "how much room is left". Hatched, not solid, because headroom is not work.
   */
  capacity: {
    fill: `repeating-linear-gradient(-45deg, ${BRAND.successBorder} 0, ${BRAND.successBorder} 3px, ${BRAND.successBg} 3px, ${BRAND.successBg} 6px)`,
    border: BRAND.success,
    label: 'capacity',
  },
} as const

export interface CompositeBarProps {
  /** Child work finished — COMPLETED states, not just accepted. */
  complete: number
  /** Live child work, whatever its state. */
  rollup: number
  /** Committed demand — the allocation total. */
  estimated: number
  /**
   * The ceiling this row is measured against, or null when there is none.
   *
   * Null means either "no capacity entered yet" (a team) or "this row has no capacity of
   * its own" (a Feature). Both render WITHOUT a track, because scaling to an invented
   * baseline would imply a ceiling nobody set.
   */
  capacity: number | null
  /** Advisory ceiling as a percentage of capacity; draws the target marker. */
  targetLoadPct?: number | null
  /**
   * Already-translated warning sentences, in the order they should be read.
   *
   * Sentences rather than codes because `shared/ui` must not reach into a feature's copy;
   * the caller resolves them with `useCapacityWarningText`. Non-empty draws the glyph, and
   * the glyph carries them as its accessible name — an icon whose meaning is unavailable to
   * a screen reader is not a warning, it is decoration.
   */
  warningLabels?: readonly string[]
  /**
   * Whether the glyph carries `warningLabels` as its ACCESSIBLE NAME (default) or is decoration.
   *
   * `false` where the row already names the same warnings elsewhere — the team grid puts a
   * `WarningCountBadge` in its Features cell, and two nodes with the same accessible name make a
   * screen reader read the reason twice. The glyph still draws, because its POSITION is the
   * information Rally encodes: it marks where the bar failed.
   */
  warningLabelled?: boolean
  /** Tooltip text, usually the four numbers spelled out. */
  title?: string
}

/**
 * Three values drawn against one baseline: Complete ⊆ Rollup, with Estimated as a separate
 * commitment marker and Capacity as the track.
 *
 * Nothing else in the app draws this shape — `ProgressBar` renders a single ratio, which
 * cannot express "finished vs live vs committed vs ceiling" — so this is the second and
 * last progress primitive. It lives beside `progress-bar.tsx` rather than in a `progress/`
 * subdirectory because `shared/ui` is otherwise flat.
 *
 * Scaling rule: bars are measured against `capacity` when there is one, otherwise against
 * the largest of the three values. That keeps a Feature row (no capacity) readable while
 * making a team row comparable to its ceiling — and it means a team over capacity visibly
 * overflows the target marker rather than being silently rescaled to fit.
 */
export function CompositeBar({
  complete,
  rollup,
  estimated,
  capacity,
  targetLoadPct,
  warningLabels = [],
  warningLabelled = true,
  title,
}: CompositeBarProps) {
  const hasCapacity = capacity !== null && capacity > 0
  // Denominator: the ceiling when there is one, else the largest value present. Never 0 —
  // that would make every width NaN.
  const scale = hasCapacity ? capacity : Math.max(rollup, estimated, complete)
  const hasAnything = scale > 0

  const pct = (v: number) => (hasAnything ? Math.max(0, Math.min(100, (v / scale) * 100)) : 0)
  /** Over the ceiling — the bar is pinned at 100% and cannot show it by length alone. */
  const overflows = hasCapacity && Math.max(rollup, estimated, complete) > capacity

  return (
    <div className="flex w-full items-center gap-1.5" title={title}>
      {/* The TRACK is the capacity: outlined green when a ceiling exists, plain when the row has
          none of its own (a Feature). Rally draws it this way, and it means "over capacity" is
          visible as a full bar rather than a rescaled one. */}
      <div
        className="relative h-4 flex-1 overflow-hidden rounded-sm bg-card"
        style={{
          border: `1px solid ${hasCapacity ? CAPACITY_SEGMENTS.capacity.border : BRAND.borderSubtle}`,
        }}
      >
        {/* Headroom first, as the backdrop: everything else is drawn ON TOP of it, so the green
            only shows where nothing has claimed the space. `estimated` is the claim that consumes
            it — Rally's tail starts where the commitment ends, not where live work does. */}
        {hasCapacity && estimated < capacity && (
          <div
            className="absolute inset-y-0"
            data-segment="capacity"
            style={{
              left: `${pct(estimated)}%`,
              right: 0,
              background: CAPACITY_SEGMENTS.capacity.fill,
            }}
          />
        )}

        {/* Estimated next, so the bands in front read as subsets of the commitment. */}
        {hasAnything && estimated > 0 && (
          <div
            className="absolute inset-y-0 left-0"
            data-segment="estimated"
            style={{ width: `${pct(estimated)}%`, background: CAPACITY_SEGMENTS.estimated.fill }}
          />
        )}
        <div
          className="absolute inset-y-0 left-0"
          data-segment="rollup"
          style={{
            width: `${pct(rollup)}%`,
            backgroundColor: CAPACITY_SEGMENTS.rollup.fill,
            borderRight: rollup > 0 ? `1px solid ${CAPACITY_SEGMENTS.rollup.border}` : undefined,
          }}
        />
        <div
          className="absolute inset-y-0 left-0"
          data-segment="complete"
          style={{
            width: `${pct(complete)}%`,
            backgroundColor: CAPACITY_SEGMENTS.complete.fill,
            borderRight:
              complete > 0 ? `1px solid ${CAPACITY_SEGMENTS.complete.border}` : undefined,
          }}
        />

        {/* Target load, only meaningful when there is a real ceiling below 100%. */}
        {hasCapacity && targetLoadPct != null && targetLoadPct > 0 && targetLoadPct < 100 && (
          <div
            className="absolute inset-y-0 w-px opacity-70"
            style={{ left: `${targetLoadPct}%`, backgroundColor: BRAND.warning }}
          />
        )}

        {/* The warning sits INSIDE the track, at the point the bar failed.
            Rally places it that way and the position carries meaning: at the LEFT edge when the
            row overflows its ceiling (the bar is already full, so the trouble is where it began),
            at the boundary of the longest band otherwise. Outside the track it read as a note
            about the row; inside it reads as a note about the bar.
            One glyph however many rules fired — a row of triangles says nothing extra, and the
            reasons ride the accessible name either way. The name is on a wrapping span, not the
            SVG: `title` is an HTML attribute React's SVG typings reject. */}
        {warningLabels.length > 0 && (
          <span
            {...(warningLabelled
              ? { role: 'img', 'aria-label': warningLabels.join('. ') }
              : { 'aria-hidden': true })}
            title={warningLabels.join('\n')}
            data-segment="warning"
            className="absolute inset-y-0 z-10 flex items-center"
            style={
              overflows
                ? { left: 0 }
                : { left: `min(${pct(Math.max(rollup, estimated, complete))}%, calc(100% - 14px))` }
            }
          >
            <AlertTriangle size={12} style={{ color: BRAND.danger }} />
          </span>
        )}
      </div>
    </div>
  )
}
