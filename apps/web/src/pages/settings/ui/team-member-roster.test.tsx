import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The TEAM member view half of the BA's Workspace-Admin team-membership ruling:
 *
 *  - a Workspace Admin on the roster renders the `Workspace Admin` badge, "never as Admin or
 *    Editor". The flag comes from the server (`isWorkspaceAdmin` on
 *    `GET /v1/teams/{id}/members`); an OLD client that has not seen the field renders no badge
 *    rather than a wrong label, which is the third case below;
 *  - the roster can ADD and REMOVE a member on an EXISTING team, which nothing in the SPA could do
 *    before — `useAddTeamMember` / `useRemoveTeamMember` had no caller at all;
 *  - membership is scoped to ACTIVE teams, so a deactivated one offers neither control;
 *  - removing a membership removes ONLY that membership: exactly one `DELETE
 *    /v1/teams/{id}/members/{userId}` and no project-access write, which is what the last test
 *    asserts by checking `POST` was never called.
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { TeamMemberRoster } from './team-member-roster'
import type { Team } from '@/features/teams/api'

// Radix's popover measures its trigger; jsdom has no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>
const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>
const mockDELETE = apiClient.DELETE as ReturnType<typeof vi.fn>

const TEAM: Team = {
  id: 'team-a',
  workspaceId: 'ws-1',
  name: 'Team Alpha',
  key: 'ALPHA',
  description: null,
  leadId: null,
  status: 'active',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

const ROSTER = [
  {
    id: 'tm-1',
    teamId: 'team-a',
    userId: 'u-ed',
    status: 'active',
    joinedAt: '2026-01-01',
    displayName: 'Eddie Editor',
    email: 'eddie@acme.test',
  },
  {
    id: 'tm-2',
    teamId: 'team-a',
    userId: 'u-wa',
    status: 'active',
    joinedAt: '2026-01-02',
    displayName: 'Wanda Admin',
    email: 'wanda@acme.test',
    isWorkspaceAdmin: true,
  },
]

/** One more active workspace user than the roster holds, so Add has a candidate. */
const WS_ROSTER = [
  {
    id: 'wm-1',
    userId: 'u-ed',
    displayName: 'Eddie Editor',
    email: 'eddie@acme.test',
    status: 'active',
    roleSlug: null,
  },
  {
    id: 'wm-2',
    userId: 'u-wa',
    displayName: 'Wanda Admin',
    email: 'wanda@acme.test',
    status: 'active',
    roleSlug: 'workspace_admin',
  },
  {
    id: 'wm-3',
    userId: 'u-wa2',
    displayName: 'Winona Admin',
    email: 'winona@acme.test',
    status: 'active',
    roleSlug: 'workspace_admin',
  },
  // In the workspace, in no project, not an admin — the candidate the BA reported as exposed.
  {
    id: 'wm-4',
    userId: 'u-outsider',
    displayName: 'Owen Outsider',
    email: 'owen@acme.test',
    status: 'active',
    roleSlug: 'project_member',
  },
]

function renderRoster(
  opts: {
    team?: Team
    isWA?: boolean
    roster?: unknown[]
    /** `GET /projects/:id/members` — the candidate scope the BA's report is about. */
    projectMembers?: unknown[]
    wsRoster?: unknown[]
  } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  mockGET.mockImplementation((path: string) => {
    if (path === '/v1/teams/{id}/members') return Promise.resolve({ data: opts.roster ?? ROSTER })
    if (path === '/v1/workspaces/{id}/members-with-profile')
      return Promise.resolve({ data: opts.wsRoster ?? WS_ROSTER })
    if (path === '/v1/projects/{id}/members')
      return Promise.resolve({ data: opts.projectMembers ?? [] })
    return Promise.resolve({ data: [] })
  })
  return render(
    <QueryClientProvider client={qc}>
      <TeamMemberRoster
        team={opts.team ?? TEAM}
        workspaceId="ws-1"
        projectId="proj-1"
        isWA={opts.isWA ?? true}
      />
    </QueryClientProvider>,
  )
}

describe('TeamMemberRoster — the Workspace Admin badge', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPOST.mockReset()
    mockDELETE.mockReset()
    mockPOST.mockResolvedValue({ data: {}, error: undefined })
    mockDELETE.mockResolvedValue({ data: undefined, error: undefined })
  })

  it('badges the Workspace Admin row and nobody else', async () => {
    renderRoster()
    await screen.findByText('Wanda Admin')
    expect(screen.getAllByText('Workspace Admin')).toHaveLength(1)
  })

  it('never labels a Workspace Admin as Admin or Editor', async () => {
    renderRoster()
    await screen.findByText('Wanda Admin')
    // The roster has no access-level column at all — team membership writes no `project_members`
    // row for anyone, so there is no level to print for anyone.
    expect(screen.queryByText('Admin', { exact: true })).toBeNull()
    expect(screen.queryByText('Editor', { exact: true })).toBeNull()
  })

  it('renders NO badge when the server field is absent (a client older than the API)', async () => {
    // Built by DELETING the key rather than by destructuring it away: this repo's `no-unused-vars`
    // exempts `^_` for arguments only, so `{ isWorkspaceAdmin: _drop, ...rest }` is a lint error.
    renderRoster({
      roster: ROSTER.map((m) => {
        const copy: Record<string, unknown> = { ...m }
        delete copy.isWorkspaceAdmin
        return copy
      }),
    })
    await screen.findByText('Wanda Admin')
    expect(screen.queryByText('Workspace Admin')).toBeNull()
  })
})

