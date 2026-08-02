/**
 * Reports > Velocity (Velocity SRS §6).
 *
 * A stacked bar per completed timebox — Accepted During / Accepted After / Not Accepted — with
 * a flat Trend line at the window average, and the Last 3 / Best 3 / Worst 3 summary above it.
 * Only During feeds the trend and the averages; the other two segments are context.
 *
 * Points belonging to an accepted item with no acceptance timestamp are in no segment at all.
 * They arrive as `unclassified` and are reported as a data-quality gap, because the SRS forbids
 * guessing whether such an item was accepted during or after the iteration.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts'

import { BRAND } from '@/shared/config/brand'
import { useVelocity, type VelocityWindow } from '@/features/reporting/api'
import { teamScopeLabel } from '@/features/reporting/scope'
import { MetricCard } from '@/shared/ui/metric-card'
import { NativeSelect } from '@/shared/ui/native-select'
import { SkeletonList } from '@/shared/ui/skeleton'
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_TOOLTIP,
  ChartFrame,
  ChartLegendItem,
  axisLabel,
} from '@/shared/ui/chart'

const fmt = (value: number | null | undefined) => (value == null ? '--' : value.toFixed(2))

export function VelocityReport({
  projectId,
  teamId,
}: {
  projectId: string
  teamId: string | undefined
}) {
  const { t } = useTranslation(['reports', 'common'])
  const [window, setWindow] = useState<VelocityWindow>(5)
  const { data, isLoading } = useVelocity({ projectId, teamId, window })

  if (isLoading && !data) return <SkeletonList rows={6} cols={3} />

  const bars = data?.bars ?? []
  const averages = data?.averages
  // A flat line at the window average: the SRS's Trend is one value repeated across the bars,
  // not a per-bar figure.
  const chartData = bars.map((bar) => ({ ...bar, trend: averages?.trend }))

  return (
    <ChartFrame
      title={t('velocity.title')}
      actions={
        <div className="flex items-center gap-4">
          <span className="text-ui-xs font-semibold text-muted-foreground">
            {t('velocity.teamContext', {
              team: teamScopeLabel(data?.context.teamName, t('common:allTeams')),
            })}
          </span>
          <label className="flex items-center gap-2 text-ui-xs font-semibold text-foreground-subtle">
            {t('velocity.window')}
            <NativeSelect
              value={String(window)}
              onChange={(event) => setWindow(Number(event.target.value) as VelocityWindow)}
              aria-label={t('velocity.window')}
            >
              <option value="5">{t('velocity.windowLast', { count: 5 })}</option>
              <option value="10">{t('velocity.windowLast', { count: 10 })}</option>
            </NativeSelect>
          </label>
        </div>
      }
      subtitle={
        averages && averages.sampleSize > 0 ? (
          <span className="flex flex-col items-center gap-2">
            <span className="text-ui-xs font-semibold text-muted-foreground">
              {t('velocity.averagesOver', { count: window })}
              {/* The SRS requires the real sample size be exposed below three values, rather
                  than two of them being averaged under a "Last 3" heading. */}
              {averages.sampleSize < 3 &&
                ` · ${t('velocity.sampleSize', { count: averages.sampleSize })}`}
            </span>
            <span className="flex justify-center gap-8">
              <MetricCard
                label={t('velocity.last3')}
                value={fmt(averages.last3)}
                caption={t('units.points')}
                valueColor={BRAND.reportDuring}
                minWidth={90}
              />
              <MetricCard
                label={t('velocity.best3')}
                value={fmt(averages.best3)}
                caption={t('units.points')}
                valueColor={BRAND.reportDuring}
                minWidth={90}
              />
              <MetricCard
                label={t('velocity.worst3')}
                value={fmt(averages.worst3)}
                caption={t('units.points')}
                valueColor={BRAND.reportDuring}
                minWidth={90}
              />
            </span>
          </span>
        ) : undefined
      }
      isEmpty={bars.length === 0}
      emptyTitle={t('velocity.empty.title')}
      emptyDescription={t('velocity.empty.description')}
      legend={
        <>
          <ChartLegendItem color={BRAND.reportDuring} label={t('velocity.series.during')} />
          <ChartLegendItem color={BRAND.reportAfter} label={t('velocity.series.after')} />
          <ChartLegendItem
            color={BRAND.reportNotAccepted}
            label={t('velocity.series.notAccepted')}
          />
          <ChartLegendItem
            color={BRAND.reportTrend}
            shape="line"
            label={t('velocity.series.trend', { value: fmt(averages?.trend) })}
          />
        </>
      }
      dataTable={{
        caption: t('velocity.tableCaption'),
        noDataLabel: t('common:noData'),
        columns: [
          t('velocity.tableIteration'),
          t('velocity.series.during'),
          t('velocity.series.after'),
          t('velocity.series.notAccepted'),
        ],
        // The Trend is deliberately absent: it is one repeated value, already stated in the legend,
        // and a column of the same number on every row is noise to read aloud.
        rows: bars.map((bar) => [bar.name, bar.acceptedDuring, bar.acceptedAfter, bar.notAccepted]),
      }}
      footer={
        data && data.unclassifiedItems > 0 ? (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-ui-xs text-destructive">
            <AlertTriangle size={12} />
            {t('velocity.unclassified', { count: data.unclassifiedItems })}
          </p>
        ) : null
      }
    >
      <ComposedChart data={chartData} margin={{ top: 8, right: 18, left: 8, bottom: 14 }}>
        <CartesianGrid {...CHART_GRID} vertical={false} />
        <XAxis dataKey="name" {...CHART_AXIS} />
        <YAxis {...CHART_AXIS} label={axisLabel(t('velocity.axis.points'), 'left')} />
        <Tooltip contentStyle={CHART_TOOLTIP} />
        <Bar
          dataKey="acceptedDuring"
          stackId="velocity"
          name={t('velocity.series.during')}
          fill={BRAND.reportDuring}
          barSize={52}
        />
        <Bar
          dataKey="acceptedAfter"
          stackId="velocity"
          name={t('velocity.series.after')}
          fill={BRAND.reportAfter}
          barSize={52}
        />
        <Bar
          dataKey="notAccepted"
          stackId="velocity"
          name={t('velocity.series.notAccepted')}
          fill={BRAND.reportNotAccepted}
          barSize={52}
          radius={[2, 2, 0, 0]}
        />
        <Line
          type="monotone"
          dataKey="trend"
          name={t('velocity.series.trend', { value: fmt(averages?.trend) })}
          stroke={BRAND.reportTrend}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ChartFrame>
  )
}
