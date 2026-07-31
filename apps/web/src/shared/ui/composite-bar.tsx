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
    fill: `repeating-linear-gradient(-45deg, ${BRAND.borderSubtle} 0, ${BRAND.borderSubtle} 3px, transparent 3px, transparent 6px)`,
    border: BRAND.border,
    label: 'estimated',
  },
  capacity: { fill: 'transparent', border: BRAND.success, label: 'capacity' },
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
  title,
}: CompositeBarProps) {
  const hasCapacity = capacity !== null && capacity > 0
  // Denominator: the ceiling when there is one, else the largest value present. Never 0 —
  // that would make every width NaN.
  const scale = hasCapacity ? capacity : Math.max(rollup, estimated, complete)
  const hasAnything = scale > 0

  const pct = (v: number) => (hasAnything ? Math.max(0, Math.min(100, (v / scale) * 100)) : 0)

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
        {/* Estimated first, so the bands in front read as subsets of the commitment. */}
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

        {/* Rally puts the warning INSIDE the bar, pinned to the end it overflowed. Outside it read
            as a note about the row; inside it reads as a note about the overflow. */}
      </div>
      {warningLabels.length > 0 && (
        // One glyph however many rules fired, listing them all: a row of triangles says
        // nothing extra, and the reason belongs in the text either way.
        // The text rides a wrapping span, not the SVG: `title` is an HTML attribute and
        // React's SVG typings do not accept it, so putting it on the icon would not compile.
        <span
          role="img"
          aria-label={warningLabels.join('. ')}
          title={warningLabels.join('\n')}
          className="flex shrink-0 items-center"
        >
          <AlertTriangle size={12} style={{ color: BRAND.warning }} />
        </span>
      )}
    </div>
  )
}
