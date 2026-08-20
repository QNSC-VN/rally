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

/**
 * The BA's Workspace-Admin team-membership ruling — the FE half, and the half of §2.1 it did NOT
 * reverse.
 *
 * A Workspace Admin may now be manually added to an ACTIVE Team and be that Team's Lead, so this
 * modal no longer filters `roleSlug === 'workspace_admin'` out of `eligible`. What still holds is
 * that they hold no `project_members` row: team membership is operational scope only and "must NOT
 * create or require an Admin/Editor Project Access assignment".
 *
 * The payload assertion is the one that matters. Everything else here is visible on screen and would
 * be noticed; a stray `POST /v1/projects/{id}/members` for a Workspace Admin is invisible — it
 * succeeds, shows nothing, and `AccessService.effectiveAssignments` turns the row into a live
 * Project Admin grant the moment that user is demoted. Reinstating the old `filter` fails the two
 * candidate tests; dropping the `level === null` skip in `syncMemberAccess` fails only that one.
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

describe('TeamFormModal — a Workspace Admin is a Team candidate, but never a project_members row', () => {
  const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockGET.mockReset()
    mockPOST.mockReset()
    mockPOST.mockResolvedValue({ data: { id: 'team-new' }, error: undefined })
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects/{id}/teams') return Promise.resolve({ data: LINKS })
      if (path === '/v1/workspaces/{id}/members-with-profile')
        return Promise.resolve({ data: WS_ROSTER })
      if (path === '/v1/workspaces/{id}/member-options')
        return Promise.resolve({
          data: WS_ROSTER.map((m) => ({
            userId: m.userId,
            displayName: m.displayName,
            email: m.email,
            avatarUrl: null,
            assignable: true,
          })),
        })
      if (path === '/v1/projects/{id}/members') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [] })
    })
  })

  async function openCreate() {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Add team' }))
    // Both the modal title and its submit read `Create team`, so address the FIELD that only the
    // open modal has.
    return screen.findByPlaceholderText('e.g. Core Platform')
  }

  /**
   * Team key auto-fills from the name, and stays the reader's to change (BA report, 2026-08-20).
   *
   * The field was required, empty, and showed `CP` as a placeholder with nothing filling it in — the BA
   * read that placeholder as a stray value, which is the clearest sign it looked like one.
   */
  describe('the Team key the form offers', () => {
    const keyField = () => screen.getByPlaceholderText('CP') as HTMLInputElement

    it('derives from the name as it is typed', async () => {
      const nameField = await openCreate()
      expect(keyField().value).toBe('')

      fireEvent.change(nameField, { target: { value: 'Core Platform' } })

      expect(keyField().value).toBe('CP')
    })

    it('keeps following the name until the reader edits the key', async () => {
      const nameField = await openCreate()
      fireEvent.change(nameField, { target: { value: 'Core Platform' } })
      fireEvent.change(nameField, { target: { value: 'Quality Assurance Team' } })

      expect(keyField().value).toBe('QAT')
    })

    it('lets a typed key win, and stop following', async () => {
      const nameField = await openCreate()
      fireEvent.change(nameField, { target: { value: 'Core Platform' } })
      fireEvent.change(keyField(), { target: { value: 'PLAT' } })
      fireEvent.change(nameField, { target: { value: 'Something Else' } })

      expect(keyField().value).toBe('PLAT')
    })

    it('hands control back to the suggestion when the key is cleared', async () => {
      // Otherwise clearing the box strands the reader on an empty REQUIRED field with a value they
      // cannot get back without retyping the name.
      const nameField = await openCreate()
      fireEvent.change(nameField, { target: { value: 'Core Platform' } })
      fireEvent.change(keyField(), { target: { value: 'PLAT' } })
      fireEvent.change(keyField(), { target: { value: '' } })

      expect(keyField().value).toBe('CP')
    })

    it('enables Create team on the derived key alone', async () => {
      const nameField = await openCreate()
      fireEvent.change(nameField, { target: { value: 'Core Platform' } })

      const submit = screen.getAllByRole('button', { name: 'Create team' }).at(-1)!
      expect(submit).toBeEnabled()
    })
  })

  it('offers a Workspace Admin as a Team lead (the reversed half of §2.1)', async () => {
    await openCreate()
    fireEvent.click(await screen.findByRole('button', { name: 'Team lead' }))
    expect(await screen.findByRole('button', { name: 'Wanda Admin' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Eddie Editor' })).toBeTruthy()
  })

  it('offers a Workspace Admin as a Team MEMBER candidate', async () => {
    await openCreate()
    expect(
      await screen.findByRole('checkbox', { name: 'Add Wanda Admin to this team' }),
    ).toBeTruthy()
  })

  it('shows the Workspace Admin badge and NO access-level select on that row, even when checked', async () => {
    await openCreate()
    const row = await screen.findByRole('checkbox', { name: 'Add Wanda Admin to this team' })
    fireEvent.click(row)

    // The badge stands where a level would be, and the level select never appears for this row.
    expect(screen.getAllByText('Workspace Admin').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Access level for Wanda Admin' })).toBeNull()

    // Contrast: an ordinary member DOES get one once checked, so the absence above is about the
    // Workspace Admin and not about the checkbox failing to register.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add Eddie Editor to this team' }))
    expect(
      await screen.findByRole('button', { name: 'Access level for Eddie Editor' }),
    ).toBeTruthy()
  })

  it('adds the Workspace Admin to the team but OMITS them from the project-access sync', async () => {
    await openCreate()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Add Wanda Admin to this team' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add Eddie Editor to this team' }))
    fireEvent.change(screen.getByPlaceholderText('e.g. Core Platform'), {
      target: { value: 'Core Platform' },
    })
    fireEvent.change(screen.getByPlaceholderText('CP'), { target: { value: 'CP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }))

    await waitFor(() =>
      expect(mockPOST.mock.calls.some((c) => c[0] === '/v1/workspaces/{workspaceId}/teams')).toBe(
        true,
      ),
    )

    // Team membership: BOTH, because a Workspace Admin may now hold one.
    const create = mockPOST.mock.calls.find((c) => c[0] === '/v1/workspaces/{workspaceId}/teams')!
    expect((create[1].body as { memberUserIds: string[] }).memberUserIds.sort()).toEqual([
      'u-ed',
      'u-wa',
    ])

    // Project access: the Editor ONLY. A `POST /v1/projects/{id}/members` naming `u-wa` is the row
    // §2.1 forbids and migration 0118 deletes.
    await waitFor(() =>
      expect(mockPOST.mock.calls.some((c) => c[0] === '/v1/projects/{id}/members')).toBe(true),
    )
    const accessCalls = mockPOST.mock.calls.filter((c) => c[0] === '/v1/projects/{id}/members')
    expect(accessCalls.map((c) => (c[1].body as { userId: string }).userId)).toEqual(['u-ed'])
  })
})
