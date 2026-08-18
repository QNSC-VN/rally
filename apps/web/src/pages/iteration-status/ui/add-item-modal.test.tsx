/**
 * `Add Item to Iteration` — who may add, when the iteration's Team is not theirs.
 *
 * BA ruling 2026-08-17: "Null means Project Backlog, accessible only to Workspace Admin and Project
 * Admin. Editor must select one of their assigned Teams when creating a Work Item and cannot access
 * team-less items."
 *
 * TWO cases, and only one is a dead end. P2-IS-FR-044/045 make Project, Team and Iteration INHERITED
 * and read-only — which works for a team-scoped sprint and cannot work for a SHARED one, where there is
 * nothing to inherit. Team-less iterations are the COMMON case (195 of 206 local iterations name no
 * team), so leaving that closed would shut an Editor out of most of the product; `CreateIterationItemDto`
 * now carries an optional `teamId` and this form ASKS for it, offering only the Editor's own teams
 * (`GET /projects/:id/teams` returns nothing else).
 *
 * ANOTHER team's iteration stays a dead end whatever is sent, because the item would live in that
 * team's sprint (`TEAM_NOT_IN_SCOPE`, 403) — stated up front rather than submitted into a toast.
 *
 * Both directions are asserted. Requiring the field of everyone would remove the admin's documented
 * ability to file into the Project Backlog.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const createItem = vi.fn()
const projectTeams = vi.fn()
const teamScope = vi.fn()

vi.mock('@/features/iterations/api', () => ({
  useCreateIterationItem: () => ({ mutateAsync: createItem, isPending: false }),
}))
vi.mock('@/features/teams/api', () => ({
  useProjectMemberOptions: () => ({ data: [] }),
  useProjectTeams: () => projectTeams(),
}))
vi.mock('@/features/access/api', () => ({
  useProjectTeamScope: () => teamScope(),
}))
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({
    project: { projectId: 'proj-1', projectKey: 'NXP', projectName: 'NXP' },
  }),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/shared/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { AddItemModal } from './add-item-modal'

const ALPHA = { id: 'team-1', name: 'Team Alpha', key: 'TA', status: 'active' }

const ADMIN = { unrestricted: true, teamRequired: false, isLoading: false }
const EDITOR = { unrestricted: false, teamRequired: true, isLoading: false }

/** A SHARED iteration — no team of its own, which is the ordinary shape in this product. */
const SHARED = {
  id: 'it-1',
  name: 'Sprint 26.1',
  teamId: null as string | null,
  startDate: '2026-08-01',
  endDate: '2026-08-14',
}

function open(iteration = SHARED) {
  render(
    <AddItemModal
      iteration={iteration as never}
      projectId="proj-1"
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  createItem.mockResolvedValue({ itemKey: 'US-9' })
  projectTeams.mockReturnValue({ data: [ALPHA], isLoading: false })
  teamScope.mockReturnValue(ADMIN)
})

describe('AddItemModal — a shared iteration ASKS for a Team (BA ruling 2026-08-17)', () => {
  it('offers an Editor their own teams instead of a dead end', async () => {
    // INVERTED: this used to assert a disabled form and a "Project Backlog" refusal. The contract
    // gained a `teamId`, so the honest answer is to ask rather than to refuse.
    teamScope.mockReturnValue(EDITOR)
    projectTeams.mockReturnValue({
      data: [ALPHA, { ...ALPHA, id: 'team-2', name: 'Team Beta' }],
      isLoading: false,
    })
    open()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create Item' })).toBeEnabled()
    fireEvent.change(screen.getByPlaceholderText(/concise work item title/i), {
      target: { value: 'Into a shared sprint' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    // Two teams, so nothing is prefilled and the requirement is stated on the field.
    await waitFor(() => expect(screen.getByText(/Choose one of your Teams/)).toBeTruthy())
    expect(createItem).not.toHaveBeenCalled()
  })

  it('prefills a single team and sends it', async () => {
    teamScope.mockReturnValue(EDITOR)
    open()
    fireEvent.change(screen.getByPlaceholderText(/concise work item title/i), {
      target: { value: 'Into a shared sprint' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    await waitFor(() =>
      expect(createItem).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-1' })),
    )
  })

  it('sends NO teamId for an admin — the Project Backlog is theirs to use', async () => {
    teamScope.mockReturnValue(ADMIN)
    open()
    fireEvent.change(screen.getByPlaceholderText(/concise work item title/i), {
      target: { value: 'Into the Project Backlog' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    await waitFor(() => expect(createItem).toHaveBeenCalled())
    expect(createItem.mock.calls[0][0].teamId).toBeUndefined()
  })

  it("still refuses ANOTHER team's iteration, which no field can fix", () => {
    teamScope.mockReturnValue(EDITOR)
    open({ ...SHARED, teamId: 'team-99' })

    expect(screen.getByRole('alert').textContent).toMatch(/not assigned to/)
    expect(screen.getByRole('button', { name: 'Create Item' })).toBeDisabled()
  })

  it('lets an ADMIN add to the same shared iteration', async () => {
    teamScope.mockReturnValue(ADMIN)
    open()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText(/concise work item title/i), {
      target: { value: 'Into a shared sprint' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    await waitFor(() => expect(createItem).toHaveBeenCalled())
  })

  it('lets an Editor add to an iteration owned by one of THEIR teams', async () => {
    // `GET /projects/:id/teams` returns only an Editor's own teams, so the iteration's team being
    // present in that feed IS the check — this is a narrowing, not a blanket refusal.
    teamScope.mockReturnValue(EDITOR)
    open({ ...SHARED, teamId: 'team-1' })

    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText(/concise work item title/i), {
      target: { value: 'My own sprint' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    await waitFor(() => expect(createItem).toHaveBeenCalled())
  })

  it('says nothing while the teams feed is still in flight', () => {
    // An empty list mid-fetch is not evidence that the team belongs to someone else — the same
    // absent-versus-empty distinction the reports and the access modal already turn on.
    teamScope.mockReturnValue(EDITOR)
    projectTeams.mockReturnValue({ data: [], isLoading: true })
    open({ ...SHARED, teamId: 'team-1' })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create Item' })).toBeEnabled()
  })

  it('renders `--` for a team the reader cannot resolve, never `No team`', () => {
    // Printing `No team` for an iteration that NAMES one states the opposite of the truth, and it is
    // the difference between "shared sprint" and "another team's sprint".
    teamScope.mockReturnValue(EDITOR)
    projectTeams.mockReturnValue({ data: [ALPHA], isLoading: false })
    open({ ...SHARED, teamId: 'team-99' })

    const team = screen.getByText('Team').closest('div')
    expect(team?.textContent).toContain('--')
    expect(team?.textContent).not.toContain('No team')
  })
})
