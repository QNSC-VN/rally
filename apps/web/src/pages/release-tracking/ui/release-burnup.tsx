/**
 * The Release Tracking burnup (RT-BR-09, RT-AC-09).
 *
 * Four series — Accepted, Planned, Preliminary Estimate and Ideal — over the release window, in
 * whichever unit `Chart Unit` selects. Below the axis sits the secondary iteration band: the
 * timeboxes the release crosses, which is how a reader maps a date on this chart onto the sprint
 * they were in.
 *
 * Everything measured comes from stored daily snapshots. A day with no snapshot arrives as
 * `null` and stays a gap, and `Ideal` is drawn only from the persisted planning baseline: the
 * SRS forbids reconstructing it from today's mutable Planned value, because that would silently
 * redraw every past ideal whenever scope changed.
 */
import { useState, type Key } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts'

import { BRAND } from '@/shared/config/brand'
import { useReleaseBurnup, type ChartUnit } from '@/features/reporting/api'
import { formatDate } from '@/shared/lib/utils'
import { MetricCard } from '@/shared/ui/metric-card'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_TOOLTIP,
  ChartFrame,
  ChartLegendItem,
  axisLabel,
} from '@/shared/ui/chart'

/**
 * A dot ONLY where a measured day has no measured neighbour — otherwise none, as Rally draws it.
 *
 * Rally's burnup carries no resting dots at all: its cron writes every day, so the series are
 * continuous and a marker per day would be noise on a 60–90 day window. Ours must not copy that
 * blindly, because a line SEGMENT needs two adjacent points: with `connectNulls={false}` (which
 * RT-BR-09 requires — a bridged gap is a fabrication) a day whose neighbours are both gaps drew
 * zero pixels, and a young release rendered an empty grid beside populated totals.
 *
 * So the dot is conditional on being ISOLATED. Dense history looks like Rally's; sparse history
 * still shows every day that was actually measured.
 *
 * `fill` is explicit and `strokeWidth: 0`: recharts fills a dot WHITE by default and draws the
 * series colour as its ring, so `{ r: 2 }` alone renders invisible dots on a white card — verified
 * by counting `.recharts-dot` nodes in the DOM while nothing showed on screen.
 */
type SeriesKey = 'accepted' | 'planned' | 'preliminary' | 'ideal'

type DotProps = { cx?: number; cy?: number; index?: number; key?: Key | null }

function isolatedDot<K extends 'accepted' | 'planned' | 'preliminary'>(
  points: readonly Record<K, number | null>[],
  key: K,
  color: string,
) {
  // `key` is recharts' own `Key | null`, so it is spread rather than re-typed; an empty `<g>` is how a
  // dot renderer says "nothing here" (returning null makes recharts warn).
  return function Dot({ cx, cy, index, key: dotKey }: DotProps) {
    if (cx == null || cy == null || index == null) return <g key={dotKey} />
    const measured = (at: number) => points[at]?.[key] != null
    if (measured(index - 1) || measured(index + 1)) return <g key={dotKey} />
    return <circle key={dotKey} cx={cx} cy={cy} r={2} fill={color} />
  }
}

/**
 * The hover marker — Rally's: a ring on the shaded series, a filled dot on the plain ones.
 *
 * This is the only marker Rally shows, and it appears on hover beside the tooltip, so the reader is
 * told which point the numbers belong to without every point being decorated.
 */
const HOVER_DOT = (color: string) => ({ r: 4, strokeWidth: 2, stroke: color, fill: color })

