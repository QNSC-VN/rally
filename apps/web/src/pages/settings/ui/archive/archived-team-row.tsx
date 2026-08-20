/**
 * An archived Team in `Settings > Archive`. Binds the two writes; {@link ArchiveRow} owns the chrome
 * and both confirmations.
 *
 * Delete is `DELETE /v1/teams/{id}`, and it is the SERVER's decision: an archived team may only be
 * deleted while it holds no delivery history, because DB design §488 ("Archive Team does not delete
 * the linked Work Item/Sprint history") means the alternative to refusing is discarding frozen
 * Burndown rows and capacity allocations. So the confirmation here is target-NAMED rather than typed —
 * see {@link ArchiveRow} — and the refusal's own message, which names what still points at the team
 * and how much of it there is, is what the reader acts on.
 */
import { useTranslation } from 'react-i18next'

import { useDeleteTeam, useUpdateTeam, type Team } from '@/features/teams/api'
import { notify } from '@/shared/lib/toast'
import { formatDate } from '@/shared/lib/utils'
import { ArchiveRow, type RowMutation } from './archive-row'

export function ArchivedTeamRow({ team }: { team: Team }) {
  const { t } = useTranslation('settings')
  // Per-row instance, because `useUpdateTeam` binds its id at construction (it seeds
  // `teamKeys.detail(id)` on success). Same shape as `project-teams-tab.tsx`'s RestoreButton.
  const update = useUpdateTeam(team.id)
  const remove = useDeleteTeam()

  const restore: RowMutation = {
    isPending: update.isPending,
    run: ({ onSuccess, onError }) =>
      update.mutate(
        { status: 'active' },
        {
          onSuccess: () => {
            notify.success(t('archive.team.restored', { name: team.name }))
            onSuccess()
          },
          onError,
        },
      ),
  }

  const destroy: RowMutation = {
    isPending: remove.isPending,
    run: ({ onSuccess, onError }) =>
      remove.mutate(team.id, {
        onSuccess: () => {
          notify.success(t('archive.team.deleted', { name: team.name }))
          onSuccess()
        },
        onError,
      }),
  }

  return (
    <ArchiveRow
      kind="team"
      itemKey={team.key}
      name={team.name}
      typedDelete={false}
      restore={restore}
      remove={destroy}
      meta={
        <>
          <td className="px-3 py-2 text-right text-ui-md text-foreground-subtle">
            {team.memberCount ?? 0}
          </td>
          <td className="px-3 py-2 text-ui-md text-foreground-subtle">
            {formatDate(team.updatedAt)}
          </td>
        </>
      }
    />
  )
}
