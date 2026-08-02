/**
 * Reports > Iteration Burndown (IB §7).
 *
 * Two measures on two axes: Task To Do in HOURS on the left (teal bars), cumulative Accepted
 * POINTS on the right (green bars), and the frozen Ideal line in hours on the left. The three
 * come from the server exactly as plotted — this component adds no arithmetic, because the
 * history is immutable and the Ideal line is a stored baseline.
 *
 * A day with no snapshot arrives as `null` and recharts leaves a gap. That is deliberate: a
 * zero would read as "no work remained".
 */
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts'

import { BRAND } from '@/shared/config/brand'
import { useIterations } from '@/features/iterations/api'
import { useIterationBurndown } from '@/features/reporting/api'
import { iterationsInScope, reportScopeLabel } from '@/features/reporting/scope'
import { IterationPicker } from '@/shared/ui/timebox-picker'
import { SkeletonList } from '@/shared/ui/skeleton'
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_TOOLTIP,
  ChartFrame,
  ChartLegendItem,
  axisLabel,
} from '@/shared/ui/chart'

import { useSelectedIteration } from '../model/use-selected-iteration'

export function IterationBurndownReport({
  projectId,
  teamId,
}: {
  projectId: string
  teamId: string | undefined
}) {
  const { t } = useTranslation(['reports', 'common'])
  const { data: allIterations = [] } = useIterations(projectId)
  // The picker offers what the report can serve — the team's own timeboxes plus the shared ones.
  const iterations = iterationsInScope(allIterations, teamId)
  const { selectedId, select } = useSelectedIteration(projectId, iterations)
  const { data, isLoading } = useIterationBurndown({ projectId, teamId, iterationId: selectedId })

  if (isLoading && !data) return <SkeletonList rows={6} cols={3} />

  const points = data?.points ?? []
  /**
   * The empty states IB §7 requires be distinguishable, in the order they can occur.
   *
   * A missing Ideal BASELINE is deliberately not one of them. IB §3 scopes the baseline to the
   * Ideal line, so blanking the chart for it threw away Task-To-Do and Accepted-Points bars that
   * were genuinely measured — the reader saw "no burndown to show" for an iteration with a week
   * of real history. It is a note under the chart now (`noBaselineNote`), not an empty state.
   */
  const emptyDescription =
    selectedId === null
      ? t('burndown.empty.noIteration')
      : data?.historyState === 'no-window'
        ? t('burndown.empty.noWindow')
        : data?.hasScheduledWork === false
          ? t('burndown.empty.noScheduledWork')
          : data?.historyState === 'missing'
            ? t('burndown.empty.noHistory')
            : undefined

  // Null baseline = no Ideal trajectory, reported beside the measured series rather than instead
  // of them. `totalTaskEstimateAtStart` is the wire's answer now that `historyState` is snapshot-only.
  const noBaseline = data !== undefined && data.totalTaskEstimateAtStart === null

  /**
   * Everything qualifying the chart, in one line under it.
   *
   * `partialCaptureDates` is the third kind of caveat and the least obvious: those days have REAL
   * numbers that were frozen before the day closed, because the hourly job stopped early. IB-BR-01
   * calls the source an end-of-day snapshot, so a reader comparing two days deserves to know which one
   * is not. The dates are named — "which day do I distrust" is the only actionable form.
   */
  const partialCaptures = data?.partialCaptureDates ?? []
  const notes = [
    data?.historyState === 'partial' ? t('burndown.partialHistory') : null,
    noBaseline ? t('burndown.noBaselineNote') : null,
    partialCaptures.length > 0
      ? t('burndown.partialCapture', {
          count: partialCaptures.length,
          dates: partialCaptures.join(', '),
        })
      : null,
  ].filter((line): line is string => line !== null)

  const behind = data?.status === 'behind-plan'

  return (
    <ChartFrame
      title={t('burndown.title')}
      subtitle={
        data
          ? reportScopeLabel(data.context.projectName, data.context.teamName, t('common:allTeams'))
          : t('burndown.title')
      }
      actions={
        <div className="flex items-center gap-3">
          <span className="text-ui-sm font-semibold text-foreground">{t('iteration')}</span>
          <IterationPicker iterations={iterations} selectedId={selectedId} onSelect={select} />
          {data?.status !== 'unknown' && (
            <span
              className={`flex items-center gap-1 text-ui-xs font-semibold ${
                behind ? 'text-destructive' : 'text-success'
              }`}
            >
              {behind ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
              {behind ? t('burndown.behindPlan') : t('burndown.onTrack')}
            </span>
          )}
        </div>
      }
      isEmpty={points.length === 0 || emptyDescription !== undefined}
      emptyTitle={t('burndown.empty.title')}
      emptyDescription={emptyDescription ?? t('burndown.empty.noHistory')}
      legend={
        <>
          <ChartLegendItem color={BRAND.reportTodo} label={t('burndown.series.todo')} />
          <ChartLegendItem
            color={BRAND.reportIdeal}
            label={t('burndown.series.ideal')}
            shape="line"
          />
          <ChartLegendItem color={BRAND.reportAccepted} label={t('burndown.series.accepted')} />
        </>
      }
      dataTable={{
        caption: t('burndown.tableCaption'),
        noDataLabel: t('common:noData'),
        columns: [
          t('burndown.axis.date'),
          t('burndown.series.todo'),
          t('burndown.series.ideal'),
          t('burndown.series.accepted'),
        ],
        // The SAME array recharts plots, so the table cannot drift from the chart — and the nulls
        // travel through untouched, which is how a gap stays a gap here too.
        rows: points.map((point) => [
          point.date,
          point.remainingToDo,
          point.ideal,
          point.acceptedPoints,
        ]),
      }}
      footer={
        notes.length > 0 ? (
          <p className="mt-2 text-center text-ui-xs text-foreground-subtle">{notes.join(' ')}</p>
        ) : null
      }
    >
      <ComposedChart data={points} margin={{ top: 12, right: 16, left: 4, bottom: 12 }}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis
          dataKey="date"
          {...CHART_AXIS}
          label={axisLabel(t('burndown.axis.date'), 'bottom')}
        />
        <YAxis
          yAxisId="hours"
          {...CHART_AXIS}
          label={axisLabel(t('burndown.axis.hours'), 'left')}
        />
        <YAxis
          yAxisId="points"
          orientation="right"
          {...CHART_AXIS}
          label={axisLabel(t('burndown.axis.points'), 'right')}
        />
        <Tooltip contentStyle={CHART_TOOLTIP} />
        <Bar
          yAxisId="hours"
          dataKey="remainingToDo"
          name={t('burndown.series.todo')}
          fill={BRAND.reportTodo}
          barSize={34}
        />
        <Line
          yAxisId="hours"
          type="linear"
          dataKey="ideal"
          name={t('burndown.series.ideal')}
          stroke={BRAND.reportIdeal}
          strokeWidth={2.5}
          dot={{ r: 3, fill: BRAND.reportIdeal }}
          // `false` keeps the line broken across a day with no baseline rather than bridging it.
          connectNulls={false}
        />
        <Bar
          yAxisId="points"
          dataKey="acceptedPoints"
          name={t('burndown.series.accepted')}
          fill={BRAND.reportAccepted}
          barSize={18}
        />
      </ComposedChart>
    </ChartFrame>
  )
}
