/**
 * Reports > Team Capacity (Team Capacity SRS §6).
 *
 * A read-only projection of the Team Status hours: four indicators, then a Team → Member table
 * where each Team row expands. Deliberately built from the same primitives as Team Status
 * (`useDataTable` for the header + column widths, `TableTotalsRow` alignment contract,
 * `RowExpandToggle`, `NESTED_ROW_INDENT`) so the two screens read as one system — they show the
 * same numbers and must not look like different products.
 *
 * No editable capacity control, no utilisation card, no progress bar: §6 lists what the
 * approved report contains, and those are explicitly not in it. Capacity is still edited on
 * Team Status, which owns `team_status:edit`.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BRAND } from '@/shared/config/brand'
import { NESTED_ROW_INDENT } from '@/shared/config/layout'
import { useIterations } from '@/features/iterations/api'
import { useTeamCapacityReport, type TeamCapacityTeam } from '@/features/reporting/api'
import { EmptyState } from '@/shared/ui/empty-state'
import { MetricCard } from '@/shared/ui/metric-card'
import { RowExpandToggle } from '@/shared/ui/row-expand-toggle'
import { IterationPicker } from '@/shared/ui/timebox-picker'
import { DataTableFrame, useDataTable, type ColumnSpec } from '@/shared/ui/table'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'

import { useSelectedIteration } from '../model/use-selected-iteration'

type ColKey = 'member' | 'capacity' | 'estimate' | 'todo' | 'actual'

/** `132h`. Hours are already rounded server-side; this only adds the unit. */
const formatHours = (value: number) => `${value}h`

export function TeamCapacityReport({
  projectId,
  teamId,
}: {
  projectId: string
  teamId: string | undefined
}) {
  const { t } = useTranslation('reports')
  const { data: iterations = [] } = useIterations(projectId)
  const { selectedId, select } = useSelectedIteration(projectId, iterations)
  const { data, isLoading } = useTeamCapacityReport({ projectId, teamId, iterationId: selectedId })

  const columns: ColumnSpec<TeamCapacityTeam, unknown, ColKey>[] = [
    {
      key: 'member',
      label: t('capacity.columns.member'),
      defaultWidth: 320,
      minWidth: 200,
      grow: true,
      locked: true,
    },
    { key: 'capacity', label: t('capacity.columns.capacity'), defaultWidth: 120, align: 'right' },
    { key: 'estimate', label: t('capacity.columns.estimate'), defaultWidth: 120, align: 'right' },
    { key: 'todo', label: t('capacity.columns.todo'), defaultWidth: 120, align: 'right' },
    { key: 'actual', label: t('capacity.columns.actual'), defaultWidth: 120, align: 'right' },
  ]
  const table = useDataTable<TeamCapacityTeam, unknown, ColKey>(columns, {
    storageKey: 'reports:team-capacity',
  })

  const totals = data?.totals
  const teams = data?.teams ?? []

  // §6: the empty state has to say WHICH absence this is — no capacity planned, no scoped task
  // data, or neither — because they are different problems for the reader to act on.
  const emptyDescription =
    selectedId === null
      ? t('capacity.empty.noIteration')
      : data && !data.hasCapacity && !data.hasTaskHours
        ? t('capacity.empty.neither')
        : data && !data.hasCapacity
          ? t('capacity.empty.noCapacity')
          : data && !data.hasTaskHours
            ? t('capacity.empty.noTasks')
            : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border border-border-strong bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-ui-sm font-semibold text-foreground">
            {t('capacity.title', { scope: data?.context.teamName ?? '' })}
          </p>
          <span className="text-ui-sm font-semibold text-foreground">{t('iteration')}</span>
          <IterationPicker iterations={iterations} selectedId={selectedId} onSelect={select} />
        </div>
        <span className="text-ui-xs text-foreground-subtle">{t('capacity.source')}</span>
      </div>

      <div className="mb-4 flex gap-8">
        <MetricCard
          label={t('capacity.indicators.capacity')}
          value={formatHours(totals?.capacityHours ?? 0)}
          minWidth={120}
        />
        <MetricCard
          label={t('capacity.indicators.estimate')}
          value={formatHours(totals?.estimateHours ?? 0)}
          minWidth={120}
        />
        <MetricCard
          label={t('capacity.indicators.todo')}
          value={formatHours(totals?.todoHours ?? 0)}
          valueColor={BRAND.warning}
          minWidth={120}
        />
        <MetricCard
          label={t('capacity.indicators.actual')}
          value={formatHours(totals?.actualHours ?? 0)}
          valueColor={BRAND.success}
          minWidth={120}
        />
      </div>

      <DataTableFrame<ColKey>
        header={table.headerProps}
        leading={<div className="w-6 shrink-0" />}
        loading={isLoading && !data}
        totals={
          totals ? (
            <TableTotalsRow
              columns={table.headerProps.columns}
              colStyles={table.colStyles}
              leading={<div className="w-6 shrink-0" />}
              label={t('capacity.totals')}
              labelColKey="member"
              values={{
                capacity: formatHours(totals.capacityHours),
                estimate: formatHours(totals.estimateHours),
                todo: formatHours(totals.todoHours),
                actual: formatHours(totals.actualHours),
              }}
            />
          ) : undefined
        }
        empty={
          teams.length === 0 ? (
            <EmptyState
              title={t('capacity.empty.title')}
              description={emptyDescription ?? t('capacity.empty.neither')}
            />
          ) : undefined
        }
      >
        {teams.map((team) => (
          <TeamGroup key={team.id ?? team.name} team={team} colStyles={table.colStyles} />
        ))}
      </DataTableFrame>
    </div>
  )
}

