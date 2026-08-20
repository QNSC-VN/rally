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
const mockDELETE = apiClient.DELETE as ReturnType<typeof vi.fn>

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

  /**
   * ONE request, level and teams together (PRJ-08).
   *
   * This used to assert a PATCH for the level, a `POST /v1/teams/{id}/members` per team, AND their
   * relative ORDER — team rows first, because level-first meant a failed team write left the level
   * landed with no teams behind it, §2.2's forbidden state reached through a network error. The
   * ordering was a mitigation for a window that no longer exists: the combined endpoint applies both
   * halves in one server-side transaction, so there is nothing left to order and the server refuses
   * the invalid combination outright (`assertTeamAssignmentForLevel`).
   */
  it('writes the level AND the team memberships in ONE request on Save Access', async () => {
    renderList()
    await chooseLevel('Editor')
    fireEvent.click(await screen.findByRole('button', { name: 'Teams' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Team Beta' }))
    const save = await screen.findByRole('button', { name: 'Save Access' })
    await waitFor(() => expect(save).not.toBeDisabled())
    fireEvent.click(save)

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect(mockPOST.mock.calls[0][0]).toBe('/v1/projects/{id}/members')
    expect(mockPOST.mock.calls[0][1]).toMatchObject({
      body: { userId: 'u-1', accessLevel: 'editor', teamIds: ['team-b'] },
    })
    // No second write to order against, and no per-team fan-out at all.
    expect(mockPOST).toHaveBeenCalledTimes(1)
    expect(mockPATCH).not.toHaveBeenCalled()
  })

  it('keeps the dialog open to retry when the combined write fails', async () => {
    mockPOST.mockResolvedValue({ error: { error: { message: 'boom' } }, response: { status: 500 } })
    renderList()
    await chooseLevel('Editor')
    fireEvent.click(await screen.findByRole('button', { name: 'Teams' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Team Beta' }))
    const save = await screen.findByRole('button', { name: 'Save Access' })
    await waitFor(() => expect(save).not.toBeDisabled())
    fireEvent.click(save)

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    // Nothing partial can have landed — one request, one transaction. The member is still an Admin,
    // which §2.2 permits, and the dialog stays open.
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
    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect(mockPOST.mock.calls[0][1]).toMatchObject({ body: { accessLevel: 'admin' } })
    // Team membership is NOT touched by a promotion to Admin (§5.2 gives only Remove that power);
    // All Teams is the absence of a scope, so the body carries no `teamIds` for the server to
    // reconcile against.
    expect(mockPOST.mock.calls[0][1].body).not.toHaveProperty('teamIds')
  })
})

/**
 * GAP-P4-SET-004 — `Remove Access` is the one action here the BA singles out for TYPED target
 * confirmation, and it is the one that cannot be undone by an equal-and-opposite click: it deletes
 * the `project_members` row AND every one of that user's `team_members` rows for this project (§5.2),
 * so re-adding them restores the level but not the memberships.
 *
 * The assertions are about the WRITE being blocked, not about a dialog appearing. It already named
 * the target and still committed on one click of a 13px icon in a dense row.
 */
describe('ProjectAccessList — removing access needs the name typed', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPATCH.mockReset()
    mockPOST.mockReset()
    mockDELETE.mockReset()
    mockDELETE.mockResolvedValue({ data: undefined, error: undefined, response: { status: 204 } })
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects/{id}/members') return Promise.resolve({ data: [ADMIN] })
      if (path === '/v1/projects/{id}/teams') return Promise.resolve({ data: TEAMS })
      return Promise.resolve({ data: [] })
    })
  })

  async function openRemove() {
    // 'Remove access' is the icon; 'Remove Access' is the dialog's confirm — the role-name match is
    // case-sensitive, so the two never collide.
    fireEvent.click(await screen.findByRole('button', { name: 'Remove access' }))
    return screen.findByText(/Remove Ada Admin from this project\?/)
  }

  it('keeps the confirm disabled until the name matches, and DELETEs nothing before that', async () => {
    renderList()
    await openRemove()

    expect(screen.getByRole('button', { name: 'Remove Access' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Ada Admin'), { target: { value: 'ada admin' } })
    expect(screen.getByRole('button', { name: 'Remove Access' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Access' }))
    expect(mockDELETE).not.toHaveBeenCalled()
  })

  it('removes the access once the exact name is typed', async () => {
    renderList()
    await openRemove()
    fireEvent.change(screen.getByPlaceholderText('Ada Admin'), { target: { value: 'Ada Admin' } })

    const confirm = screen.getByRole('button', { name: 'Remove Access' })
    await waitFor(() => expect(confirm).not.toBeDisabled())
    fireEvent.click(confirm)

    await waitFor(() => expect(mockDELETE).toHaveBeenCalled())
    expect(mockDELETE.mock.calls[0][0]).toBe('/v1/projects/{id}/members/{userId}')
    expect(mockDELETE.mock.calls[0][1]).toMatchObject({
      params: { path: { id: 'p-1', userId: 'u-1' } },
    })
  })
})

/**
 * The half of §2.1 the Workspace-Admin team-membership ruling did NOT reverse.
 *
 * `project-teams-tab.tsx` now offers a Workspace Admin as a Team lead and a Team member, because the
 * ruling reversed exactly that. This list is different: it writes `project_members` rows, which is
 * the assignment the ruling explicitly withholds ("must NOT create or require an Admin/Editor
 * Project Access assignment"), and migration 0118 deletes any that exist. So the candidate filter
 * here stays — asserted in BOTH directions, because a test that only proves the Workspace Admin is
 * absent also passes when the whole list is empty.
 */
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
]

describe('ProjectAccessList — a Workspace Admin is still not a PROJECT ACCESS candidate', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPOST.mockReset()
    mockPOST.mockResolvedValue({ data: {}, error: undefined })
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects/{id}/members') return Promise.resolve({ data: [] })
      if (path === '/v1/projects/{id}/teams') return Promise.resolve({ data: TEAMS })
      if (path === '/v1/workspaces/{id}/members-with-profile')
        return Promise.resolve({ data: WS_ROSTER })
      return Promise.resolve({ data: [] })
    })
  })

  it('offers the ordinary member and omits the Workspace Admin', async () => {
    renderList()
    fireEvent.click(await screen.findByRole('button', { name: 'Add existing user' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Select a workspace user' }))

    expect(await screen.findByRole('button', { name: 'Eddie Editor' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Wanda Admin' })).toBeNull()
  })
})
