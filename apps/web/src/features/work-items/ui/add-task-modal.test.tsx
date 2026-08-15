/**
 * A task created "without an owner" must actually BE without an owner.
 *
 * P6-TC-007 reported a "null-owner Task attributed to a named member" and GAP-P3-TS-008 an
 * outside-team member group on Team Status. Neither is a projection defect — `rollUpTeamCapacity`
 * keys `ownerId ?? 'Unassigned'` correctly — the upstream cause is that Owner was seeded from the
 * authenticated CREATOR here, so there was never a null owner to key. GAP-P1-WID-007 states the rule
 * directly: "Work Item and Task Owner default to Unassigned."
 *
 * Also pinned here (P6-E2E-003): the owner feed is the PARENT's project and team, not the app shell's
 * selected project. `vi.mock` with a factory replaces the whole module, so a drift back onto
 * `useAppContext` / `useProjectMemberOptions` is a hard import failure rather than a wider list.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

const createTask = vi.fn()
const teamOwnerOptions = vi.fn()
const workItem = vi.fn()

vi.mock('@/features/work-items/api', () => ({
  useCreateTask: () => ({ mutateAsync: createTask }),
  useWorkItem: (...args: unknown[]) => workItem(...args),
}))
vi.mock('@/features/teams/api', () => ({
  useTeamOwnerOptions: (...args: unknown[]) => teamOwnerOptions(...args),
}))

import '@/shared/i18n/i18n'
import { AddTaskModal } from './add-task-modal'

beforeEach(() => {
  vi.clearAllMocks()
  createTask.mockResolvedValue({ itemKey: 'TA-1' })
  workItem.mockReturnValue({
    data: { id: 'wi-1', projectId: 'proj-parent', teamId: 'team-1' },
  })
  teamOwnerOptions.mockReturnValue({
    data: [{ userId: 'alice', displayName: 'Alice Smith', email: 'alice@qnsc.dev' }],
  })
})

function open() {
  render(<AddTaskModal workItemId="wi-1" onClose={vi.fn()} />)
}

describe('AddTaskModal — Owner defaults to Unassigned', () => {
  it('shows the empty owner entry, not the signed-in user', () => {
    open()
    // `ownerSelectOptions` renders the unset value as `— No Entry —` (its Quick Picks row), which is
    // what the trigger label resolves to — not `OwnerSelectField`'s `Unassigned` placeholder, since
    // an option DOES match the empty value. Either way: nobody's name.
    expect(screen.getByRole('button', { name: 'Owner' }).textContent).toContain('— No Entry —')
    expect(screen.getByRole('button', { name: 'Owner' }).textContent).not.toContain('Alice')
  })

  it('sends NO assigneeId when the field is left alone', async () => {
    open()
    fireEvent.change(screen.getByPlaceholderText('Enter task name'), {
      target: { value: 'DEV - wire SSO' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }))

    await waitFor(() => expect(createTask).toHaveBeenCalled())
    // `undefined`, so the server sees an absent field. Note the API still inherits the PARENT's
    // assignee (`WorkItemsService.createTask`: `opts.assigneeId ?? parent.assigneeId`) — that half is
    // a separate ruling and is reported, not changed here.
    expect(createTask.mock.calls[0][0].assigneeId).toBeUndefined()
  })

  it('reads its owner feed from the PARENT project and team, not the selected project', () => {
    open()
    expect(workItem).toHaveBeenCalledWith('wi-1')
    expect(teamOwnerOptions).toHaveBeenCalledWith('proj-parent', 'team-1')
  })

  it('offers only Unassigned when the parent carries no Team', () => {
    workItem.mockReturnValue({ data: { id: 'wi-1', projectId: 'proj-parent', teamId: null } })
    // The hook is disabled without a team, so `data` is undefined — GAP-P1-WID-007's "No Team offers
    // only Unassigned" is enforced by the feed rather than by this modal.
    teamOwnerOptions.mockReturnValue({ data: undefined })
    open()

    fireEvent.click(screen.getByRole('button', { name: 'Owner' }))
    // Asserted over the whole tree rather than inside the popover, because the modal is itself a
    // `dialog`: her name must appear NOWHERE, which is the stronger claim anyway.
    expect(screen.queryByText('Alice Smith')).toBeNull()
  })
})