/**
 * One Team row plus its members.
 *
 * Expanded by default, matching the mockup: the member rows are the report's substance, and a
 * reader who opened Team Capacity is looking for them.
 */
function TeamGroup({
  team,
  colStyles,
}: {
  team: TeamCapacityTeam
  colStyles: Record<string, React.CSSProperties>
}) {
  const { t } = useTranslation('reports')
  const [expanded, setExpanded] = useState(true)

  return (
    <div>
      <div className="flex h-9 items-center border-b border-border-inner bg-surface-hover px-3">
        <div className="w-6 shrink-0" />
        <div className="flex items-center gap-1.5 truncate" style={colStyles.member}>
          <RowExpandToggle
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            label={t('capacity.expandTeam', { team: team.name })}
          />
          <span className="truncate text-ui-md font-semibold text-foreground">{team.name}</span>
        </div>
        <HoursCells values={team.totals} colStyles={colStyles} bold />
      </div>

      {expanded &&
        team.members.map((member) => (
          <div
            key={member.id ?? member.name}
            className="flex h-8 items-center border-b border-border-inner px-3"
          >
            <div className="w-6 shrink-0" />
            <div className={`truncate ${NESTED_ROW_INDENT}`} style={colStyles.member}>
              <span className="text-ui-md text-muted-foreground">{member.name}</span>
            </div>
            <HoursCells values={member.hours} colStyles={colStyles} />
          </div>
        ))}
    </div>
  )
}

function HoursCells({
  values,
  colStyles,
  bold = false,
}: {
  values: TeamCapacityTeam['totals']
  colStyles: Record<string, React.CSSProperties>
  bold?: boolean
}) {
  const weight = bold ? 'font-semibold text-foreground' : 'text-muted-foreground'
  return (
    <>
      {(['capacity', 'estimate', 'todo', 'actual'] as const).map((key) => (
        <div key={key} className="truncate text-right" style={colStyles[key]}>
          <span className={`text-ui-md tabular-nums ${weight}`}>
            {formatHours(
              key === 'capacity'
                ? values.capacityHours
                : key === 'estimate'
                  ? values.estimateHours
                  : key === 'todo'
                    ? values.todoHours
                    : values.actualHours,
            )}
          </span>
        </div>
      ))}
    </>
  )
}
