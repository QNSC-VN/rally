/**
 * The bulk Delete control, and the two ways it made a working rule look like a broken button.
 *
 * Reported as "cannot delete work item in Backlog". The route is fine — `test/e2e/work-item-delete-route.e2e.spec.ts`
 * deletes a story, a task and a story-with-children over HTTP — so what was wrong was on this side:
 *
 *  1. Delete was offered to every caller, although `DELETE /work-items/:id` takes `work_item:delete`.
 *  2. A refusal was reported as a COUNT, although the server explains itself — a team-less row is the
 *     Project Backlog, another team's row is outside an Editor's scope. That sentence is the only
 *     thing that tells a reader whether to act or to ask.
 *
 * A defect was refused here too until the BA's ruling of 2026-08-20 (§3.2:81 over Phase 3.4); the
 * reasons below are the ones that remain.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// `vi.hoisted`, because `vi.mock` factories are lifted above ordinary top-level consts.
const { del, toastError, toastSuccess } = vi.hoisted(() => ({
  del: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))
vi.mock('@/features/work-items/api', () => ({
  useDeleteWorkItem: () => ({ mutateAsync: del, isPending: false }),
}))

import { BulkDeleteCopy } from './bulk-delete-copy'
import type { RowSelection } from '@/shared/lib/hooks/use-row-selection'

const selectionOf = (...ids: string[]): RowSelection =>
  ({
    selectedIds: new Set(ids),
    count: ids.length,
    clear: vi.fn(),
    toggle: vi.fn(),
    isSelected: () => false,
    toggleAll: vi.fn(),
    allSelected: false,
  }) as unknown as RowSelection

function renderBar(props: Partial<Parameters<typeof BulkDeleteCopy>[0]> = {}) {
  return render(
    <BulkDeleteCopy
      selection={selectionOf('wi-1')}
      projectId="proj-1"
      onCopy={vi.fn()}
      {...props}
    />,
  )
}

const clickDelete = () => {
  fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
  // The confirm's own Delete is the last one rendered.
  const buttons = screen.getAllByRole('button', { name: /^Delete$/ })
  fireEvent.click(buttons[buttons.length - 1])
}

beforeEach(() => {
  vi.clearAllMocks()
  del.mockResolvedValue('proj-1')
})

describe('who is offered Delete', () => {
  it('offers it to a caller who holds work_item:delete', () => {
    renderBar({ canDelete: true })
    expect(screen.getByRole('button', { name: /Delete/ })).toBeTruthy()
  })

  it('withholds it from a caller who does not', () => {
    // The route requires the code; a destructive confirm that ends in a refusal is worse than an
    // absent control.
    renderBar({ canDelete: false })
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
    // Copy is a different action and stays.
    expect(screen.getByRole('button', { name: /Copy/ })).toBeTruthy()
  })
})

describe('what a refusal says', () => {
  it("reports the SERVER's reason, not a count", async () => {
    del.mockRejectedValue(
      new Error(
        'Items with no Team belong to the Project Backlog, which only a Workspace Admin or Project Admin can open',
      ),
    )
    renderBar()

    clickDelete()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toContain('Project Backlog')
  })

  it('collapses one rule reported many times into one sentence', async () => {
    // Fifteen rows refused by one rule are one problem, not fifteen.
    del.mockRejectedValue(new Error('This record belongs to a Team you are not assigned to'))
    renderBar({ selection: selectionOf('a', 'b', 'c') })

    clickDelete()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    const message = toastError.mock.calls[0][0] as string
    expect(message).toContain('None of 3 deleted')
    expect(message.match(/belongs to a Team you are not assigned to/g)).toHaveLength(1)
  })

  it('says how many survived when only some were refused', async () => {
    del.mockResolvedValueOnce('proj-1').mockRejectedValueOnce(new Error('Project Backlog'))
    renderBar({ selection: selectionOf('a', 'b') })

    clickDelete()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toContain('1 of 2 not deleted')
  })

  it('still reports success plainly when nothing was refused', async () => {
    renderBar({ selection: selectionOf('a', 'b') })

    clickDelete()

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('2 items deleted'))
    expect(toastError).not.toHaveBeenCalled()
  })
})
