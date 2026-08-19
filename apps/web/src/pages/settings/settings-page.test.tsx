import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * The Settings gear, seen by a NON-ADMIN reader.
 *
 * Three rules, all from the BA, all of which this page broke:
 *  1. An entry the reader has no access to is HIDDEN — Phase 4 `03_Settings_Audit/SRS.md:48-58`
 *     ("Hidden" for Workspace Settings, Users, Permission Model and Audit Log at every level below
 *     WA), §4.1:69 ("Other users do not see the entry"), and
 *     `P3_RBAC_AND_SYSTEM_STATES.md:38` / `02_Roles_Permissions/SRS.md:117` ("Disabled is not an
 *     assignable access level. It must not be used as a replacement for No Access"). Every one of
 *     them used to render `disabled` with a padlock and the words "Requires admin role": 4 rows for a
 *     per-project Admin, 5 for an Editor, 6 for No Access — counts taken from this file.
 *  2. `My Permissions` opens for every authenticated reader (§3:53 gives all four principals a row)
 *     and reports the TRUTH about their access. It read the ADMINISTRATIVE roster
 *     (`GET /projects/:id/members`, refused for any level but `admin` per §3.1:71), whose silent 403
 *     became `No Access` on every row — the access screen denying the reader their own access.
 *  3. A hidden entry must not leave the reader on a panel with no tab. The visible set SHRINKS in
 *     ordinary use, because it resolves against the selected project.
 *
 * Reverting any of the three fails a test here; the exact failure text is recorded in the report for
 * this change.
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

/**
 * The selected project is mutable, because that is how the visible set shrinks under a reader who is
 * already inside Settings: `useProjectPermissions` resolves against it, and a reader may be Admin in
 * one project and Editor in another.
 */
let selectedProjectId = 'p-admin'
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: (selector?: (s: unknown) => unknown) => {
    const state = {
      workspace: { workspaceId: 'ws-1', workspaceName: 'Acme' },
      project: { projectId: selectedProjectId, projectName: 'NextGen' },
    }
    return selector ? selector(state) : state
  },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { SettingsPage } from './settings-page'

// Radix's popover measures its trigger; jsdom has no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

/** The `editor` access level's codes (`ACCESS_LEVEL_PERMISSIONS.editor`, abridged). */
const EDITOR = ['project:view', 'work_item:view', 'iteration:view', 'quality:view']
/** `project:edit` is what a per-project `admin` adds — the §3.1:65 discriminator. */
const ADMIN = [...EDITOR, 'project:edit']

const PERMS_BY_PROJECT: Record<string, string[]> = { 'p-admin': ADMIN, 'p-editor': EDITOR }

/** A normal user: the WORKSPACE baseline holds nothing — every code comes from a project grant. */
function signInAsNormalUser() {
  useAuthStore.setState({
    user: {
      id: 'u-1',
      email: 'ed@acme.test',
      displayName: 'Ed Editor',
      locale: 'en',
      timezone: 'UTC',
      role: 'member',
      permissions: [],
      emailVerified: true,
      createdAt: '',
      updatedAt: '',
    },
    isAuthenticated: true,
    isLoading: false,
  })
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

/** The sidebar entries, by their accessible names — scoped to the aside, since tabs have buttons too. */
function sidebarLabels(): string[] {
  return within(document.querySelector('aside') as HTMLElement)
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter(Boolean)
}

describe('Settings sidebar — an entry the reader lacks is HIDDEN, not padlocked', () => {
  beforeEach(() => {
    selectedProjectId = 'p-admin'
    mockGET.mockReset()
    mockGET.mockImplementation(
      (path: string, opts?: { params?: { path?: { projectId?: string } } }) => {
        if (path === '/v1/projects/{projectId}/my-permissions') {
          const id = opts?.params?.path?.projectId ?? ''
          return Promise.resolve({
            data: { projectId: id, permissions: PERMS_BY_PROJECT[id] ?? [] },
          })
        }
        if (path === '/v1/projects')
          return Promise.resolve({
            data: {
              data: [{ id: 'p-editor', key: 'NXP', name: 'NextGen', status: 'active' }],
              pageInfo: { nextCursor: null, hasNextPage: false, limit: 100 },
            },
          })
        return Promise.resolve({ data: [] })
      },
    )
    signInAsNormalUser()
  })

  it('renders no padlocked entry for an Editor — the hidden ones are absent', async () => {
    selectedProjectId = 'p-editor'
    renderPage()

    // Resolved: the one Workspace-group entry an Editor holds is on screen.
    await waitFor(() => expect(screen.getByText('Workspaces & Projects')).toBeTruthy())

    // Not disabled-with-a-padlock — absent. Both halves are asserted: a `disabled` row would satisfy
    // "the text is gone" if only the caption were removed.
    expect(screen.queryByTitle('Requires admin role')).toBeNull()
    expect(screen.getAllByRole('button').filter((b) => b.hasAttribute('disabled'))).toHaveLength(0)
    for (const hidden of [
      'Workspace Settings',
      'User Management',
      'Integrations',
      'Audit Log',
      'Permission Model',
    ]) {
      expect(screen.queryByText(hidden), `${hidden} must be hidden for an Editor`).toBeNull()
    }
    // §3:52-56 / `P3_RBAC_AND_SYSTEM_STATES.md:46`: "My Permissions and Workspaces & Projects",
    // plus the profile every level owns.
    expect(sidebarLabels()).toEqual(
      expect.arrayContaining(['Profile & Account', 'My Permissions', 'Workspaces & Projects']),
    )
  })

  /**
   * `P3_RBAC_AND_SYSTEM_STATES.md:47` — a No Access reader's gear is "Personal only". The GROUP goes
   * with its rows: an empty `Workspace` heading standing over nothing would disclose exactly what
   * hiding the rows conceals.
   */
  it('leaves a No Access reader the Personal group alone, with no empty heading', async () => {
    selectedProjectId = 'p-none'
    renderPage()
    await waitFor(() => expect(mockGET).toHaveBeenCalled())
    // `Profile & Account` is both the entry and the open panel's heading, hence the role query.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Profile & Account' })).toBeTruthy(),
    )

    expect(screen.getByText('Personal')).toBeTruthy()
    expect(screen.queryByText('Workspace')).toBeNull()
    expect(screen.queryByText('Workspaces & Projects')).toBeNull()
    expect(screen.queryByTitle('Requires admin role')).toBeNull()
    // "Personal only" still holds — API Tokens IS a Personal entry. It is listed at every access
    // level because `/v1/me/api-tokens` is scoped to the caller by the route itself, so there is no
    // permission to gate it on, and because an owner must be able to REVOKE their own credentials
    // whatever their level: a token inherits its owner's permissions at request time, so one minted
    // by a No Access reader becomes useful the moment access is granted, and the person who minted
    // it is the person who should be able to see it.
    expect(sidebarLabels()).toEqual(['Profile & Account', 'My Permissions', 'API Tokens'])
  })

  it('shows Permission Model to a per-project Admin and nothing else new (§3:57)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Permission Model')).toBeTruthy())
    expect(screen.queryByTitle('Requires admin role')).toBeNull()
    for (const hidden of ['Workspace Settings', 'User Management', 'Integrations', 'Audit Log']) {
      expect(screen.queryByText(hidden), `${hidden} must be hidden for an Admin`).toBeNull()
    }
  })

  /**
   * The tab-bar rule. The reader is Admin in `p-admin`, opens `Permission Model`, then selects a
   * project they only edit — where §3:57 hides that entry. The panel must not keep rendering it, and
   * must not go blank: it lands on `Profile & Account`, which carries `requires: null` and is
   * therefore visible at every level (§3:52).
   */
  it('lands somewhere valid when the open tab becomes hidden under the reader', async () => {
    const { rerender } = renderPage()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    fireEvent.click(await screen.findByText('Permission Model'))
    expect(screen.getByRole('heading', { name: 'Permission Model' })).toBeTruthy()

    selectedProjectId = 'p-editor'
    rerender(
      <QueryClientProvider client={qc}>
        <SettingsPage />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.queryByText('Permission Model')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Profile & Account' })).toBeTruthy()
  })
})