export function ReleaseBurnup({
  projectId,
  teamId,
  releaseId,
  releaseName,
  releaseStart,
  releaseEnd,
  unit,
  totals,
}: {
  projectId: string
  teamId: string | undefined
  releaseId: string | undefined
  releaseName: string
  releaseStart: string | null
  releaseEnd: string | null
  unit: ChartUnit
  totals: { planned: number; accepted: number; preliminary: number } | undefined
}) {
  const { t } = useTranslation(['release-tracking', 'common'])
  const { data } = useReleaseBurnup({ projectId, teamId, releaseId, unit })

  const points = data?.points ?? []
  const unitLabel = unit === 'points' ? t('unit.points') : t('unit.count')
  const acceptedLabel = t('burnup.series.accepted', { unit: unitLabel })
  /**
   * `Ideal (Accepted Points)`, as Rally names it — the trajectory is the ACCEPTED series' target.
   *
   * It read just `Ideal`, which leaves a reader to guess which of three lines it is the ideal FOR. The
   * unit travels with it, so a Count chart says `Ideal (Accepted Count)`.
   */
  const idealLabel = t('burnup.series.ideal', { series: acceptedLabel })

  /**
   * Legend interaction, as Rally's: CLICK an entry to drop its series from the chart, HOVER one to
   * recede the others so a single trajectory can be followed across a crowded plot.
   *
   * A hidden series is not rendered at all rather than drawn transparent — it must leave the tooltip
   * too, or the numbers keep reporting a line nobody can see.
   */
  const [hidden, setHidden] = useState<ReadonlySet<SeriesKey>>(new Set())
  const [hovered, setHovered] = useState<SeriesKey | null>(null)
  const toggle = (key: SeriesKey) =>
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  /** Receded, not removed: another entry is being hovered and this is not it. */
  const dim = (key: SeriesKey) => hovered !== null && hovered !== key
  const strokeOpacityOf = (key: SeriesKey) => (dim(key) ? 0.2 : 1)
  const historyState = data?.historyState
  // An axis of dates whose every value is null is not a chart — it is an empty grid that reads
  // as "everything was zero". The window exists; the measurements do not.
  const hasMeasuredDay = points.some((point) => point.accepted !== null)
  /**
   * Whether a stored Ideal target exists at all.
   *
   * `historyState` cannot answer this any more (it describes the snapshots), and it could not
   * really answer it before either: the old `no-baseline` state was reachable only when NOTHING
   * was measured, so a release with history and no target reported `partial` and the reader was
   * left with a legend swatch for a line that was never drawn.
   */
  const hasIdealTarget = data?.idealTarget !== null && data?.idealTarget !== undefined

  return (
    <ChartFrame
      title={t('burnup.title', {
        release: releaseName,
        from: formatDate(releaseStart),
        to: formatDate(releaseEnd),
      })}
      height={320}
      isEmpty={points.length === 0 || !hasMeasuredDay}
      /**
       * The secondary iteration row, directly under the dates it labels.
       *
       * §7 and RT-AC-09 put it on the x-axis: "X-axis shows dates and a secondary iteration-name row
       * for the iterations crossed by the selected Release". It was rendered from `footer`, which put
       * the legend strip and up to two history notes between it and the axis — roughly 90px away, and
       * below a bordered box, so it read as a third summary block rather than as part of the axis.
       */
      underAxis={
        data && data.iterations.length > 0 ? (
          /**
           * NAMES only, one row, centred under the span each iteration covers — as Rally draws it
           * (`2026Q3-1 … 2026Q3-IP`). Each name also carries its window as a `title`.
           *
           * The dates used to print on a second line under every name. On a quarter-long release that is
           * six or seven date ranges repeating what the axis above already says, in a row whose job is
           * to answer one question: which sprint was this day in.
           */
          <div className="mt-1 flex items-start justify-between gap-2">
            {data.iterations.map((iteration) => (
              <p
                key={iteration.id}
                className="min-w-0 flex-1 truncate text-center text-ui-xs text-muted-foreground"
                title={`${formatDate(iteration.startDate)} - ${formatDate(iteration.endDate)}`}
              >
                {iteration.name}
              </p>
            ))}
          </div>
        ) : undefined
      }
      dataTable={{
        caption: t('burnup.tableCaption', { release: releaseName }),
        noDataLabel: t('common:noData'),
        columns: [
          t('burnup.tableDate'),
          t('burnup.series.accepted', { unit: unitLabel }),
          t('burnup.series.planned', { unit: unitLabel }),
          t('burnup.series.preliminary'),
          ...(hasIdealTarget ? [idealLabel] : []),
        ],
        rows: points.map((point) => [
          point.date,
          point.accepted,
          point.planned,
          point.preliminary,
          ...(hasIdealTarget ? [point.ideal] : []),
        ]),
      }}
      emptyTitle={t('burnup.empty.title')}
      emptyDescription={t('burnup.empty.description')}
      legend={
        <>
          {/* A DOT for the shaded series and rules for the trajectories — Rally's own convention, and it
              tells the reader which line has an area under it.
              Every entry is a TOGGLE: click to drop the series, hover to recede the others. */}
          {(
            [
              ['accepted', BRAND.reportAccepted, acceptedLabel, 'dot'],
              [
                'planned',
                BRAND.reportPlanned,
                t('burnup.series.planned', { unit: unitLabel }),
                'line',
              ],
              ['preliminary', BRAND.reportPreliminary, t('burnup.series.preliminary'), 'line'],
              // Advertised only when it can actually be drawn — a swatch for a series that does not
              // exist is a reader hunting for a line.
              ...(hasIdealTarget
                ? [['ideal', BRAND.reportIdeal, idealLabel, 'line'] as const]
                : []),
            ] as const
          ).map(([key, color, label, shape]) => (
            <ChartLegendItem
              key={key}
              color={color}
              shape={shape}
              label={label}
              hidden={hidden.has(key)}
              dimmed={dim(key)}
              onToggle={() => toggle(key)}
              onHover={(hovering) => setHovered(hovering ? key : null)}
              toggleLabel={t(hidden.has(key) ? 'burnup.legend.restore' : 'burnup.legend.toggle', {
                series: label,
              })}
            />
          ))}
        </>
      }
      footer={
        <>
          {/* The history-quality state is part of the contract, not a nicety: a partial or
              missing series must say so rather than look like a flat trajectory. */}
          {historyState === 'partial' && (
            <p className="mt-2 text-center text-ui-xs text-foreground-subtle">
              {t('burnup.partialHistory')}
            </p>
          )}
          {!hasIdealTarget && hasMeasuredDay && (
            <p className="mt-2 text-center text-ui-xs text-foreground-subtle">
              {t('burnup.noBaseline')}
            </p>
          )}

          {/* The three totals stay MOUNTED with absent values, they no longer vanish.
              This was the last surface still using the third convention for missing data — the reports
              sweep settled on `--` everywhere, the tiles above it print `--`, and a row of cards that
              disappears makes the panel change height on every refetch while saying nothing about why. */}
          <div className="mt-3 flex justify-around gap-8">
            <MetricCard
              layout="value-first"
              label={t('totals.accepted')}
              value={totals?.accepted ?? EMPTY_VALUE}
              caption={unitLabel}
              valueColor={BRAND.reportAccepted}
              minWidth={120}
            />
            <MetricCard
              layout="value-first"
              label={t('totals.planned')}
              value={totals?.planned ?? EMPTY_VALUE}
              caption={unitLabel}
              valueColor={BRAND.reportPlanned}
              minWidth={120}
            />
            <MetricCard
              layout="value-first"
              label={t('totals.preliminary')}
              value={totals?.preliminary ?? EMPTY_VALUE}
              caption={unitLabel}
              valueColor={BRAND.reportPreliminary}
              minWidth={140}
            />
          </div>
        </>
      }
    >
      {/* `ComposedChart`, because Accepted is an AREA and the other three are lines — Rally shades the
          band under Accepted and draws Planned, Preliminary and Ideal as plain trajectories, so the
          measured progress reads as volume delivered rather than as a fourth similar line. */}
      <ComposedChart data={points} margin={{ top: 8, right: 18, left: 8, bottom: 12 }}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="date" {...CHART_AXIS} />
        <YAxis
          {...CHART_AXIS}
          label={axisLabel(
            unit === 'points' ? t('burnup.axis.points') : t('burnup.axis.count'),
            'left',
          )}
        />
        <Tooltip contentStyle={CHART_TOOLTIP} />
        {/* connectNulls={false} everywhere: a bridged gap is indistinguishable from a measured
            straight line, which is the fabrication RT-BR-09 rules out.

            The measured series therefore carry DOTS. A line segment needs two adjacent points,
            so with `connectNulls={false}` a day whose neighbours are gaps drew nothing at all —
            and that is the normal state of a young release, where the cron has written one or
            two scattered days. The chart showed an empty grid beside populated totals. The Ideal
            line needs no dot: it is computed for every axis day and is never sparse. */}
        {/* A hidden series is NOT rendered, so it leaves the tooltip with it — a transparent line would
            keep reporting numbers for something the reader has switched off. */}
        {!hidden.has('accepted') && (
          <Area
            type="monotone"
            dataKey="accepted"
            name={acceptedLabel}
            stroke={BRAND.reportAccepted}
            strokeOpacity={strokeOpacityOf('accepted')}
            strokeWidth={2}
            // A pale wash, not a solid: three trajectories cross this band, and at any real opacity the
            // fill hides the lines it is meant to be read against.
            fill={BRAND.reportAccepted}
            fillOpacity={dim('accepted') ? 0.05 : 0.18}
            dot={isolatedDot(points, 'accepted', BRAND.reportAccepted)}
            activeDot={HOVER_DOT(BRAND.reportAccepted)}
            connectNulls={false}
          />
        )}
        {!hidden.has('planned') && (
          <Line
            type="stepAfter"
            dataKey="planned"
            name={t('burnup.series.planned', { unit: unitLabel })}
            stroke={BRAND.reportPlanned}
            strokeWidth={2}
            strokeOpacity={strokeOpacityOf('planned')}
            dot={isolatedDot(points, 'planned', BRAND.reportPlanned)}
            activeDot={HOVER_DOT(BRAND.reportPlanned)}
            connectNulls={false}
          />
        )}
        {!hidden.has('preliminary') && (
          <Line
            type="stepAfter"
            dataKey="preliminary"
            name={t('burnup.series.preliminary')}
            stroke={BRAND.reportPreliminary}
            strokeWidth={2}
            strokeOpacity={strokeOpacityOf('preliminary')}
            dot={isolatedDot(points, 'preliminary', BRAND.reportPreliminary)}
            activeDot={HOVER_DOT(BRAND.reportPreliminary)}
            connectNulls={false}
          />
        )}
        {hasIdealTarget && !hidden.has('ideal') && (
          <Line
            type="linear"
            dataKey="ideal"
            name={idealLabel}
            stroke={BRAND.reportIdeal}
            strokeOpacity={strokeOpacityOf('ideal')}
            // SOLID, as Rally draws it. The dashes said "projection", but the Ideal is computed from a
            // persisted baseline (RT-BR-09) — it is as real as the measured series, just not measured.
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
          />
        )}
      </ComposedChart>
    </ChartFrame>
  )
}
