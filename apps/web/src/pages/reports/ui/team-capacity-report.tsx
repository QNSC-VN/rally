/**
 * Reports > Team Capacity (Team Capacity SRS §6).
 *
 * A read-only projection of the Team Status hours: four indicators, then a Team → Member table
 * where each Team row expands. Deliberately built from the same primitives as Team Status
 * (`useDataTable` for the header + column widths, `RowExpandToggle`, `NESTED_ROW_INDENT`) so the
 * two screens read as one system — they show the same numbers and must not look like different
 * products.
 *
 * No editable capacity control, no utilisation card, no progress bar, no totals row and no status
 * colours on the indicators: §6 lists what the approved report contains, and none of those are in
 * it. Capacity is still edited on Team Status, which owns `team_status:edit`.
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NESTED_ROW_INDENT } from '@/shared/config/layout'
import { useIterations } from '@/features/iterations/api'
import { useTeamCapacityReport, type TeamCapacityTeam } from '@/features/reporting/api'
import { iterationsInScope, teamScopeLabel } from '@/features/reporting/scope'
import { TEAM_STATUS_STYLE } from '@/features/teams/status-colors'
import { Avatar } from '@/shared/ui/avatar'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { EmptyState } from '@/shared/ui/empty-state'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { RowExpandToggle } from '@/shared/ui/row-expand-toggle'
import { StatusBadge } from '@/shared/ui/status-badge'
import { IterationPicker } from '@/shared/ui/timebox-picker'
import { DataTableFrame, useDataTable, type ColumnSpec } from '@/shared/ui/table'
import { NUMERIC_CELL_CLASS } from '@/shared/lib/utils'

import { ReportSurface } from './report-surface'
import { useSelectedIteration } from '../model/use-selected-iteration'

type ColKey = 'member' | 'capacity' | 'estimate' | 'todo' | 'actual'

/** The four hour measures, in the fixed order SRS §3 lists them. */
const HOUR_KEYS = ['capacity', 'estimate', 'todo', 'actual'] as const
type HourKey = (typeof HOUR_KEYS)[number]

/** `132h`. Hours are already rounded server-side; this only adds the unit. */
const formatHours = (value: number) => `${value}h`

/**
 * Hours off a totals/member record by column key. One mapping, used by the group row, the
 * member row and the sort comparator, so a renamed field cannot make two of them disagree.
 */
const hoursFor = (values: TeamCapacityTeam['totals'], key: HourKey): number =>
  key === 'capacity'
    ? values.capacityHours
    : key === 'estimate'
      ? values.estimateHours
      : key === 'todo'
        ? values.todoHours
        : values.actualHours

