import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * GAP-P4-SET-004 — destructive confirmations on the project Teams tab.
 *
 * Two separate defects, and they fail in opposite directions:
 *   • RESTORE had NO confirmation at all — `updateTeam.mutate({ status: 'active' })` fired straight
 *     from the icon's `onClick`, so one stray click on a 13px glyph put a disbanded team back into
 *     every picker and assignment surface.
 *   • DEACTIVATE named the team but committed on one click; it now needs the name typed.
 *
 * What is asserted is that the typed gate BLOCKS THE WRITE, not merely that a dialog appeared: a
 * confirmation that opens and then commits on any click is the defect with extra steps. The
 * PATCH-not-called assertions are the point of each test.
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: (selector: (s: unknown) => unknown) =>
    selector({ workspace: { workspaceId: 'ws-1' } }),
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { ProjectTeamsTab } from './project-teams-tab'

// Radix's popover measures its trigger; jsdom has no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>
const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>

/** `GET /projects/:id/teams` returns project_team LINK rows — `.teamId` is the real team id. */
const LINKS = [
  {
    id: 'link-a',
    teamId: 'team-a',
    key: 'ALPHA',
    name: 'Team Alpha',
    status: 'active',
    leadId: null,
    memberCount: 3,
  },
  {
    id: 'link-b',
    teamId: 'team-b',
    key: 'BETA',
    name: 'Team Beta',
    status: 'archived',
    leadId: null,
    memberCount: 1,
  },
]

function renderTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ProjectTeamsTab projectId="p-1" isWA onOpenTeam={vi.fn()} />
    </QueryClientProvider>,
  )
}

/** The typed-confirmation input, addressed by the placeholder `ConfirmDialog` gives it. */
function typeConfirmation(expected: string, value: string) {
  fireEvent.change(screen.getByPlaceholderText(expected), { target: { value } })
}

describe('ProjectTeamsTab — deactivate needs the team name TYPED', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPATCH.mockReset()
    mockPATCH.mockResolvedValue({ data: LINKS[0], error: undefined })
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects/{id}/teams') return Promise.resolve({ data: LINKS })
      return Promise.resolve({ data: [] })
    })
  })

  async function openDeactivate() {
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate team' }))
    return screen.findByText(/Deactivate Team Alpha\?/)
  }

  it('keeps Deactivate disabled until the name matches EXACTLY, and writes nothing before that', async () => {
    renderTab()
    await openDeactivate()
    const confirm = screen.getByRole('button', { name: 'Deactivate' })
    expect(confirm).toBeDisabled()

    // A near miss is still a miss — the match is case-sensitive.
    typeConfirmation('Team Alpha', 'team alpha')
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled()

    // And a click while disabled must not slip a write through.
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    expect(mockPATCH).not.toHaveBeenCalled()
  })

  it('writes the archive only once the exact name is typed', async () => {
    renderTab()
    await openDeactivate()
    typeConfirmation('Team Alpha', 'Team Alpha')

    const confirm = screen.getByRole('button', { name: 'Deactivate' })
    await waitFor(() => expect(confirm).not.toBeDisabled())
    fireEvent.click(confirm)

    await waitFor(() => expect(mockPATCH).toHaveBeenCalled())
    expect(mockPATCH.mock.calls[0][0]).toBe('/v1/teams/{id}')
    expect(mockPATCH.mock.calls[0][1]).toMatchObject({
      params: { path: { id: 'team-a' } },
      body: { status: 'archived' },
    })
  })
})

describe('ProjectTeamsTab — restore is CONFIRMED but not typed', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPATCH.mockReset()
    mockPATCH.mockResolvedValue({ data: LINKS[1], error: undefined })
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects/{id}/teams') return Promise.resolve({ data: LINKS })
      return Promise.resolve({ data: [] })
    })
  })

  it('asks before restoring, and writes NOTHING on the icon click alone', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Restore team' }))

    expect(await screen.findByText(/Restore Team Beta\?/)).toBeTruthy()
    expect(mockPATCH).not.toHaveBeenCalled()
  })

  it('names the target but does NOT demand it be typed — a restore destroys nothing', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Restore team' }))
    await screen.findByText(/Restore Team Beta\?/)

    // No typed-confirmation input, and the confirm is live immediately.
    expect(screen.queryByPlaceholderText('Team Beta')).toBeNull()
    expect(screen.getByRole('button', { name: 'Restore' })).not.toBeDisabled()
  })

  it('restores on confirm', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Restore team' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(mockPATCH).toHaveBeenCalled())
    expect(mockPATCH.mock.calls[0][1]).toMatchObject({
      params: { path: { id: 'team-b' } },
      body: { status: 'active' },
    })
  })

  it('abandons on Cancel without writing', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Restore team' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(mockPATCH).not.toHaveBeenCalled()
  })
})
