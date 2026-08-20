/**
 * An archived Project in `Settings > Archive`. Binds the two writes; {@link ArchiveRow} owns the
 * chrome and both confirmations.
 *
 * Delete is a `DELETE /v1/projects/{id}` soft delete, and offering it here is a **declared
 * divergence** from `P0-PRJ-008` ("an archived project offers Restore ONLY"), taken deliberately by
 * the product owner: without it, archiving is a one-way door and a project created by mistake can
 * never leave the workspace. It carries a TYPED confirmation because unlike a team delete the server
 * does not refuse it — the client is the last gate, and what goes with the project is every work
 * item, iteration, release and report under it.
 */
import { useTranslation } from 'react-i18next'

import { useDeleteProject, useUpdateProject, type Project } from '@/features/projects/api'
import { notify } from '@/shared/lib/toast'
import { formatDate } from '@/shared/lib/utils'
import { ArchiveRow, type RowMutation } from './archive-row'

export function ArchivedProjectRow({ project }: { project: Project }) {
  const { t } = useTranslation('settings')
  const update = useUpdateProject()
  const remove = useDeleteProject()

  const restore: RowMutation = {
    isPending: update.isPending,
    run: ({ onSuccess, onError }) =>
      update.mutate(
        { id: project.id, input: { status: 'active' } },
        {
          onSuccess: () => {
            notify.success(t('archive.project.restored', { name: project.name }))
            onSuccess()
          },
          onError,
        },
      ),
  }

  const destroy: RowMutation = {
    isPending: remove.isPending,
    run: ({ onSuccess, onError }) =>
      remove.mutate(project.id, {
        onSuccess: () => {
          notify.success(t('archive.project.deleted', { name: project.name }))
          onSuccess()
        },
        onError,
      }),
  }

  return (
    <ArchiveRow
      kind="project"
      itemKey={project.key}
      name={project.name}
      typedDelete
      restore={restore}
      remove={destroy}
      meta={
        <>
          <td className="px-3 py-2 text-right text-ui-md text-foreground-subtle">
            {project.memberCount}
          </td>
          <td className="px-3 py-2 text-ui-md text-foreground-subtle">
            {formatDate(project.updatedAt)}
          </td>
        </>
      }
    />
  )
}
