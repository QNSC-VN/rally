import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Tooltip } from '@/shared/ui/tooltip'
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
  // Rally's own bands, not the app's navy `primary`: navy-on-navy made Complete vanish inside the
  // dark plan header, and a brand colour on a data band reads as chrome rather than as a value.
  complete: {
    fill: BRAND.capacityComplete,
    border: BRAND.capacityCompleteBorder,
    label: 'complete',
  },
  rollup: { fill: BRAND.capacityRollup, border: BRAND.capacityRollupBorder, label: 'rollup' },
  /** Diagonal hatch — a commitment is not delivered work, so it must not read as a solid fill. */
  estimated: {
    // The gaps are the SURFACE colour, not transparent: this band is drawn over the green headroom
    // backdrop, and transparent gaps let the green show through, so a committed stretch and a free
    // stretch read as the same green hatch.
    fill: `repeating-linear-gradient(-45deg, ${BRAND.capacityEstimated} 0, ${BRAND.capacityEstimated} 3px, ${BRAND.surface} 3px, ${BRAND.surface} 6px)`,
    border: BRAND.capacityEstimatedBorder,
    label: 'estimated',
  },
  // Rally's own green: a light hatch over a pale mint, not a hatch over white. Sampled from its
  // legend — the tint under the strokes is what stops the band reading as "empty".

  /**
   * Remaining capacity — a GREEN hatch, not empty space.
   *
   * Rally fills the headroom rather than leaving it blank: on a grid of twenty teams, an empty
   * tail and a bar that simply ends look identical, and the whole question the reader is asking
   * is "how much room is left". Hatched, not solid, because headroom is not work.
   */
  capacity: {
    fill: `repeating-linear-gradient(-45deg, ${BRAND.capacityHeadroom} 0, ${BRAND.capacityHeadroom} 3px, ${BRAND.capacityHeadroomBg} 3px, ${BRAND.capacityHeadroomBg} 6px)`,
    border: BRAND.capacityHeadroomBorder,
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
   * `false` where the row already names the same warnings elsewhere — two nodes with the same
   * accessible name make a screen reader read the reason twice. The glyph still draws, because its
   * POSITION is the information Rally encodes: it marks where the bar failed.
   *
   * The team grid used to pass `false` for that reason, when its Features-cell badge named the
   * team's warnings. That badge now counts the FEATURES requiring attention (Capacity SRS:121) — a
   * different quantity — so the bar names them again, which is where SRS:128 puts them.
   */
  warningLabelled?: boolean
  /** Tooltip text, usually the four numbers spelled out. Ignored when `tooltip` is given. */
  title?: string
  /**
   * Rich hover content — Rally's legend panel: a swatch, name, value and percentage per band.
   *
   * A node rather than a string because the panel carries the SWATCHES, and because `shared/ui` must
   * not learn a capacity vocabulary: the caller builds the rows, this only decides where they show.
   */
  tooltip?: ReactNode
  /**
   * Draw for a DARK background (the detail header bar).
   *
   * The default palette is navy-on-white: `complete` is `BRAND.primary`, which on the header's
   * `bg-primary-dark` is navy on navy — the band a reader most needs to see disappears into the
   * bar. On dark, the bands become tints of white and the track a translucent outline, which is how
   * Rally draws its header bar.
   */
  onDark?: boolean
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
  tooltip,
  onDark = false,
}: CompositeBarProps) {
  const hasCapacity = capacity !== null && capacity > 0
  // Denominator: the ceiling when there is one, else the largest value present. Never 0 —
  // that would make every width NaN.
  const scale = hasCapacity ? capacity : Math.max(rollup, estimated, complete)
  const hasAnything = scale > 0

  const pct = (v: number) => (hasAnything ? Math.max(0, Math.min(100, (v / scale) * 100)) : 0)
  /**
   * The bands, resolved for the background this bar sits on.
   *
   * Same THREE-layer meaning either way — headroom, commitment, live work, finished work — only the
   * ink changes. On dark the segments cannot come from `CAPACITY_SEGMENTS`, whose colours are chosen
   * for a white card.
   */
  const ink = onDark
    ? {
        // Bands keep Rally's colours — a mid blue reads on the dark header exactly as it does in
        // Rally's own. Only the WHITE-based parts change: a grey hatch and a white track disappear
        // against navy, so the commitment hatch and the outline become translucent white.
        complete: CAPACITY_SEGMENTS.complete,
        rollup: CAPACITY_SEGMENTS.rollup,
        estimated: {
          fill: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.42) 0, rgba(255,255,255,0.42) 3px, transparent 3px, transparent 6px)`,
          border: 'rgba(255,255,255,0.4)',
        },
        capacityFill: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.2) 0, rgba(255,255,255,0.2) 3px, transparent 3px, transparent 6px)`,
        capacityBorder: 'rgba(255,255,255,0.55)',
        trackBg: 'transparent',
        emptyBorder: 'rgba(255,255,255,0.35)',
      }
    : {
        complete: CAPACITY_SEGMENTS.complete,
        rollup: CAPACITY_SEGMENTS.rollup,
        estimated: CAPACITY_SEGMENTS.estimated,
        capacityFill: CAPACITY_SEGMENTS.capacity.fill,
        capacityBorder: CAPACITY_SEGMENTS.capacity.border,
        trackBg: undefined,
        emptyBorder: BRAND.borderSubtle,
      }

  /** Over the ceiling — the bar is pinned at 100% and cannot show it by length alone. */
  const overflows = hasCapacity && Math.max(rollup, estimated, complete) > capacity

  const bar = (
    <div
      className="flex w-full items-center gap-1.5"
      title={tooltip === undefined ? title : undefined}
    >
      {/* The TRACK is the capacity: outlined green when a ceiling exists, plain when the row has
          none of its own (a Feature). Rally draws it this way, and it means "over capacity" is
          visible as a full bar rather than a rescaled one. */}
      <div
        className="relative h-4 flex-1 overflow-hidden rounded-sm"
        style={{
          backgroundColor: ink.trackBg ?? BRAND.surface,
          border: `1px solid ${hasCapacity ? ink.capacityBorder : ink.emptyBorder}`,
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
              background: ink.capacityFill,
            }}
          />
        )}

        {/* Estimated next, so the bands in front read as subsets of the commitment. */}
        {hasAnything && estimated > 0 && (
          <div
            className="absolute inset-y-0 left-0"
            data-segment="estimated"
            style={{ width: `${pct(estimated)}%`, background: ink.estimated.fill }}
          />
        )}
        <div
          className="absolute inset-y-0 left-0"
          data-segment="rollup"
          style={{
            width: `${pct(rollup)}%`,
            backgroundColor: ink.rollup.fill,
            borderRight: rollup > 0 ? `1px solid ${ink.rollup.border}` : undefined,
          }}
        />
        <div
          className="absolute inset-y-0 left-0"
          data-segment="complete"
          style={{
            width: `${pct(complete)}%`,
            backgroundColor: ink.complete.fill,
            borderRight: complete > 0 ? `1px solid ${ink.complete.border}` : undefined,
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

  // The shared `Tooltip` PORTALS, which a `title` attribute cannot: a legend has to escape the
  // grid's scroll container, and a native tooltip cannot carry swatches at all.
  return tooltip === undefined ? (
    bar
  ) : (
    <Tooltip side="top" delayDuration={150} content={tooltip}>
      {bar}
    </Tooltip>
  )
}
