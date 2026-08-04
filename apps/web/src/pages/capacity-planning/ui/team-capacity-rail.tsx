import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { WarningIndicator } from '@/shared/ui/warning-indicator'
import { TeamCell } from '@/shared/ui/team-cell'
import { SortHeaderCell } from '@/shared/ui/sort-header-cell'
import { useTableSort } from '@/shared/lib/hooks/use-table-sort'
import { useCapacityWarningText } from '@/features/capacity-planning/warning-labels'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import { TABLE_HEADER_H, TOOLBAR_ROW_H } from '@/shared/config/layout'
import type { CapacityPlanTeam } from '@/features/capacity-planning/api'

type RailSortField = 'name' | 'demand'

/**
 * Rally's `Project Capacity` rail, beside the Features tab: every team in the plan, its committed
 * demand over its capacity, and a red glyph on the ones that do not fit.
 *
 * Only on the FEATURES tab, which is where Rally shows it and the only place it is not a repeat. The
 * cutline that tab draws is PLAN-wide — "these Features do not fit" — and the immediate next question
 * is which team has no room left. The team grid answers that per row already, so a rail there would
 * restate the columns beside it.
 *
 * TWO COLUMNS, matched to the real panel: `Name`, and one `{unit} / Capacity` cell reading `407 / 375`.
 * It had four — Name, Assigned, Alloc., Capacity — from a reading of the Broadcom sentence "shows the
 * current assigned and allocated points/count and the total capacity"; the product itself draws one
 * ratio, and splitting it stole the width the team names need in a 320px rail. `Assigned` was also
 * dead by then: it counted allocation rows with a NULL `value`, and `value` became NOT NULL when the
 * allocation snapshot landed, so the column printed 0 for every team on every plan.
 *
 * The rail SORTS ITSELF, ascending by name to start, exactly as the panel does. It used to render
 * whatever order the Teams tab's grid sort had left behind — a sort control on a different tab, which
 * nothing on this tab explains.
 */
export function TeamCapacityRail({
  teams,
  unitLabel,
  teamKeyOf,
}: {
  teams: CapacityPlanTeam[]
  unitLabel: string
  /** Team id → key, so the chip shows the same two letters as everywhere else the team appears. */
  teamKeyOf: (teamId: string | null | undefined) => string | null
}) {
  const { t } = useTranslation('capacity')
  const warningText = useCapacityWarningText()
  const { sortField, sortDir, toggle } = useTableSort<RailSortField>({ field: 'name', dir: 'asc' })

  const rows = useMemo(() => {
    const ordered = [...teams]
    const dir = sortDir === 'desc' ? -1 : 1
    ordered.sort((a, b) =>
      sortField === 'demand'
        ? dir * (a.metrics.estimated - b.metrics.estimated)
        : dir * (a.teamName ?? '').localeCompare(b.teamName ?? ''),
    )
    return ordered
  }, [teams, sortField, sortDir])

  return (
    <aside className="ml-2 flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border-inner bg-card pl-3">
      {/* THREE bands, each level with the grid's: the heading sits on the toolbar's line, the column
          headings on the grid header's line, and the rows follow. Both heights come from the shared
          tokens, because two panels in separate flex columns can only line up if they agree on a
          number — the rail used to start below the toolbar, so every band was a row out of step with
          the table it is read against. */}
      <p
        className="flex shrink-0 items-center border-b border-border-subtle bg-card px-3 text-ui-md font-semibold text-foreground"
        style={{ minHeight: TOOLBAR_ROW_H }}
      >
        {t('items.sidebarHeading')}
      </p>

      <div className="flex flex-col">
        {/* WHITE, like the heading above it — the grid's grey header band stops at the divider. The rail
            is its own panel, and carrying that band across made the two read as one table whose
            right-hand columns had different headings. The ruled bottom edge separates heading from rows
            here. */}
        <div
          className="flex shrink-0 items-center gap-2 border-b border-border-inner bg-card px-3"
          style={{ minHeight: TABLE_HEADER_H }}
        >
          <SortHeaderCell
            label={t('items.railName')}
            active={sortField === 'name'}
            dir={sortDir}
            onToggle={() => toggle('name')}
            className="flex-1"
          />
          {/* ONE heading for the ratio, carrying the unit — `Points / Capacity`, or `Count / Capacity`
              on a count plan. `capitalize` rather than a second key: the unit label is a noun the plan
              already owns, and it is lower-case where the plan header prints it. */}
          <SortHeaderCell
            label={t('items.railDemand', { unit: unitLabel })}
            active={sortField === 'demand'}
            dir={sortDir}
            onToggle={() => toggle('demand')}
            align="right"
            className="w-24 shrink-0 capitalize"
          />
        </div>

        {rows.length === 0 && (
          <p className="px-3 py-3 text-ui-sm text-foreground-subtle">{t('detail.noTeams')}</p>
        )}

        {rows.map((team) => {
          const labels = warningText(team.metrics.warnings)
          return (
            <div
              key={team.id}
              className="flex items-center gap-2 border-b border-border-inner px-3 py-2.5 text-ui-sm last:border-b-0"
            >
              {/* The shared `TeamCell` — square glyph plus name — so a team in the rail looks like the
                  same team in the grid's Team column. It wraps rather than truncates, which the rail
                  needs: at 288px, truncation hid the part that tells two teams apart. */}
              <TeamCell
                teamKey={teamKeyOf(team.teamId)}
                name={team.teamName}
                className="min-w-0 flex-1"
              />
              <span className="flex w-24 shrink-0 items-center justify-end gap-1 text-right text-muted-foreground tabular-nums">
                <span className="break-words whitespace-normal">
                  {/* An UNSIZED team reads `21 / --`, not `21 / 0`: nobody having entered a capacity is
                      not the same as a team with no room, and the warning glyph beside it says which. */}
                  {team.metrics.estimated} / {team.metrics.capacity ?? EMPTY_VALUE}
                </span>
                {/* Red, the same severity the grid draws — this was AMBER for the very same team
                    warnings, so one rule looked like two depending on which panel it was read in. */}
                <WarningIndicator labels={labels} size={11} />
              </span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
