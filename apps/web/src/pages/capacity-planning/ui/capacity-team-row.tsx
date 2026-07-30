import { type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'

import {
  useRemoveCapacityTeam,
  useSetCapacity,
  type CapacityPlanTeam,
} from '@/features/capacity-planning/api'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { IconButton } from '@/shared/ui/icon-button'
import { notify } from '@/shared/lib/toast'
import { type TeamColKey } from '../model/columns'

/**
 * One team row inside a capacity plan.
 *
 * The capacity cell edits in place and distinguishes THREE states, which is the whole
 * point of the column:
 *   • blank    — no capacity entered yet (`null`); no warning rule may treat it as a real
 *                ceiling, so it must not render as 0
 *   • 0        — an entered ceiling of zero, i.e. this team is deliberately unavailable
 *   • a number — the ceiling in the plan's unit
 *
 * Clearing the field sends `null` rather than 0, so a planner can undo a value instead of
 * being forced to assert one.
 */
export function CapacityTeamRow({
  planId,
  team,
  unitLabel,
  canManage,
  colStyleFor,
  gutter,
}: {
  planId: string
  team: CapacityPlanTeam
  /** "points" / "items" — the plan's fixed unit, shown beside the number. */
  unitLabel: string
  canManage: boolean
  colStyleFor: (key: TeamColKey, base?: CSSProperties) => CSSProperties
  gutter: ReactNode
}) {
  const { t } = useTranslation('capacity')
  const setCapacity = useSetCapacity()
  const removeTeam = useRemoveCapacityTeam()

  function commitCapacity(raw: string) {
    const trimmed = raw.trim()
    // Empty input CLEARS the capacity. `null` and 0 are different states and the API keeps
    // them apart, so the UI must not collapse a cleared field into a zero.
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      notify.error(t('row.capacityInvalid'))
      return
    }
    const current = team.capacity
    if (next === current) return

    setCapacity.mutate(
      { id: planId, teamId: team.teamId, capacity: next },
      {
        onSuccess: () => notify.success(t('row.capacityUpdated')),
        onError: (err) => notify.error(err.message),
      },
    )
  }

  function remove() {
    removeTeam.mutate(
      { id: planId, teamId: team.teamId },
      {
        onSuccess: () => notify.success(t('row.teamRemoved')),
        // Surfaces the API's refusal when the team still holds allocations, rather than
        // silently doing nothing.
        onError: (err) => notify.error(err.message),
      },
    )
  }

  return (
    <div className="group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter">
      {gutter}

      <div style={colStyleFor('team', { flexShrink: 0 })} className="min-w-0 px-2">
        <span className="truncate text-foreground" title={team.teamName ?? undefined}>
          {team.teamName ?? '—'}
        </span>
      </div>

      <div
        style={colStyleFor('capacity', { flexShrink: 0 })}
        className="min-w-0 px-0"
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          fullCell
          value={team.capacity === null ? '' : String(team.capacity)}
          canEdit={canManage}
          onCommit={commitCapacity}
          ariaLabel={t('row.capacityLabel', { team: team.teamName ?? '' })}
          // Blank, not "0" — an unentered capacity is not a ceiling of zero.
          displayValue={
            team.capacity === null ? (
              <span className="text-foreground-subtle">{t('row.notEntered')}</span>
            ) : (
              <span className="tabular-nums">
                {team.capacity} <span className="text-foreground-subtle">{unitLabel}</span>
              </span>
            )
          }
          className="block w-full text-right"
          inputClassName="w-full rounded border border-primary bg-transparent px-1 py-0.5 text-right text-ui-sm text-foreground focus:outline-none"
        />
      </div>

      <div
        style={colStyleFor('actions', { flexShrink: 0 })}
        className="flex items-center justify-center px-2"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage && (
          <IconButton
            aria-label={t('row.removeTeam', { team: team.teamName ?? '' })}
            onClick={remove}
            disabled={removeTeam.isPending}
          >
            <Trash2 size={13} />
          </IconButton>
        )}
      </div>
    </div>
  )
}