describe('TeamMemberRoster — add and remove a member of an EXISTING team', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPOST.mockReset()
    mockDELETE.mockReset()
    mockPOST.mockResolvedValue({ data: {}, error: undefined })
    mockDELETE.mockResolvedValue({ data: undefined, error: undefined })
  })

  it('adds a Workspace Admin to the team with ONE write, and no project-access write', async () => {
    // The control is an `Add` BUTTON opening a MODAL now, not an inline popover (BA report
    // 2026-08-21). A Workspace Admin is still a candidate with no `project_members` row of their own:
    // the project-members feed is empty here, so this row can only have come from the admin branch.
    renderRoster()
    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }))
    fireEvent.click(await screen.findByLabelText('Winona Admin'))
    fireEvent.click(screen.getByRole('button', { name: 'Add to team' }))

    await waitFor(() => expect(mockPOST).toHaveBeenCalledTimes(1))
    expect(mockPOST.mock.calls[0][0]).toBe('/v1/teams/{id}/members')
    expect(mockPOST.mock.calls[0][1]).toMatchObject({
      params: { path: { id: 'team-a' } },
      body: { userId: 'u-wa2' },
    })
  })

  /**
   * BA report 2026-08-21: "Users who do not belong to Project Mini-Rally are exposed as Team member
   * candidates." The picker read the WORKSPACE roster, so on a project with no members of its own it
   * still offered every workspace user.
   */
  it('offers project members and Workspace Admins, and nobody else', async () => {
    renderRoster({
      projectMembers: [
        {
          userId: 'u-inproject',
          displayName: 'Pia Project',
          email: 'pia@qnsc.dev',
          status: 'active',
          accessLevel: 'editor',
          teamCount: 1,
        },
      ],
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }))

    // In the project → offered.
    expect(await screen.findByLabelText('Pia Project')).toBeTruthy()
    // A Workspace Admin holds no project row and is offered anyway (2026-08-20 feature).
    expect(screen.getByLabelText('Winona Admin')).toBeTruthy()
    // In the workspace, NOT in the project, not an admin → withheld.
    expect(screen.queryByLabelText('Owen Outsider')).toBeNull()
  })

  it('shows an empty state when the project has no eligible users', async () => {
    // Every project member is already on the roster and there is no other admin to offer.
    renderRoster({ wsRoster: [], projectMembers: [] })
    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }))
    expect(await screen.findByText('No items found')).toBeTruthy()
  })

  it('asks before removing, and removes only that membership', async () => {
    renderRoster()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from team: Wanda Admin' }))
    // The prompt says what does NOT move with it — AC5.
    expect(await screen.findByText(/workspace and project access is untouched/)).toBeTruthy()
    expect(mockDELETE).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(mockDELETE).toHaveBeenCalledTimes(1))
    expect(mockDELETE.mock.calls[0][0]).toBe('/v1/teams/{id}/members/{userId}')
    expect(mockDELETE.mock.calls[0][1]).toMatchObject({
      params: { path: { id: 'team-a', userId: 'u-wa' } },
    })
    // Workspace access is untouched: nothing else was written.
    expect(mockPOST).not.toHaveBeenCalled()
  })

  it('offers neither control on a DEACTIVATED team', async () => {
    renderRoster({ team: { ...TEAM, status: 'archived' } })
    await screen.findByText('Wanda Admin')
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove from team: Wanda Admin' })).toBeNull()
  })

  it('offers neither control to a reader who is not a Workspace Admin', async () => {
    renderRoster({ isWA: false })
    await screen.findByText('Wanda Admin')
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove from team: Wanda Admin' })).toBeNull()
  })
})
