import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { useCapacityWarningText } from '@/features/capacity-planning/warning-labels'
import type { CapacityPlanTeam } from '@/features/capacity-planning/api'

/**
 * Rally's `Project Capacity` rail, beside the Features tab: every team in the plan with its
 * committed demand over its capacity, and a warning glyph where a rule is exceeded.
 *
 * Only on the FEATURES tab, which is where Rally shows it and the only place it is not a repeat.
 * The cutline that tab draws is PLAN-wide — "these Features do not fit" — and the immediate next
 * question is which team has no room left. The team grid answers that per row already, so a rail
 * there would restate the columns beside it.
 *
 * Three figures per team, because Rally's panel carries three: it "shows the current assigned and
 * allocated points/count and the total capacity for each team". Assigned and allocated are not the
 * same commitment — an assigned row charges the Feature's own estimate to the team, an allocated row
 * charges a number a planner typed — and a single total hides which kind of promise the team is
 * carrying. Capacity reads "Not entered" rather than 0: a team nobody has sized is not a team with
 * no room.
 */
export function TeamCapacityRail({
  teams,
  unitLabel,
  demandOf,
}: {
  teams: CapacityPlanTeam[]
  unitLabel: string
  /**
   * The team's demand split into Rally's two kinds.
   *
   * Resolved by the page from the plan's allocation rows: the team summary carries only their sum, and
   * the split is a property of the rows. `assigned + allocated` is `metrics.estimated`, so the rail
   * cannot disagree with the grid beside it.
   */
  demandOf: (teamId: string) => { assigned: number; allocated: number }
}) {
  const { t } = useTranslation('capacity')
  const warningText = useCapacityWarningText()

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-border-inner bg-card px-3 py-2">
      {/* The unit is named ONCE, here: all three figures share it, and repeating it in a column
          heading stole the width the team names need. */}
      <p className="mb-2 text-ui-md font-semibold text-foreground capitalize">
        {t('items.sidebarHeading', { unit: unitLabel })}
      </p>

      {/* Rally's own three headings, so each number is read against its own label rather than as one
          ratio. The unit is named once, on the heading row, because all three figures share it. */}
      <div className="mb-1 flex items-end gap-1 border-b border-border-inner pb-1 text-ui-xs font-semibold text-muted-foreground">
        <span className="min-w-0 flex-1">{t('items.railName')}</span>
        <span className="w-12 shrink-0 text-right">{t('items.railAssigned')}</span>
        <span className="w-12 shrink-0 text-right">{t('items.railAllocated')}</span>
        {/* `capitalize` rather than a second key: the unit label is a noun the plan already owns. */}
        <span className="w-20 shrink-0 text-right">{t('items.railCapacity')}</span>
      </div>

      {teams.length === 0 && (
        <p className="text-ui-sm text-foreground-subtle">{t('detail.noTeams')}</p>
      )}

      <div className="flex flex-col gap-1">
        {teams.map((team) => {
          const labels = warningText(team.metrics.warnings)
          const demand = demandOf(team.teamId)
          return (
            <div key={team.id} className="flex items-center gap-1 text-ui-sm">
              {/* Wrapped, not truncated: a team name is the row's subject, and the rail is narrow
                  enough that truncation hid the part that tells two teams apart. */}
              <span
                className="min-w-0 flex-1 break-words whitespace-normal text-foreground"
                title={team.teamName ?? undefined}
              >
                {team.teamName ?? '--'}
              </span>
              <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">
                {demand.assigned}
              </span>
              <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">
                {demand.allocated}
              </span>
              {/* `w-24` + `whitespace-nowrap`: at 64px "Not entered" wrapped onto a second line and
                  pushed the warning glyph past the column's right edge, flush to the window. */}
              <span className="flex w-24 shrink-0 items-center justify-end gap-1 whitespace-nowrap text-muted-foreground tabular-nums">
                {team.metrics.capacity === null ? (
                  <span className="text-foreground-subtle">{t('row.notEntered')}</span>
                ) : (
                  team.metrics.capacity
                )}
                {labels.length > 0 && (
                  <span
                    role="img"
                    aria-label={labels.join('. ')}
                    title={labels.join('\n')}
                    className="flex items-center"
                  >
                    <AlertTriangle size={11} style={{ color: BRAND.warning }} />
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
