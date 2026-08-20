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
 *    and shows a confirm. Rows the server refuses are reported and the rest still
 *    delete.
 *
 * TWO THINGS THIS GOT WRONG, both reported as "cannot delete work item in Backlog":
 *
 *  - It offered Delete to everyone. The route takes `work_item:delete`, which an
 *    Editor holds and a reader does not, so a caller without it saw the button,
 *    clicked through a destructive confirm and got a failure — the "a grid must not
 *    offer what its own endpoint refuses" rule, one control over.
 *  - It swallowed the REASON. `N of M could not be deleted` is a count, and a refusal
 *    here is explained by the server: a team-less row belongs to the Project Backlog
 *    (`PROJECT_BACKLOG_ADMIN_ONLY`), another team's row is out of an Editor's scope
 *    (`TEAM_NOT_IN_SCOPE`), an archived project is read-only. Those sentences are the
 *    only thing that tells a reader whether to act or to ask.
 *
 * A DEFECT used to be refused here too (Phase 3.4, `DEFECT_DELETE_FORBIDDEN`) and is
 * deletable since the BA's ruling of 2026-08-20 — which is what "cannot delete defect
 * in Backlog and Iteration Status" was.
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
  canDelete = true,
}: {
  selection: RowSelection
  projectId: string
  /** Duplicate the single selected row (grid-specific). */
  onCopy: () => void | Promise<void>
  copyPending?: boolean
  /**
   * `work_item:delete` on this project — the code the route itself requires.
   *
   * Defaults to `true` so a caller that has not thought about it keeps today's behaviour rather than
   * silently losing the control; every grid should pass it.
   */
  canDelete?: boolean
}) {
  const del = useDeleteWorkItem()
  const [confirm, setConfirm] = useState(false)

  const ids = [...selection.selectedIds]

  async function doDelete() {
    setConfirm(false)
    const results = await Promise.allSettled(ids.map((id) => del.mutateAsync({ id, projectId })))
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

    if (rejected.length === 0) {
      toast.success(`${ids.length} item${ids.length === 1 ? '' : 's'} deleted`)
    } else {
      // The server's own sentence, not a count. `useDeleteWorkItem` throws with `apiErrorMessage`, so
      // the refusal already explains itself — a defect is resolved rather than deleted, a team-less
      // row is the Project Backlog. Distinct reasons only: fifteen defects are one rule, not fifteen.
      const reasons = [
        ...new Set(
          rejected.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason))),
        ),
      ]
      const scope =
        rejected.length === ids.length
          ? ids.length === 1
            ? 'Not deleted'
            : `None of ${ids.length} deleted`
          : `${rejected.length} of ${ids.length} not deleted`
      toast.error(`${scope}: ${reasons.join(' ')}`)
    }
    selection.clear()
  }

  return (
    <>
      {canDelete && (
        <BulkBarButton
          icon={<Trash2 size={13} />}
          label="Delete"
          danger
          onClick={() => setConfirm(true)}
          disabled={del.isPending}
        />
      )}
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
