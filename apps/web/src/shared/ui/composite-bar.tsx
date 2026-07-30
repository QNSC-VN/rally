import { AlertTriangle } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'

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
  /** Non-empty when any advisory rule fired; drives the warning glyph + tooltip. */
  warnings?: readonly string[]
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
  warnings = [],
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
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-border-subtle">
        {/* Rollup is the outer band; Complete sits inside it, so the two read as a subset
            rather than as two competing bars. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct(rollup)}%`, backgroundColor: BRAND.primaryLighter }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct(complete)}%`, backgroundColor: BRAND.success }}
        />

        {/* Estimated is a MARKER, not a fill: it is a commitment, not work that exists. */}
        {hasAnything && estimated > 0 && (
          <div
            className="absolute inset-y-0 w-0.5"
            style={{ left: `${pct(estimated)}%`, backgroundColor: BRAND.primary }}
          />
        )}

        {/* Target load, only meaningful when there is a real ceiling below 100%. */}
        {hasCapacity && targetLoadPct != null && targetLoadPct > 0 && targetLoadPct < 100 && (
          <div
            className="absolute inset-y-0 w-px opacity-70"
            style={{ left: `${targetLoadPct}%`, backgroundColor: BRAND.warning }}
          />
        )}
      </div>

      {warnings.length > 0 && (
        <AlertTriangle size={12} className="shrink-0" style={{ color: BRAND.warning }} />
      )}
    </div>
  )
}
