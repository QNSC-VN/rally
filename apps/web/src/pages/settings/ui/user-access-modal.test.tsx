import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * SRS §5.1's user-centric journey: "... -> Choose Admin / Editor -> Choose Teams only
 * when level is Editor -> Review Changes -> Confirm & Save" (:125-135), plus "Admin
 * displays `All Teams` automatically" and "Team selection appears only for Editor"
 * (:141-143).
 *
 * The regressions these pin: every control here used to commit on change (no draft, no
 * review, nothing to abandon), and the Teams picker rendered for Admin too. Wiring the
 * level select straight back to a mutation fails "stages ... without writing"; rendering
 * the picker for Admin fails "shows All Teams for an Admin".
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))
vi.mock('@/shared/lib/stores/auth.store', () => ({
  useAuthStore: () => ({ hasPermission: () => true, user: { id: 'u-me' } }),
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { UserAccessModal } from './user-access-modal'
import type { WorkspaceMember } from '@/features/workspaces/api'

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

const MEMBER = {
  id: 'wm-1',
  userId: 'u-1',
  status: 'active',
  displayName: 'Eve Editor',
  email: 'eve@acme.test',
  roleSlug: 'project_member',
} as unknown as WorkspaceMember

const PROJECTS = [{ id: 'p-1', key: 'NXP', name: 'NextGen Platform' }]
const TEAMS = [
  { id: 'link-a', teamId: 'team-a', name: 'Team Alpha', key: 'ALPHA', status: 'active' },
  { id: 'link-b', teamId: 'team-b', name: 'Team Beta', key: 'BETA', status: 'active' },
]

function projectMember(accessLevel: 'admin' | 'editor' | null) {
  return {
    id: 'pm-1',
    userId: 'u-1',
    workspaceId: 'ws-1',
    projectId: 'p-1',
    accessLevel,
    status: 'active',
    displayName: 'Eve Editor',
    joinedAt: '2026-01-01',
    updatedAt: '2026-01-01',
    teamCount: 1,
  }
}

/** `level` is the user's CURRENT access on p-1; `memberOfTeamA` seeds team_members. */
function seed(level: 'admin' | 'editor' | null, memberOfTeamA = true) {
  mockGET.mockImplementation((path: string, opts?: { params?: { path?: { id?: string } } }) => {
    if (path === '/v1/projects') return Promise.resolve({ data: { data: PROJECTS } })
    if (path === '/v1/projects/{id}/members')
      return Promise.resolve({ data: level === null ? [] : [projectMember(level)] })
    if (path === '/v1/projects/{id}/teams') return Promise.resolve({ data: TEAMS })
    if (path === '/v1/teams/{id}/members') {
      const teamId = opts?.params?.path?.id
      const rows =
        teamId === 'team-a' && memberOfTeamA
          ? [{ id: 'tm-1', teamId: 'team-a', userId: 'u-1', status: 'active', joinedAt: '' }]
          : []
      return Promise.resolve({ data: rows })
    }
    return Promise.resolve({ data: [] })
  })
}

async function openAccessTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <UserAccessModal member={MEMBER} workspaceId="ws-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  )
  // Radix Tabs activates from mousedown/focus, not click.
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Project Access' }))
  return screen.findByRole('button', { name: 'Access level for NextGen Platform' })
}

function noWrites() {
  expect(mockPATCH).not.toHaveBeenCalled()
  expect(mockPOST).not.toHaveBeenCalled()
  expect(mockDELETE).not.toHaveBeenCalled()
}

describe('UserAccessModal Project Access — §5.1 draft, review, confirm', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPATCH.mockReset()
    mockPOST.mockReset()
    mockDELETE.mockReset()
    mockPATCH.mockResolvedValue({ data: undefined, error: undefined })
    mockPOST.mockResolvedValue({ data: {}, error: undefined })
    mockDELETE.mockResolvedValue({ data: undefined, error: undefined })
  })

  it('shows All Teams for an Admin and offers no Team picker (§5.1 :141-143)', async () => {
    seed('admin')
    await openAccessTab()
    expect(await screen.findByText('All Teams')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Teams for NextGen Platform' })).toBeNull()
  })

  it('offers the Team picker for an Editor, and nothing to review until something changes', async () => {
    seed('editor')
    await openAccessTab()
    expect(await screen.findByRole('button', { name: 'Teams for NextGen Platform' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review Changes' })).toBeDisabled()
    noWrites()
  })

  it('stages a level change without writing, then writes it on Confirm & Save', async () => {
    seed('admin')
    const levelSelect = await openAccessTab()
    fireEvent.click(levelSelect)
    fireEvent.click(await screen.findByRole('button', { name: 'Editor' }))

    // §5.1: the level is now Editor in the DRAFT, with a Team picker — and nothing
    // has been written. The old modal had already PATCHed by this point.
    expect(await screen.findByRole('button', { name: 'Teams for NextGen Platform' })).toBeTruthy()
    noWrites()
    // The footer says a change is pending instead of "Changes take effect …".
    expect(screen.getByText('1 pending change — review before saving.')).toBeTruthy()

    const review = await screen.findByRole('button', { name: 'Review Changes' })
    await waitFor(() => expect(review).not.toBeDisabled())
    fireEvent.click(review)
    expect(await screen.findByText('Review Project Access')).toBeTruthy()
    // The summary names the project and the teams the save will write.
    const dialog = within(screen.getAllByRole('dialog').at(-1) as HTMLElement)
    expect(dialog.getByText('NXP · NextGen Platform')).toBeTruthy()
    expect(dialog.getByText('Team Alpha')).toBeTruthy()
    noWrites()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Save' }))
    await waitFor(() => expect(mockPATCH).toHaveBeenCalled())
    expect(mockPATCH.mock.calls[0][0]).toBe('/v1/projects/{id}/members/{memberId}')
    expect(mockPATCH.mock.calls[0][1]).toMatchObject({ body: { accessLevel: 'editor' } })
  })

  /**
   * `blocked` (the §2.2 guard), NOT `changes.length === 0`.
   *
   * This test used to toggle Team Beta ON and straight back OFF, which returns the draft
   * to its baseline — so `changes` was EMPTY and the button was disabled by the "nothing
   * to save" half of the condition. It passed with the §2.2 guard deleted. Reaching
   * `blocked` needs a baseline that HAS a team and a draft that has none, so `teamsChanged`
   * is true (there IS a pending change) while `teamIds` is empty. The pending-change
   * assertion below is what pins that distinction: it fails if the draft is clean.
   */
  it('refuses to review an Editor left with no team (§2.2)', async () => {
    seed('editor') // baseline: Editor in Team Alpha
    await openAccessTab()
    // The picker is `readOnly` (a span, not a button) until the membership fan-out
    // resolves, so finding it as a button means the baseline teams have landed.
    const teamPicker = await screen.findByRole('button', { name: 'Teams for NextGen Platform' })
    await waitFor(() => expect(within(teamPicker).getByText('Team Alpha')).toBeTruthy())

    // Take the only team away: an Editor with zero teams, which §2.2 forbids.
    fireEvent.click(teamPicker)
    fireEvent.click(await screen.findByRole('button', { name: 'Team Alpha' }))

    // A change IS staged (so `changes.length === 0` cannot be what disables the
    // button) and it is still refused.
    expect(await screen.findByText('1 pending change — review before saving.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review Changes' })).toBeDisabled()
    noWrites()
  })

  it('stages a Remove and only DELETEs on Confirm & Save', async () => {
    seed('editor')
    await openAccessTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove access' }))
    noWrites()

    fireEvent.click(await screen.findByRole('button', { name: 'Review Changes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & Save' }))
    await waitFor(() => expect(mockDELETE).toHaveBeenCalled())
    expect(mockDELETE.mock.calls[0][0]).toBe('/v1/projects/{id}/members/{userId}')
  })

  /**
   * A mid-loop failure must not cost the progress made before it. `save()` used to clear
   * the draft only on FULL success, so the changes that had already been written stayed
   * listed: the retry re-issued a DELETE that had worked, `removeProjectMember` 404'd on
   * it (`findMember` is active-only), and the loop died on that same first change forever
   * — the rest of the draft was unreachable without closing and reopening the modal.
   */
  it('keeps partial progress when one change fails, and retries only the rest', async () => {
    const twoProjects = [
      { id: 'p-1', key: 'NXP', name: 'NextGen Platform' },
      { id: 'p-2', key: 'PAY', name: 'Payments' },
    ]
    // No teams on either project, so Remove is the only change in play.
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects') return Promise.resolve({ data: { data: twoProjects } })
      if (path === '/v1/projects/{id}/members')
        return Promise.resolve({ data: [projectMember('editor')] })
      return Promise.resolve({ data: [] })
    })
    mockDELETE
      .mockResolvedValueOnce({ data: undefined, error: undefined })
      .mockResolvedValueOnce({ error: { error: { message: 'boom' } }, response: { status: 500 } })

    await openAccessTab()
    const removes = await screen.findAllByRole('button', { name: 'Remove access' })
    expect(removes).toHaveLength(2)
    removes.forEach((b) => fireEvent.click(b))
    expect(await screen.findByText('2 pending changes — review before saving.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Review Changes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & Save' }))
    await waitFor(() => expect(mockDELETE).toHaveBeenCalledTimes(2))

    // NXP landed and is gone from the draft; PAY is all that is left to do, and the
    // review dialog is still open on it.
    await waitFor(() =>
      expect(screen.getByText('1 pending change — review before saving.')).toBeTruthy(),
    )
    const dialog = within(screen.getAllByRole('dialog').at(-1) as HTMLElement)
    expect(dialog.queryByText('NXP · NextGen Platform')).toBeNull()
    expect(dialog.getByText('PAY · Payments')).toBeTruthy()

    // The retry re-issues PAY only — never the DELETE that already succeeded.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Save' }))
    await waitFor(() => expect(mockDELETE).toHaveBeenCalledTimes(3))
    expect(mockDELETE.mock.calls[2][1]).toMatchObject({ params: { path: { id: 'p-2' } } })
  })
})
