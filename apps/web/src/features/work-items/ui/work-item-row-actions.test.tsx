/**
 * The per-ROW Delete on a work-item grid — `P2-BL-FR-022` and §124 ("Delete Defect | Row or detail
 * action with confirmation").
 *
 * The verb existed before this control, twice: the bulk bar — which only appears once rows are
 * SELECTED — and the record's own detail page. Neither is the row, which is why the BA's report
 * ("cannot delete work item in Backlog") was true of the grid while
 * `test/e2e/work-item-delete-route.e2e.spec.ts` proved the route deletes fine.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { del, notifySuccess, notifyError } = vi.hoisted(() => ({
  del: vi.fn(),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}))

vi.mock('@/shared/lib/toast', () => ({
  notify: { success: notifySuccess, error: notifyError },
}))
vi.mock('@/features/work-items/api', () => ({
  useDeleteWorkItem: () => ({ mutateAsync: del, isPending: false }),
}))

import '@/shared/i18n/i18n'
import { WorkItemRowActions } from './work-item-row-actions'

const renderActions = (canDelete = true) =>
  render(<WorkItemRowActions itemId="wi-1" itemKey="DE-10" projectId="p-1" canDelete={canDelete} />)

/** Open the row menu and click Delete, leaving the confirmation on screen. */
async function openDeleteConfirm() {
  fireEvent.click(screen.getByRole('button', { name: /Actions for DE-10/i }))
  fireEvent.click(await screen.findByText('Delete'))
}

describe('WorkItemRowActions', () => {
  beforeEach(() => {
    del.mockReset()
    del.mockResolvedValue(undefined)
    notifySuccess.mockReset()
    notifyError.mockReset()
  })

  it('renders NOTHING without `work_item:delete`', () => {
    // Absent, not disabled: the menu holds one verb, so without it there is no menu to open — and a
    // control whose only item refuses is noise.
    const { container } = renderActions(false)
    expect(container).toBeEmptyDOMElement()
  })

  it('deletes only after the confirmation is accepted', async () => {
    renderActions()
    await openDeleteConfirm()

    // Still nothing sent — the dialog is the gate (§371: "Canceling Delete makes no change").
    expect(del).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith({ id: 'wi-1', projectId: 'p-1' }))
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled())
  })

  it('sends nothing when the confirmation is cancelled', async () => {
    renderActions()
    await openDeleteConfirm()

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(del).not.toHaveBeenCalled()
  })

  it("reports the SERVER's own sentence when the delete is refused", async () => {
    // A refusal here explains itself — another team's row, an archived project. A generic "delete
    // failed" would hide which, and whether the reader should act or ask.
    del.mockRejectedValue(new Error('PROJECT_BACKLOG_ADMIN_ONLY'))
    renderActions()
    await openDeleteConfirm()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('PROJECT_BACKLOG_ADMIN_ONLY'))
  })
})
