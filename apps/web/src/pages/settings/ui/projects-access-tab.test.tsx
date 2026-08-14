import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * SRS §5.2 on the project roster: "Selecting Editor opens Team selection",
 * "Selecting Admin automatically grants `All Teams`".
 *
 * The regression these pin: the level select used to PATCH on change and stop, so
 * demoting an Admin to Editor produced — in one click — an Editor with zero teams,
 * the state §2.2 forbids. Reverting `handleSelectLevel` to the old immediate
 * `handleChange` fails "does not write the level ..." and "opens Team selection ..."
 * (verified by doing exactly that); dropping the `All Teams` sub-label fails the third.
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
import { ProjectAccessList } from './projects-access-tab'

// Radix's popover measures its trigger; jsdom has no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>
const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>
const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>

const ADMIN = {
  id: 'pm-1',
  userId: 'u-1',
  workspaceId: 'ws-1',
  projectId: 'p-1',
  accessLevel: 'admin',
  status: 'active',
  displayName: 'Ada Admin',
  email: 'ada@acme.test',
  joinedAt: '2026-01-01',
  updatedAt: '2026-01-01',
  teamCount: 0,
}

const TEAMS = [
  { id: 'link-a', teamId: 'team-a', name: 'Team Alpha', key: 'ALPHA', status: 'active' },
  { id: 'link-b', teamId: 'team-b', name: 'Team Beta', key: 'BETA', status: 'active' },
]

function renderList() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ProjectAccessList projectId="p-1" isWA />
    </QueryClientProvider>,
  )
}

describe('ProjectAccessList — §5.2 level + team selection', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPATCH.mockReset()
    mockPOST.mockReset()
    mockPATCH.mockResolvedValue({ data: undefined, error: undefined })
    mockPOST.mockResolvedValue({ data: {}, error: undefined })
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects/{id}/members') return Promise.resolve({ data: [ADMIN] })
      if (path === '/v1/projects/{id}/teams') return Promise.resolve({ data: TEAMS })
      if (path === '/v1/teams/{id}/members') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [] })
    })
  })

  async function chooseLevel(label: string) {
    const trigger = await screen.findByRole('button', { name: 'Access level for Ada Admin' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('button', { name: label }))
  }

  it('renders All Teams under an Admin row (§5.2: Admin automatically grants All Teams)', async () => {
    renderList()
    expect(await screen.findByText('All Teams')).toBeTruthy()
  })

  it('does not write the level when Editor is chosen — the Team step owns that write', async () => {
    renderList()
    await chooseLevel('Editor')
    await waitFor(() => expect(screen.getByText('Assign Editor teams')).toBeTruthy())
    expect(mockPATCH).not.toHaveBeenCalled()
    expect(mockPOST).not.toHaveBeenCalled()
  })

  it('opens Team selection and refuses to save an Editor with no team', async () => {
    renderList()
    await chooseLevel('Editor')
    const save = await screen.findByRole('button', { name: 'Save Access' })
    expect(save).toBeDisabled()
  })

  it('writes the level AND the team memberships together on Save Access', async () => {
    renderList()
    await chooseLevel('Editor')
    fireEvent.click(await screen.findByRole('button', { name: 'Teams' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Team Beta' }))
    const save = await screen.findByRole('button', { name: 'Save Access' })
    await waitFor(() => expect(save).not.toBeDisabled())
    fireEvent.click(save)

    await waitFor(() => expect(mockPATCH).toHaveBeenCalled())
    expect(mockPATCH.mock.calls[0][0]).toBe('/v1/projects/{id}/members/{memberId}')
    expect(mockPATCH.mock.calls[0][1]).toMatchObject({ body: { accessLevel: 'editor' } })
    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect(mockPOST.mock.calls[0][0]).toBe('/v1/teams/{id}/members')
    expect(mockPOST.mock.calls[0][1]).toMatchObject({
      params: { path: { id: 'team-b' } },
      body: { userId: 'u-1' },
    })
    // ORDER, not merely both: the team rows go first. See `handleSave` — level-first
    // meant a failed team write left the level landed, i.e. an Editor with zero teams.
    expect(mockPOST.mock.invocationCallOrder[0]).toBeLessThan(mockPATCH.mock.invocationCallOrder[0])
  })

  it('leaves the level alone when the team write fails (§2.2 stays unreachable)', async () => {
    // The failure the write order exists for: level-first, this same 500 produced an
    // Editor with zero teams — the state §2.2 forbids, reached by a network error
    // rather than a click, and not undoable from this dialog.
    mockPOST.mockResolvedValue({ error: { error: { message: 'boom' } }, response: { status: 500 } })
    renderList()
    await chooseLevel('Editor')
    fireEvent.click(await screen.findByRole('button', { name: 'Teams' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Team Beta' }))
    const save = await screen.findByRole('button', { name: 'Save Access' })
    await waitFor(() => expect(save).not.toBeDisabled())
    fireEvent.click(save)

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    // The member is still an Admin, which §2.2 permits; the dialog stays open to retry.
    expect(mockPATCH).not.toHaveBeenCalled()
    expect(screen.getByText('Assign Editor teams')).toBeTruthy()
  })

  it('commits Admin immediately — it has no Team step to defer to', async () => {
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects/{id}/members')
        return Promise.resolve({ data: [{ ...ADMIN, accessLevel: 'editor', teamCount: 1 }] })
      if (path === '/v1/projects/{id}/teams') return Promise.resolve({ data: TEAMS })
      return Promise.resolve({ data: [] })
    })
    renderList()
    await chooseLevel('Admin')
    await waitFor(() => expect(mockPATCH).toHaveBeenCalled())
    expect(mockPATCH.mock.calls[0][1]).toMatchObject({ body: { accessLevel: 'admin' } })
    // Team membership is NOT touched by a promotion to Admin (§5.2 gives only
    // Remove that power); All Teams is the absence of a scope, not a set of rows.
    expect(mockPOST).not.toHaveBeenCalled()
  })
})
