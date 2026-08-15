/**
 * Owner on Create Story/Defect: defaults to Unassigned, and is scoped to the TEAM chosen in the form.
 *
 * GAP-P1-WID-007 / P6-TC-007: "Work Item and Task Owner default to Unassigned. Selected Team offers
 * Unassigned plus its ACTIVE MEMBERS; No Team offers only Unassigned." The creator-seeded default here
 * is the upstream cause of P6-TC-007's "null-owner Task attributed to a named member": a Task inherits
 * its parent's assignee, so a Story silently owned by whoever opened this modal produced Tasks nobody
 * had assigned.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const createWorkItem = vi.fn()
const teamOwnerOptions = vi.fn()

vi.mock('@/features/work-items/api', () => ({
  useCreateWorkItem: () => ({ mutateAsync: createWorkItem }),
  useBacklog: () => ({ data: undefined }),
}))
vi.mock('@/features/teams/api', () => ({
  useProjectTeams: () => ({
    data: [
      { id: 'team-1', name: 'Team Alpha', key: 'TA' },
      { id: 'team-2', name: 'Team Beta', key: 'TB' },
    ],
  }),
  useTeamOwnerOptions: (...args: unknown[]) => teamOwnerOptions(...args),
}))
vi.mock('@/features/projects/api', () => ({
  useProjects: () => ({ data: [{ id: 'proj-1', key: 'NXP', name: 'NextGen Platform' }] }),
}))
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({ workspace: { workspaceId: 'ws-1' }, team: { teamId: 'team-1' } }),
}))

import '@/shared/i18n/i18n'
import { CreateWorkItemModal } from './create-work-item-modal'

const ALICE = { userId: 'alice', displayName: 'Alice Smith', email: 'alice@qnsc.dev' }

beforeEach(() => {
  vi.clearAllMocks()
  createWorkItem.mockResolvedValue({ id: 'wi-1', itemKey: 'US-1' })
  teamOwnerOptions.mockReturnValue({ data: [ALICE] })
})

function open() {
  render(
    <CreateWorkItemModal
      projectId="proj-1"
      onClose={vi.fn()}
      onCreated={vi.fn()}
      onCreatedWithDetails={vi.fn()}
    />,
  )
}

describe('CreateWorkItemModal — Owner defaults to Unassigned', () => {
  it('does not seed the signed-in creator', () => {
    open()
    expect(screen.getByRole('button', { name: 'Owner' }).textContent).toContain('— No Entry —')
    expect(screen.getByRole('button', { name: 'Owner' }).textContent).not.toContain('Alice')
  })

  it('sends NO assigneeId when the field is left alone', async () => {
    open()
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Wire the callback' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    await waitFor(() => expect(createWorkItem).toHaveBeenCalled())
    expect(createWorkItem.mock.calls[0][0].assigneeId).toBeUndefined()
  })
})

describe('CreateWorkItemModal — Owner options follow the selected Team (GAP-P1-WID-007)', () => {
  it('asks for the roster of the team the form has chosen', () => {
    open()
    // The inherited context team, validated against the project's own team list — the same value the
    // create itself sends, so the feed cannot 422 on a team the create would drop.
    expect(teamOwnerOptions).toHaveBeenCalledWith('proj-1', 'team-1')
  })

  it('clears a stale owner when the Team changes', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Owner' }))
    fireEvent.click(await screen.findByText('Alice Smith'))
    expect(screen.getByRole('button', { name: 'Owner' }).textContent).toContain('Alice Smith')

    // Switching team re-populates the Owner list; a selection made against the previous team is no
    // longer offered, and a draft must not submit a value its own picker would not show.
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    fireEvent.click(await screen.findByText('Team Beta'))

    expect(screen.getByRole('button', { name: 'Owner' }).textContent).toContain('— No Entry —')
    expect(teamOwnerOptions).toHaveBeenLastCalledWith('proj-1', 'team-2')
  })

  it('asks for nothing at all with No Team selected', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    fireEvent.click(screen.getByText('No team'))

    // `null`, not `''` — `useTeamOwnerOptions` is disabled and returns no rows, which IS the rule.
    expect(teamOwnerOptions).toHaveBeenLastCalledWith('proj-1', null)
  })
})
