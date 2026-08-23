import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'

import { ActionMenu, ActionMenuItem } from '@/shared/ui/action-menu'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { notify } from '@/shared/lib/toast'
import { useDeleteWorkItem } from '@/features/work-items/api'

/**
 * The per-ROW actions on a work-item grid — today, Delete.
 *
 * `P2-BL-FR-022` and §124 of the same SRS put this here: "Delete Defect | Row or detail action with
 * confirmation" — the ROW being the half that was missing. The verb was reachable two ways before and neither was that row: the bulk bar, which
 * only appears once rows are selected, and (since the detail page grew one) the record itself. So the
 * BA's report — "cannot delete work item in Backlog" — was true of the grid even though the server had
 * allowed the delete all along.
 *
 * Shared rather than written into the page: the same row action belongs on Quality and Iteration
 * Status when the BA rules on those grids, and a second copy is how two grids come to confirm
 * differently. It also keeps `backlog-page.tsx` under the file-length ratchet.
 *
 * The confirmation is NAMED, not typed: the delete is SOFT (`P3-QA-FR-020` retains the child Tasks,
 * attachments, comments and relations), so the record is recoverable and the typed gate is reserved
 * for the irreversible.
 */
export function WorkItemRowActions({
  itemId,
  itemKey,
  projectId,
  canDelete,
  onDeleted,
}: {
  itemId: string
  itemKey: string
  projectId: string
  /** `work_item:delete` on this project. The menu renders NOTHING without it — an action that only
   *  refuses is noise, and the row already has no other verb. */
  canDelete: boolean
  onDeleted?: () => void
}) {
  const { t } = useTranslation('work-items')
  const del = useDeleteWorkItem()
  const [confirm, setConfirm] = useState(false)

  if (!canDelete) return null

  return (
    <>
      <ActionMenu ariaLabel={t('rowActions.label', { key: itemKey })}>
        <ActionMenuItem
          icon={<Trash2 size={13} />}
          label={t('delete.action')}
          destructive
          onClick={() => setConfirm(true)}
        />
      </ActionMenu>
      <ConfirmDialog
        open={confirm}
        destructive
        title={t('delete.title')}
        message={t('delete.message', { key: itemKey })}
        confirmLabel={t('delete.action')}
        pending={del.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          void del
            .mutateAsync({ id: itemId, projectId })
            .then(() => {
              setConfirm(false)
              notify.success(t('delete.deleted', { key: itemKey }))
              onDeleted?.()
            })
            .catch((e: unknown) => {
              // The server's own sentence: a refusal here explains itself (another team's row, an
              // archived project), and a generic failure toast would hide which.
              setConfirm(false)
              notify.error(e instanceof Error ? e.message : t('delete.failed'))
            })
        }}
      />
    </>
  )
}
