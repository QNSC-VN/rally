/**
 * BulkDeleteCopy — the standard bulk actions for every work-item grid:
 * **Delete** + **Copy**, rendered inside the shared `BulkActionBar`
 * (via SelectableTable's `bulkActions` slot).
 *
 * Rules baked in so all grids behave identically:
 *  - **Copy** is a single-item duplicate → disabled once more than one row is
 *    selected. The actual duplicate is grid-specific (work item vs task vs
 *    iteration item), so the caller passes `onCopy`.
 *  - **Delete** is uniform (`useDeleteWorkItem`, which also soft-deletes tasks)
 *    and shows a confirm. It is always available; if the selection includes a
 *    row the backend won't delete (e.g. a defect — `DEFECT_DELETE_FORBIDDEN`),
 *    that row is reported as failed and the rest still delete.
 */
import { useState } from 'react'
import { Trash2, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { BulkBarButton } from '@/shared/ui/bulk-action-bar'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { useDeleteWorkItem } from '@/features/work-items/api'
import type { RowSelection } from '@/shared/lib/hooks/use-row-selection'

export function BulkDeleteCopy({
  selection,
  projectId,
  onCopy,
  copyPending = false,
}: {
  selection: RowSelection
  projectId: string
  /** Duplicate the single selected row (grid-specific). */
  onCopy: () => void | Promise<void>
  copyPending?: boolean
}) {
  const del = useDeleteWorkItem()
  const [confirm, setConfirm] = useState(false)

  const ids = [...selection.selectedIds]

  async function doDelete() {
    setConfirm(false)
    const results = await Promise.allSettled(ids.map((id) => del.mutateAsync({ id, projectId })))
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) toast.error(`${failed} of ${ids.length} could not be deleted`)
    else toast.success(`${ids.length} item${ids.length === 1 ? '' : 's'} deleted`)
    selection.clear()
  }

  return (
    <>
      <BulkBarButton
        icon={<Trash2 size={13} />}
        label="Delete"
        danger
        onClick={() => setConfirm(true)}
        disabled={del.isPending}
      />
      <BulkBarButton
        icon={<Copy size={13} />}
        label="Copy"
        onClick={() => void onCopy()}
        disabled={selection.count > 1 || copyPending}
      />
      <ConfirmDialog
        open={confirm}
        title={`Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`}
        message="This permanently removes the selected item(s)."
        confirmLabel="Delete"
        destructive
        pending={del.isPending}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}