describe('Settings > My Permissions — opens for an Editor and tells them the truth', () => {
  beforeEach(() => {
    selectedProjectId = 'p-editor'
    mockGET.mockReset()
    mockGET.mockImplementation(
      (path: string, opts?: { params?: { path?: { projectId?: string } } }) => {
        if (path === '/v1/projects/{projectId}/my-permissions') {
          const id = opts?.params?.path?.projectId ?? ''
          return Promise.resolve({
            data: { projectId: id, permissions: PERMS_BY_PROJECT[id] ?? [] },
          })
        }
        if (path === '/v1/projects')
          return Promise.resolve({
            data: {
              data: [{ id: 'p-editor', key: 'NXP', name: 'NextGen', status: 'active' }],
              pageInfo: { nextCursor: null, hasNextPage: false, limit: 100 },
            },
          })
        // The administrative roster REFUSES an Editor (`listProjectMembers`), exactly as the server
        // does. Any surface that reads it for an Editor gets this, silently.
        if (path === '/v1/projects/{id}/members')
          return Promise.resolve({
            error: { error: { message: 'Only a Workspace Admin or a Project Admin can view' } },
            response: { status: 403 },
          })
        return Promise.resolve({ data: [] })
      },
    )
    signInAsNormalUser()
  })

  /**
   * The `Your Project Access` row, by its project KEY — scoped deliberately, because the Access Level
   * Reference block below legitimately names every level including `Editor` and `No Access`.
   */
  function projectRow(): string {
    return screen.getByText('NXP').closest('div')?.parentElement?.textContent ?? ''
  }

  it('opens, and reports Editor rather than No Access', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('My Permissions'))

    expect(screen.getByRole('heading', { name: 'My Permissions' })).toBeTruthy()
    await waitFor(() => expect(projectRow()).toContain('Editor'))
    expect(projectRow()).not.toContain('No Access')
  })

  it('never reads the administrative roster — the feed that refuses its own reader', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('My Permissions'))
    await waitFor(() => expect(projectRow()).toContain('Editor'))
    expect(mockGET.mock.calls.filter((c) => c[0] === '/v1/projects/{id}/members')).toHaveLength(0)
  })
})
