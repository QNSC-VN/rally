/**
 * `Log Defect` — a Defect is a Work Item, so the Team rule reaches this form too.
 *
 * BA ruling 2026-08-17: "Editor must select one of their assigned Teams when creating a Work Item and
 * cannot access team-less items." This modal posts to `POST /v1/work-items` and had NO Team field at
 * all, which made it an admin-only create by accident: an Editor got `WORK_ITEM_TEAM_REQUIRED` (412)
 * every time, on a surface §5 gives them on purpose (`quality:view` is a `PROJECT_MEMBER` code
 * precisely so Quality is theirs).
 *
 * The field is therefore conditional on the CALLER, not present-and-optional: an admin's form keeps
 * its documented shape, where an absent Team means the Project Backlog.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const createDefect = vi.fn()
const projectTeams = vi.fn()
const teamScope = vi.fn()

vi.mock('@/features/quality/api', () => ({
  useCreateDefect: () => ({ mutateAsync: createDefect, isPending: false }),
}))
vi.mock('@/features/teams/api', () => ({
  useProjectMemberOptions: () => ({ data: [] }),
  useProjectTeams: () => projectTeams(),
}))
vi.mock('@/features/access/api', () => ({
  useProjectTeamScope: () => teamScope(),
}))
vi.mock('@/features/releases/api', () => ({ useReleases: () => ({ data: [] }) }))
vi.mock('@/features/iterations/api', () => ({ useIterationOptions: () => ({ data: [] }) }))
vi.mock('@/features/work-items/api', () => ({
  useBacklog: () => ({ data: { data: [] } }),
  useUpdateWorkItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/shared/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }))

import '@/shared/i18n/i18n'
import { LogDefectModal } from './quality-parts'

const ALPHA = { id: 'team-1', name: 'Team Alpha', key: 'TA' }
const BETA = { id: 'team-2', name: 'Team Beta', key: 'TB' }

const ADMIN = { unrestricted: true, teamRequired: false, isLoading: false }
const EDITOR = { unrestricted: false, teamRequired: true, isLoading: false }

/** The submit button's label is the modal's own title key (`logDefect` → `Add New`). */
const submitLabel = 'Add New'

function open() {
  render(<LogDefectModal projectId="proj-1" onClose={vi.fn()} />)
}

function fillTitle(value = 'Checkout throws on empty cart') {
  fireEvent.change(screen.getByPlaceholderText(/Brief description/i), { target: { value } })
}

beforeEach(() => {
  vi.clearAllMocks()
  createDefect.mockResolvedValue({ id: 'wi-9', itemKey: 'DE-9' })
  projectTeams.mockReturnValue({ data: [ALPHA, BETA] })
  teamScope.mockReturnValue(ADMIN)
})

describe('LogDefectModal — Team (BA ruling 2026-08-17)', () => {
  it('asks an Editor for a Team, with no empty option', () => {
    teamScope.mockReturnValue(EDITOR)
    open()

    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    expect(screen.getByText('Team Alpha')).toBeInTheDocument()
    expect(screen.queryByText('No team')).toBeNull()
  })

  it('refuses to submit without one, and says so on the field', async () => {
    teamScope.mockReturnValue(EDITOR)
    open()
    fillTitle()
    fireEvent.click(screen.getByRole('button', { name: submitLabel }))

    expect(await screen.findByText(/Select one of your Teams/)).toBeInTheDocument()
    expect(createDefect).not.toHaveBeenCalled()
  })

  it('sends the chosen Team', async () => {
    teamScope.mockReturnValue(EDITOR)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    fireEvent.click(await screen.findByText('Team Beta'))
    fillTitle()
    fireEvent.click(screen.getByRole('button', { name: submitLabel }))

    await waitFor(() => expect(createDefect).toHaveBeenCalled())
    expect(createDefect.mock.calls[0][0].teamId).toBe('team-2')
  })

  it("prefills an Editor's ONE team", async () => {
    teamScope.mockReturnValue(EDITOR)
    projectTeams.mockReturnValue({ data: [ALPHA] })
    open()
    fillTitle()
    fireEvent.click(screen.getByRole('button', { name: submitLabel }))

    await waitFor(() => expect(createDefect).toHaveBeenCalled())
    expect(createDefect.mock.calls[0][0].teamId).toBe('team-1')
  })

  it('shows an admin NO Team field, and files with no team', async () => {
    teamScope.mockReturnValue(ADMIN)
    open()
    // The form an admin has always had: Team is not among its fields, and absent means Project
    // Backlog. Asserted so a later "just always show it" does not quietly change their flow.
    expect(screen.queryByRole('button', { name: 'Team' })).toBeNull()

    fillTitle()
    fireEvent.click(screen.getByRole('button', { name: submitLabel }))

    await waitFor(() => expect(createDefect).toHaveBeenCalled())
    expect(createDefect.mock.calls[0][0].teamId).toBeUndefined()
  })
})
