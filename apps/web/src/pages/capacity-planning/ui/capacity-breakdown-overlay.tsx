import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import { AppModal, ModalBody } from '@/shared/ui/app-modal'
import { BRAND } from '@/shared/config/brand'
import { useCapacityWarningText } from '@/features/capacity-planning/warning-labels'
import type { CapacityPlan } from '@/features/capacity-planning/api'

/**
 * Rally's Breakdown: the four numbers behind every bar, spelled out.
 *
 * Rally documents exactly these columns — "Complete: the total number of leaf story
 * points/count that are completed for the children of the assigned portfolio items",
 * Rollup, Estimated, Capacity — and opens them from a Breakdown button. The grid shows the
 * same four values as a `CompositeBar`, which answers "is this team over?" at a glance but
 * not "by how much"; a bar cannot be read to a number, and hovering each row one at a time
 * to compare teams is not comparison.
 *
 * Remaining is derived here rather than served: it is `capacity - estimated` and adding a
 * field for a subtraction the client can do would be one more number to keep consistent.
 * Blank — not 0 — when the team has no capacity, because "nothing left" and "no ceiling
 * stated" are different answers.
 *
 * No footer: `AppModal` already gives an X, Esc and a backdrop click, and this overlay has
 * nothing to confirm. A footer Close would be a third path to the same action carrying the
 * same accessible name as the X.
 */
export function CapacityBreakdownOverlay({
  plan,
  unitLabel,
  onClose,
}: {
  plan: CapacityPlan
  unitLabel: string
  onClose: () => void
}) {
  const { t } = useTranslation('capacity')
  const warningText = useCapacityWarningText()

  const totals = plan.teams.reduce(
    (acc, team) => ({
      complete: acc.complete + team.metrics.complete,
      rollup: acc.rollup + team.metrics.rollup,
      estimated: acc.estimated + team.metrics.estimated,
      // Capacity totals only over teams that HAVE one, and stays null while none does —
      // summing nulls as zero would report a plan with no capacity as a plan with none
      // available, which reads as a full plan rather than an unstarted one.
      capacity:
        team.metrics.capacity === null ? acc.capacity : (acc.capacity ?? 0) + team.metrics.capacity,
    }),
    { complete: 0, rollup: 0, estimated: 0, capacity: null as number | null },
  )

  return (
    <AppModal
      open
      onClose={onClose}
      title={t('breakdown.title')}
      subtitle={t('breakdown.subtitle', { unit: unitLabel })}
      width={620}
    >
      <ModalBody>
        {plan.teams.length === 0 ? (
          <p className="text-ui-sm text-foreground-subtle">{t('breakdown.noTeams')}</p>
        ) : (
          <table className="w-full text-ui-sm tabular-nums">
            <thead>
              <tr className="border-b border-border-inner text-left text-ui-xs text-foreground-subtle">
                <th scope="col" className="py-1 pr-2 font-medium">
                  {t('breakdown.team')}
                </th>
                <th scope="col" className="px-2 py-1 text-right font-medium">
                  {t('breakdown.complete')}
                </th>
                <th scope="col" className="px-2 py-1 text-right font-medium">
                  {t('breakdown.rollup')}
                </th>
                <th scope="col" className="px-2 py-1 text-right font-medium">
                  {t('breakdown.estimated')}
                </th>
                <th scope="col" className="px-2 py-1 text-right font-medium">
                  {t('breakdown.capacity')}
                </th>
                <th scope="col" className="py-1 pl-2 text-right font-medium">
                  {t('breakdown.remaining')}
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.teams.map((team) => {
                const labels = warningText(team.metrics.warnings)
                const capacity = team.metrics.capacity
                return (
                  <tr key={team.id} className="border-b border-border-inner">
                    <th scope="row" className="py-1 pr-2 text-left font-normal text-foreground">
                      <span className="flex items-center gap-1">
                        <span className="truncate">{team.teamName ?? '—'}</span>
                        {labels.length > 0 && (
                          <span
                            role="img"
                            aria-label={labels.join('. ')}
                            title={labels.join('\n')}
                            className="flex shrink-0 items-center"
                          >
                            <AlertTriangle size={11} style={{ color: BRAND.warning }} />
                          </span>
                        )}
                      </span>
                    </th>
                    <td className="px-2 py-1 text-right">{team.metrics.complete}</td>
                    <td className="px-2 py-1 text-right">{team.metrics.rollup}</td>
                    <td className="px-2 py-1 text-right">{team.metrics.estimated}</td>
                    <td className="px-2 py-1 text-right">
                      {capacity === null ? (
                        <span className="text-foreground-subtle">{t('row.notEntered')}</span>
                      ) : (
                        capacity
                      )}
                    </td>
                    <td className="py-1 pl-2 text-right">
                      {capacity === null ? (
                        <span className="text-foreground-subtle">—</span>
                      ) : (
                        capacity - team.metrics.estimated
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-foreground">
                <th scope="row" className="py-1 pr-2 text-left">
                  {t('breakdown.total')}
                </th>
                <td className="px-2 py-1 text-right">{totals.complete}</td>
                <td className="px-2 py-1 text-right">{totals.rollup}</td>
                <td className="px-2 py-1 text-right">{totals.estimated}</td>
                <td className="px-2 py-1 text-right">
                  {totals.capacity === null ? (
                    <span className="font-normal text-foreground-subtle">
                      {t('row.notEntered')}
                    </span>
                  ) : (
                    totals.capacity
                  )}
                </td>
                <td className="py-1 pl-2 text-right">
                  {totals.capacity === null ? (
                    <span className="font-normal text-foreground-subtle">—</span>
                  ) : (
                    totals.capacity - totals.estimated
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Demand parked without a team is excluded from every team row above, so it would
            vanish from a breakdown that only listed teams — and it is exactly the number a
            planner is looking for when the totals do not add up. */}
        {plan.unallocated > 0 && (
          <p className="mt-3 text-ui-sm text-foreground-subtle">
            {t('breakdown.unallocated')}: <span className="tabular-nums">{plan.unallocated}</span>{' '}
            {unitLabel}
          </p>
        )}
      </ModalBody>
    </AppModal>
  )
}
