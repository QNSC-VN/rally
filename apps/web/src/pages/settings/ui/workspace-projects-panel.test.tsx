import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * Settings > Workspaces & Projects, seen by a project EDITOR.
 *
 * `02_Roles_Permissions/SRS.md:71` — "View Project `Users & Permissions` | Edit | Read-only | Hidden |
 * Hidden" — repeated at `P3_RBAC_AND_SYSTEM_STATES.md:56`. The surface itself is NOT hidden from an
 * Editor (§3.1:67 gives them "Assigned Project and assigned Teams", §3.1:70 gives Details and Teams
 * read-only), so this is a tab-level rule inside a screen they legitimately open.
 *
 * The defect: the tab rendered for every reader, and `ProjectAccessList`'s roster read
 * (`GET /projects/:id/members`) then 403'd for an Editor — a refused READ is silent by design, so the
 * empty result printed "No members in this project yet." The reader was shown that the surface
 * exists, clicked it, and was answered with a fabricated fact about the project.
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
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { WorkspaceProjectsPanel } from './workspace-projects-panel'

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const EDITOR = ['project:view', 'work_item:view', 'iteration:view', 'quality:view']
const ADMIN = [...EDITOR, 'project:edit']

const PROJECTS = [
  { id: 'p-admin', key: 'NXP', name: 'NextGen Platform', status: 'active', teamCount: 1 },
  { id: 'p-editor', key: 'PAY', name: 'Payments', status: 'active', teamCount: 1 },
]

/** `p-admin` → per-project Admin, `p-editor` → Editor. The workspace baseline holds nothing. */
const PERMS_BY_PROJECT: Record<string, string[]> = { 'p-admin': ADMIN, 'p-editor': EDITOR }

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

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceProjectsPanel />
    </QueryClientProvider>,
  )
}

/**
 * Open a project from the TREE — scoped to the aside, because the workspace overview in the detail
 * pane lists the same names and the point of the test is the detail pane's reaction to the tree.
 */
async function openProject(name: string) {
  const tree = within(document.querySelector('aside') as HTMLElement)
  fireEvent.click(await tree.findByText(name))
}

describe('Workspaces & Projects — Users & Permissions is HIDDEN for an Editor (§3.1:71)', () => {
  beforeEach(() => {
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
              data: PROJECTS,
              pageInfo: { nextCursor: null, hasNextPage: false, limit: 100 },
            },
          })
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

  it('omits the tab for a project the reader only edits', async () => {
    renderPanel()
    await openProject('Payments')

    // The screen itself opens (§3.1:67) — Details and Teams are Read-only, scoped (§3.1:70).
    await waitFor(() => expect(screen.getByText('Details')).toBeTruthy())
    expect(screen.getByText('Teams')).toBeTruthy()
    expect(screen.queryByText('Users & Permissions')).toBeNull()
    // And nothing asked for the roster it would have read.
    expect(mockGET.mock.calls.filter((c) => c[0] === '/v1/projects/{id}/members')).toHaveLength(0)
  })

  it('offers the tab for a project the reader administers (§3.1:71 Read-only)', async () => {
    renderPanel()
    await openProject('NextGen Platform')
    await waitFor(() => expect(screen.getByText('Users & Permissions')).toBeTruthy())
  })

  /**
   * The tab-bar rule. The tree switches project WITHOUT remounting the detail pane, so the open tab
   * outlives the project it was opened on. `details` is visible at every level, so the fallback always
   * lands and the panel can never go blank under a strip that no longer offers the tab.
   */
  it('falls back to Details when the open tab becomes hidden on a project switch', async () => {
    renderPanel()
    await openProject('NextGen Platform')
    fireEvent.click(await screen.findByText('Users & Permissions'))
    // The roster surface is on screen for the project they administer.
    await waitFor(() => expect(screen.getByLabelText('Search project users')).toBeTruthy())

    await openProject('Payments')
    await waitFor(() => expect(screen.queryByText('Users & Permissions')).toBeNull())
    expect(screen.queryByLabelText('Search project users')).toBeNull()
    // Landed on Details, not on nothing: the project's own fields are rendered.
    expect(screen.getByText('Project key')).toBeTruthy()
  })
})
