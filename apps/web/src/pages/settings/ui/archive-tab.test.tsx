import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Settings ▸ Archive, as a Workspace Admin sees it.
 *
 * Five properties, each closing a way the archive could mislead or dead-end:
 *
 *  • an archived Project and an archived Team both appear — the Team half is the actual defect, since
 *    `GET /projects/:id/teams` narrows to active server-side, so `project-teams-tab.tsx`'s own Status
 *    column and Restore action can never show one;
 *  • an ACTIVE row appears in neither list, so the tab is the archive and not a second directory;
 *  • Restore issues the write that reverses the archive, and nothing else;
 *  • Delete asks first — a destructive action reachable from a 14px icon in a dense row;
 *  • a `TEAM_HAS_HISTORY` refusal RENDERS ITS REASON. The message names what still points at the
 *    team, which is the only actionable part of the answer, and a generic "failed to delete" turns a
 *    solvable problem into a dead end.
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: (selector?: (s: unknown) => unknown) => {
    const state = { workspace: { workspaceId: 'ws-1', workspaceName: 'Acme' } }
    return selector ? selector(state) : state
  },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { ArchiveTab } from './archive-tab'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>
const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>
const mockDELETE = apiClient.DELETE as ReturnType<typeof vi.fn>

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    workspaceId: 'ws-1',
    key: 'OLD',
    name: 'Legacy Platform',
    description: null,
    leadId: null,
    leadName: null,
    startDate: null,
    endDate: null,
    status: 'archived',
    memberCount: 3,
    teamCount: 1,
    settings: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tm-1',
    workspaceId: 'ws-1',
    key: 'GAM',
    name: 'Team Gamma',
    description: null,
    leadId: null,
    status: 'archived',
    memberCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  }
}

/** Wire both feeds. `projects` is paged; `teams` is a bare array. */
function feeds({ projects = [], teams = [] }: { projects?: unknown[]; teams?: unknown[] }) {
  mockGET.mockImplementation((path: string) => {
    if (path === '/v1/projects') {
      return Promise.resolve({
        data: {
          data: projects,
          pageInfo: { nextCursor: null, hasNextPage: false, limit: 100 },
        },
        error: undefined,
        response: { status: 200 },
      })
    }
    if (path === '/v1/workspaces/{workspaceId}/teams') {
      return Promise.resolve({ data: teams, error: undefined, response: { status: 200 } })
    }
    return Promise.resolve({ data: [], error: undefined, response: { status: 200 } })
  })
}

function renderTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <ArchiveTab />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPATCH.mockResolvedValue({ data: {}, error: undefined, response: { status: 200 } })
  mockDELETE.mockResolvedValue({ data: undefined, error: undefined, response: { status: 204 } })
})

describe('what the archive lists', () => {
  it('lists an archived project and an archived team, under their own headings', async () => {
    feeds({ projects: [project()], teams: [team()] })
    renderTab()

    expect(await screen.findByText('Legacy Platform')).toBeTruthy()
    expect(screen.getByText('Team Gamma')).toBeTruthy()
    expect(screen.getByText('Archived projects')).toBeTruthy()
    expect(screen.getByText('Archived teams')).toBeTruthy()
  })

  it('leaves an active project and an active team out of both lists', async () => {
    feeds({
      projects: [project(), project({ id: 'p-2', key: 'NXP', name: 'NextGen', status: 'active' })],
      teams: [team(), team({ id: 'tm-2', key: 'ALP', name: 'Team Alpha', status: 'active' })],
    })
    renderTab()

    await screen.findByText('Legacy Platform')
    expect(screen.queryByText('NextGen')).toBeNull()
    expect(screen.queryByText('Team Alpha')).toBeNull()
  })

  /**
   * The archived-team half is only reachable through the DIRECTORY feed. `GET /projects/:id/teams`
   * filters `teams.status = 'active'` in the repository, deliberately, because it also feeds every
   * picker — so this tab must ask for `includeInactive`, and asserting the parameter is what stops a
   * future edit quietly pointing it at the narrowed feed and rendering an empty archive.
   */
  it('asks the workspace directory for inactive teams, not the narrowed per-project feed', async () => {
    feeds({ teams: [team()] })
    renderTab()

    await screen.findByText('Team Gamma')
    expect(mockGET).toHaveBeenCalledWith('/v1/workspaces/{workspaceId}/teams', {
      params: { path: { workspaceId: 'ws-1' }, query: { includeInactive: true } },
    })
  })
})

