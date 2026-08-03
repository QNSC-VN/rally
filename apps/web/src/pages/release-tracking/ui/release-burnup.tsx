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
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'

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
 * Dots on the measured series, so a day with no measured neighbour is still visible.
 *
 * Small deliberately: a release window is often 60–90 days, and a dot per day on three series
 * would read as noise. `fill` is explicit and `strokeWidth: 0` — recharts fills a dot WHITE by
 * default and draws the series colour as its ring, so `{ r: 2, strokeWidth: 0 }` alone rendered
 * twelve invisible white dots on a white card. Verified by counting `.recharts-dot` nodes in the
 * DOM while nothing showed on screen.
 */
const measuredDot = (color: string) => ({ r: 2, strokeWidth: 0, fill: color })

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
          <div className="mt-1 flex items-start justify-between gap-2">
            {data.iterations.map((iteration) => (
              <div key={iteration.id} className="min-w-0 flex-1 text-center">
                <p className="truncate text-ui-xs font-semibold text-foreground">
                  {iteration.name}
                </p>
                <p className="text-ui-xs text-foreground-subtle">
                  {formatDate(iteration.startDate)} - {formatDate(iteration.endDate)}
                </p>
              </div>
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
          ...(hasIdealTarget ? [t('burnup.series.ideal')] : []),
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
          <ChartLegendItem
            color={BRAND.reportAccepted}
            shape="line"
            label={t('burnup.series.accepted', { unit: unitLabel })}
          />
          <ChartLegendItem
            color={BRAND.reportPlanned}
            shape="line"
            label={t('burnup.series.planned', { unit: unitLabel })}
          />
          <ChartLegendItem
            color={BRAND.reportPreliminary}
            shape="line"
            label={t('burnup.series.preliminary')}
          />
          {/* Advertised only when it can actually be drawn — four swatches over three lines is a
              reader hunting for a series that does not exist. */}
          {hasIdealTarget && (
            <ChartLegendItem
              color={BRAND.reportIdeal}
              shape="line"
              label={t('burnup.series.ideal')}
            />
          )}
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
          <div className="mt-3 flex gap-8">
            <MetricCard
              label={t('totals.accepted')}
              value={totals?.accepted ?? EMPTY_VALUE}
              caption={unitLabel}
              valueColor={BRAND.reportAccepted}
              minWidth={120}
            />
            <MetricCard
              label={t('totals.planned')}
              value={totals?.planned ?? EMPTY_VALUE}
              caption={unitLabel}
              valueColor={BRAND.reportPlanned}
              minWidth={120}
            />
            <MetricCard
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
      <LineChart data={points} margin={{ top: 8, right: 18, left: 8, bottom: 12 }}>
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
        <Line
          type="monotone"
          dataKey="accepted"
          name={t('burnup.series.accepted', { unit: unitLabel })}
          stroke={BRAND.reportAccepted}
          strokeWidth={2}
          dot={measuredDot(BRAND.reportAccepted)}
          connectNulls={false}
        />
        <Line
          type="stepAfter"
          dataKey="planned"
          name={t('burnup.series.planned', { unit: unitLabel })}
          stroke={BRAND.reportPlanned}
          strokeWidth={2}
          dot={measuredDot(BRAND.reportPlanned)}
          connectNulls={false}
        />
        <Line
          type="stepAfter"
          dataKey="preliminary"
          name={t('burnup.series.preliminary')}
          stroke={BRAND.reportPreliminary}
          strokeWidth={2}
          dot={measuredDot(BRAND.reportPreliminary)}
          connectNulls={false}
        />
        {hasIdealTarget && (
          <Line
            type="linear"
            dataKey="ideal"
            name={t('burnup.series.ideal')}
            stroke={BRAND.reportIdeal}
            strokeDasharray="4 3"
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
          />
        )}
      </LineChart>
    </ChartFrame>
  )
}