export function TeamCapacityReport({
  projectId,
  teamId,
}: {
  projectId: string
  teamId: string | undefined
}) {
  const { t } = useTranslation(['reports', 'common'])
  const { data: allIterations = [] } = useIterations(projectId)
  // Same scope rule as the report itself: the team's own timeboxes plus the project's shared ones.
  const iterations = iterationsInScope(allIterations, teamId)
  const { selectedId, select } = useSelectedIteration(projectId, iterations)
  const { data, isLoading, isError } = useTeamCapacityReport({
    projectId,
    teamId,
    iterationId: selectedId,
  })

  // Sort the TEAM rows by an hour aggregate, the same click-to-sort header wiring Team Status
  // uses for its member groups. Members keep their server order inside a team: the SRS orders
  // them by the roster, and re-sorting a two-level table on one key reads as flat.
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const toggleSort = useCallback(
    (col: string) => {
      if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      else {
        setSortCol(col)
        setSortDir('asc')
      }
    },
    [sortCol],
  )

  const columns: ColumnSpec<TeamCapacityTeam, unknown, ColKey>[] = [
    {
      key: 'member',
      label: t('capacity.columns.member'),
      defaultWidth: 320,
      minWidth: 200,
      grow: true,
      locked: true,
    },
    ...HOUR_KEYS.map((key) => ({
      key,
      label: t(`capacity.columns.${key}`),
      defaultWidth: 120,
      minWidth: 90,
      align: 'right' as const,
      sortCol: key,
    })),
  ]
  const table = useDataTable<TeamCapacityTeam, unknown, ColKey>(columns, {
    storageKey: 'reports:team-capacity',
    sort: { col: sortCol, dir: sortDir, onSort: toggleSort },
    leadingWidth: 24,
  })

  const totals = data?.totals
  const teams = data?.teams ?? []
  const sortedTeams =
    sortCol && HOUR_KEYS.includes(sortCol as HourKey)
      ? [...teams].sort(
          (a, b) =>
            (hoursFor(a.totals, sortCol as HourKey) - hoursFor(b.totals, sortCol as HourKey)) *
            (sortDir === 'desc' ? -1 : 1),
        )
      : teams

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
    <ReportSurface
      title={t('capacity.title', {
        scope: teamScopeLabel(data?.context.teamName, t('common:allTeams')),
      })}
      caption={t('capacity.source')}
      controls={
        <>
          <span className="text-ui-xs font-semibold text-foreground-subtle">{t('iteration')}</span>
          <IterationPicker iterations={iterations} selectedId={selectedId} onSelect={select} />
          <ColumnFieldsMenu {...table.fieldsMenuProps} />
        </>
      }
      strip={
        <MetricStrip>
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
          {/* No `valueColor` on any of the four. ToDo was amber and Actual green, which reads as a
              verdict — amber says "look at this" about a number that is simply the remaining work,
              and §6 gives these indicators no status meaning to report. Capacity and Estimate were
              already neutral, so three of the four values also disagreed about what a colour meant. */}
          <MetricCard
            label={t('capacity.indicators.todo')}
            value={formatHours(totals?.todoHours ?? 0)}
            minWidth={120}
          />
          <MetricCard
            label={t('capacity.indicators.actual')}
            value={formatHours(totals?.actualHours ?? 0)}
            minWidth={120}
          />
        </MetricStrip>
      }
    >
      <DataTableFrame<ColKey>
        header={table.headerProps}
        leading={<div className="w-6 shrink-0" />}
        loading={isLoading && !data}
        skeleton={{ rows: 8, cols: 5 }}
        /* No totals row. It printed `capacityHours / estimateHours / todoHours / actualHours` — the
           same four numbers from the same `totals` object as the four indicator cards directly above
           it, on the same screen. §6 lists what the approved report contains and a table footer is
           not in it; the indicators ARE the totals. */
        // A failed load is NOT an empty scope. Without this the query's error fell through to
        // the empty state, which told the reader "no capacity has been planned" — a data
        // conclusion drawn from a network fault.
        error={
          isError ? (
            <EmptyState title={t('capacity.error.title')} description={t('capacity.error.body')} />
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
        {sortedTeams.map((team) => (
          <TeamGroup key={team.id ?? team.name} team={team} colStyles={table.colStyles} />
        ))}
      </DataTableFrame>
    </ReportSurface>
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
      {/* Group row — the same anatomy as a Team Status member group (caret, avatar, name, a
          muted child count) so the two grouped tables read as one component, not two. */}
      <div className="flex h-9 items-center border-b border-border-inner bg-surface-hover px-3">
        <div className="w-6 shrink-0" />
        <div className="flex min-w-0 items-center gap-2 px-2" style={colStyles.member}>
          <RowExpandToggle
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            label={t('capacity.expandTeam', { team: team.name })}
          />
          <Avatar name={team.name} size={20} />
          <span className="truncate text-ui-sm font-semibold text-foreground">{team.name}</span>
          <span className="shrink-0 text-ui-xs text-foreground-subtle">
            {t('capacity.memberCount', { count: team.members.length })}
          </span>
          {/* An archived Team keeps its hours — archiving a Team does not delete its linked
              Work Item/Sprint history (DB design §488), and a total that shrinks for an invisible
              reason is worse than one that explains itself. But the global Team picker hides
              archived teams, so without this badge the row is indistinguishable from a live team's
              and a reader would compare a disbanded team's numbers to current ones. */}
          {team.archived && <StatusBadge style={TEAM_STATUS_STYLE.archived} className="shrink-0" />}
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
            <div className={`truncate px-2 ${NESTED_ROW_INDENT}`} style={colStyles.member}>
              <span className="text-ui-sm text-muted-foreground">{member.name}</span>
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
      {HOUR_KEYS.map((key) => (
        // `px-2` is the shared header's per-column padding and the totals row's; without it the
        // body digits sat ~8px right of both. `NUMERIC_CELL_CLASS` is the app-wide contract for
        // a numeric cell (right + font-mono + tabular-nums) — the totals row already applies
        // font-mono to right-aligned columns, so anything else made one column three fonts.
        <div
          key={key}
          className={`shrink-0 truncate px-2 ${NUMERIC_CELL_CLASS}`}
          style={colStyles[key]}
        >
          <span className={`text-ui-sm ${weight}`}>{formatHours(hoursFor(values, key))}</span>
        </div>
      ))}
    </>
  )
}