describe('empty and failed are different answers', () => {
  it('says plainly that nothing is archived, once, rather than two empty tables', async () => {
    feeds({
      projects: [project({ status: 'active' })],
      teams: [team({ status: 'active' })],
    })
    renderTab()

    expect(await screen.findByText('Nothing is archived')).toBeTruthy()
    expect(screen.queryByText('Archived projects')).toBeNull()
    expect(screen.queryByText('Archived teams')).toBeNull()
  })

  it('reports a failed read rather than an empty archive', async () => {
    mockGET.mockResolvedValue({
      data: undefined,
      error: { message: 'boom' },
      response: { status: 500 },
    })
    renderTab()

    expect(await screen.findByText('Could not load the archive')).toBeTruthy()
    expect(screen.queryByText('Nothing is archived')).toBeNull()
  })
})

describe('restoring', () => {
  it('sets a project back to active once confirmed', async () => {
    feeds({ projects: [project()] })
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Restore project Legacy Platform' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore project' }))

    await waitFor(() => expect(mockPATCH).toHaveBeenCalledTimes(1))
    expect(mockPATCH).toHaveBeenCalledWith('/v1/projects/{id}', {
      params: { path: { id: 'p-1' } },
      body: { status: 'active' },
    })
  })

  it('sets a team back to active once confirmed', async () => {
    feeds({ teams: [team()] })
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Restore team Team Gamma' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore team' }))

    await waitFor(() => expect(mockPATCH).toHaveBeenCalledTimes(1))
    expect(mockPATCH).toHaveBeenCalledWith('/v1/teams/{id}', {
      params: { path: { id: 'tm-1' } },
      body: { status: 'active' },
    })
  })

  it('asks before restoring — a restore puts the row back in every picker', async () => {
    feeds({ teams: [team()] })
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Restore team Team Gamma' }))
    expect(mockPATCH).not.toHaveBeenCalled()
  })
})

describe('deleting', () => {
  it('asks before deleting a team, and does not demand typing first', async () => {
    // The SERVER decides whether this delete is allowed, so requiring the name before it has even
    // been asked is friction that buys nothing — and it trains the reflex on the one that goes through.
    feeds({ teams: [team()] })
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete team Team Gamma' }))

    // The card's own footnote says the same thing, hence the anchored match on the prompt itself.
    expect(await screen.findByText(/^Delete Team Gamma\?/)).toBeTruthy()
    expect(screen.queryByText(/to confirm/i)).toBeNull()
    expect(mockDELETE).not.toHaveBeenCalled()
  })

  it('deletes a team by id once confirmed', async () => {
    feeds({ teams: [team()] })
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete team Team Gamma' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete team' }))

    await waitFor(() => expect(mockDELETE).toHaveBeenCalledTimes(1))
    expect(mockDELETE).toHaveBeenCalledWith('/v1/teams/{id}', {
      params: { path: { id: 'tm-1' } },
    })
  })

  it('renders the reason a TEAM_HAS_HISTORY refusal gives, in the dialog', async () => {
    feeds({ teams: [team()] })
    mockDELETE.mockResolvedValue({
      data: undefined,
      error: {
        error: {
          code: 'TEAM_HAS_HISTORY',
          message: 'This team still holds 4 work items, 2 iterations.',
        },
      },
      response: { status: 412 },
    })
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete team Team Gamma' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete team' }))

    // The server's own sentence, not "Failed to delete the team".
    expect(
      await screen.findByText('This team still holds 4 work items, 2 iterations.'),
    ).toBeTruthy()
    expect(screen.queryByText('Failed to delete the team')).toBeNull()
    // Still open, so the reason sits beside the question it answers.
    expect(screen.getByRole('button', { name: 'Delete team' })).toBeTruthy()
  })

  it('requires the project name typed before deleting a project', async () => {
    // Nothing refuses this one, so the client is the last gate — and what goes with the project is
    // every work item, iteration, release and report under it.
    feeds({ projects: [project()] })
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete project Legacy Platform' }))

    const confirm = await screen.findByRole('button', { name: 'Delete project' })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('Legacy Platform'), {
      target: { value: 'Legacy Platform' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))

    await waitFor(() => expect(mockDELETE).toHaveBeenCalledTimes(1))
    expect(mockDELETE).toHaveBeenCalledWith('/v1/projects/{id}', {
      params: { path: { id: 'p-1' } },
    })
  })
})
