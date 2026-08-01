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
 * `demand / capacity` in one line rather than two columns: the comparison is the whole content, and
 * a rail is too narrow to carry a grid. Capacity reads "Not entered" rather than 0 — a team nobody
 * has sized is not a team with no room.
 */
export function TeamCapacityRail({
  teams,
  unitLabel,
}: {
  teams: CapacityPlanTeam[]
  unitLabel: string
}) {
  const { t } = useTranslation('capacity')
  const warningText = useCapacityWarningText()

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-l border-border-inner bg-card px-3 py-2">
      <p className="mb-2 text-ui-md font-semibold text-foreground">{t('items.sidebarHeading')}</p>

      {/* Rally heads the rail with two columns — `Name` and `Points / Capacity` — so the pair on
          each row is read as a ratio rather than as two loose numbers. The right label follows the
          plan's unit, because a plan counted in items does not have points. */}
      <div className="mb-1 flex items-end justify-between gap-2 border-b border-border-inner pb-1 text-ui-xs font-semibold text-muted-foreground">
        <span>{t('items.railName')}</span>
        {/* `capitalize` rather than a second translation key: the unit label is a noun the plan
            already owns ("points"), and Rally heads the column "Points / Capacity". */}
        <span className="text-right capitalize">{t('items.railRatio', { unit: unitLabel })}</span>
      </div>

      {teams.length === 0 && (
        <p className="text-ui-sm text-foreground-subtle">{t('detail.noTeams')}</p>
      )}

      <div className="flex flex-col gap-1">
        {teams.map((team) => {
          const labels = warningText(team.metrics.warnings)
          return (
            <div key={team.id} className="flex items-center justify-between gap-2 text-ui-sm">
              <span className="min-w-0 truncate text-foreground" title={team.teamName ?? undefined}>
                {team.teamName ?? '--'}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums">
                {team.metrics.estimated} /{' '}
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
