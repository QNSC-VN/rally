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
import { MetricCard } from '@/shared/ui/metric-card'
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_TOOLTIP,
  ChartFrame,
  ChartLegendItem,
  axisLabel,
} from '@/shared/ui/chart'

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
  const { t } = useTranslation('release-tracking')
  const { data } = useReleaseBurnup({ projectId, teamId, releaseId, unit })

  const points = data?.points ?? []
  const unitLabel = unit === 'points' ? t('unit.points') : t('unit.count')
  const historyState = data?.historyState
  // An axis of dates whose every value is null is not a chart — it is an empty grid that reads
  // as "everything was zero". The window exists; the measurements do not.
  const hasMeasuredDay = points.some((point) => point.accepted !== null)

  return (
    <ChartFrame
      title={t('burnup.title', {
        release: releaseName,
        from: releaseStart ?? '—',
        to: releaseEnd ?? '—',
      })}
      height={320}
      isEmpty={points.length === 0 || !hasMeasuredDay}
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
          <ChartLegendItem
            color={BRAND.reportIdeal}
            shape="line"
            label={t('burnup.series.ideal')}
          />
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
          {historyState === 'no-baseline' && hasMeasuredDay && (
            <p className="mt-2 text-center text-ui-xs text-foreground-subtle">
              {t('burnup.noBaseline')}
            </p>
          )}

          {data && data.iterations.length > 0 && (
            <div className="mt-3 flex items-start justify-between gap-2 border-t border-border-inner pt-2">
              {data.iterations.map((iteration) => (
                <div key={iteration.id} className="min-w-0 flex-1 text-center">
                  <p className="truncate text-ui-xs font-semibold text-foreground">
                    {iteration.name}
                  </p>
                  <p className="text-ui-xs text-foreground-subtle">
                    {iteration.startDate ?? '—'} - {iteration.endDate ?? '—'}
                  </p>
                </div>
              ))}
            </div>
          )}

          {totals && (
            <div className="mt-3 flex gap-8">
              <MetricCard
                label={t('totals.accepted')}
                value={totals.accepted}
                caption={unitLabel}
                valueColor={BRAND.reportAccepted}
                minWidth={120}
              />
              <MetricCard
                label={t('totals.planned')}
                value={totals.planned}
                caption={unitLabel}
                valueColor={BRAND.reportPlanned}
                minWidth={120}
              />
              <MetricCard
                label={t('totals.preliminary')}
                value={totals.preliminary}
                caption={unitLabel}
                valueColor={BRAND.reportPreliminary}
                minWidth={140}
              />
            </div>
          )}
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
            straight line, which is the fabrication RT-BR-09 rules out. */}
        <Line
          type="monotone"
          dataKey="accepted"
          name={t('burnup.series.accepted', { unit: unitLabel })}
          stroke={BRAND.reportAccepted}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
        <Line
          type="stepAfter"
          dataKey="planned"
          name={t('burnup.series.planned', { unit: unitLabel })}
          stroke={BRAND.reportPlanned}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
        <Line
          type="stepAfter"
          dataKey="preliminary"
          name={t('burnup.series.preliminary')}
          stroke={BRAND.reportPreliminary}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
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
      </LineChart>
    </ChartFrame>
  )
}
