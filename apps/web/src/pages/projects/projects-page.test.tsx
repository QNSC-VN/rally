/**
 * Projects list — role gating on the grid's SIX mutating cells.
 *
 * Two defects, one rule. Every write behind this grid needs `workspace:edit`:
 * `PATCH /projects/:id` (Name / Status / Owner / Start / End) and `POST|DELETE /projects/:id/teams`
 * (Teams) all carry `@RequirePermission('workspace:edit')`
 * (`libs/modules/projects/src/interface/http/projects.controller.ts:276,505,520`). The BA gives that
 * authority to Workspace Admin ALONE — "Create, edit, archive, restore or delete Project | Edit |
 * Hidden | Hidden | Hidden" and "Assign Project access and Team membership | Edit | Read-only view
 * only | Hidden | Hidden" (`Phase 4/02_Roles_Permissions/SRS.md:68,64`) — while giving a per-project
 * Admin and an Editor the same rows as data: "View Project Details and Teams | Edit | Read-only |
 * Read-only, scoped | Hidden" (`SRS.md:70`).
 *
 * What shipped instead:
 *   • the Teams picker had NO permission gate at all, only `p.status === 'active'` — a lifecycle
 *     test standing in for an authorization one. An Editor ticked a team and the server refused;
 *     now that a 403 no longer redirects the app, it refused SILENTLY.
 *   • the other five opened, took a keystroke and reverted, because `ctx.onPatch` is `undefined`
 *     without the code. A control that looks editable and is not is the worst of the three states
 *     the BA defines, and it is invisible to the dev principal, who is a Workspace Admin.
 *
 * The state chosen is Read-only, not Disabled and not Hidden: "Data is visible; mutation control is
 * absent | Plain value/detail field, not a disabled input"
 * (`08_Convert to figma/P3_UX_Patterns_and_BE_Contracts/P3_RBAC_AND_SYSTEM_STATES.md:34`), which is
 * why every assertion below pairs "no control" with "the value is still on screen".
 *
 * The seam these tests use: every editable cell editor renders a `<button aria-label="…">` (the
 * popover trigger), and its read-only branch renders a plain `<span>`. So `queryByRole('button')`
 * is a faithful test of which of the two states rendered — and the Workspace Admin case is the
 * negative control that stops the other two passing vacuously.
 *
 * The real auth store is used rather than a stubbed `hasPermission`, so `grants()`'s wildcard rule
 * (`workspace:*` grants everything) is exercised as the page actually resolves it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({ workspace: { workspaceId: 'ws-1', workspaceName: 'QNSC' } }),
}))

const PROJECT = {
  id: 'p-1',
  workspaceId: 'ws-1',
  key: 'NXP',
  name: 'NextGen Platform',
  description: null,
  leadId: 'u-9',
  leadName: 'Ada Lovelace',
  startDate: '2026-01-05',
  endDate: '2026-06-30',
  status: 'active' as const,
  memberCount: 4,
  teamCount: 1,
  settings: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
}

/**
 * The writes, in a holder so the mock factories can reference them without a TDZ hazard (the
 * factory body runs at hoist time; these properties are read at render time).
 */
const calls = { update: vi.fn(), del: vi.fn(), link: vi.fn(), unlink: vi.fn() }

vi.mock('@/features/projects/api', () => ({
  useProjects: () => ({
    data: [PROJECT],
    isLoading: false,
    isError: false,
    isLoadingMore: false,
  }),
  useUpdateProject: () => ({ mutate: calls.update, mutateAsync: calls.update, isPending: false }),
  useDeleteProject: () => ({ mutate: calls.del, mutateAsync: calls.del, isPending: false }),
  useCreateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/features/workspaces/api', () => ({
  useWorkspaceMemberOptions: () => ({
    data: [{ userId: 'u-9', displayName: 'Ada Lovelace', email: 'ada@qnsc.dev' }],
    isLoading: false,
  }),
}))

vi.mock('@/features/teams/api', () => ({
  useProjectTeams: () => ({ data: [{ id: 't-1', key: 'ALP', name: 'Team Alpha' }] }),
  useWorkspaceTeams: () => ({
    data: [
      { id: 't-1', key: 'ALP', name: 'Team Alpha' },
      { id: 't-2', key: 'BET', name: 'Team Beta' },
    ],
    isLoading: false,
  }),
  useProjectMemberOptions: () => ({ data: [] }),
  useLinkProjectTeam: () => ({ mutate: calls.link }),
  useUnlinkProjectTeam: () => ({ mutate: calls.unlink }),
}))

import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { ProjectsPage } from './projects-page'

/** Every cell editor on this grid, by the `aria-label` its popover trigger carries. */
const PICKER_LABELS = ['Status', 'Owner', 'Teams', 'Start Date', 'End Date'] as const

/**
 * The three principals of the 3-level model (`SRS.md:21`). No Access needs no case here: it has no
 * `project_members` row, so the project never reaches this list at all (`SRS.md:44`).
 */
const PRINCIPAL = {
  // `workspace:*` is the Workspace Admin anchor; `grants()` resolves every other code from it.
  workspaceAdmin: ['workspace:*', 'workspace:edit', 'project:view', 'project:edit'],
  // A per-project Admin. It DOES hold `project:edit` — delivery configuration (labels, workflow
  // statuses) — which is exactly why gating this grid on that code was wrong.
  projectAdmin: ['project:view', 'project:edit', 'project:manage_members', 'portfolio:view'],
  // An Editor: the delivery codes and nothing structural.
  editor: ['project:view', 'work_item:view', 'work_item:edit', 'iteration:view'],
}

function signIn(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 'u-1',
      email: 'reader@qnsc.dev',
      displayName: 'Reader',
      locale: 'en',
      timezone: 'UTC',
      role: 'member',
      permissions,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    isAuthenticated: true,
    isLoading: false,
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<ProjectsPage />, { wrapper })
}

/** Click the Name cell and report whether an edit input opened. */
async function nameOpensAnEditor(): Promise<boolean> {
  await userEvent.click(screen.getByText(PROJECT.name))
  return screen.queryByRole('textbox', { name: 'Name' }) !== null
}

beforeEach(() => {
  localStorage.clear()
  calls.update.mockClear()
  calls.del.mockClear()
  calls.link.mockClear()
  calls.unlink.mockClear()
})

describe('Projects list — a mutating cell renders only for the code its route requires', () => {
  it('an EDITOR gets no Teams control, and still sees the linked team (Read-only, not Hidden)', async () => {
    signIn(PRINCIPAL.editor)
    renderPage()

    // §3.1:64 — team membership is Workspace Admin's alone. The picker used to be live here and
    // `POST /projects/:id/teams` answered 403 after the click.
    expect(screen.queryByRole('button', { name: 'Teams' })).toBeNull()
    // …but the DATA stays: §3.1:70 gives an Editor a read-only view of the Project's Teams.
    expect(screen.getByText('Team Alpha')).toBeInTheDocument()
    expect(calls.link).not.toHaveBeenCalled()
    expect(calls.unlink).not.toHaveBeenCalled()
  })

  it('a per-project ADMIN sees Name read-only — `project:edit` is not `workspace:edit`', async () => {
    signIn(PRINCIPAL.projectAdmin)
    renderPage()

    expect(await nameOpensAnEditor()).toBe(false)
    // Read-only, so the name is still the cell's content.
    expect(screen.getByText(PROJECT.name)).toBeInTheDocument()
    expect(calls.update).not.toHaveBeenCalled()
  })

  it.each([
    ['a per-project ADMIN', PRINCIPAL.projectAdmin],
    ['an EDITOR', PRINCIPAL.editor],
  ])('%s gets NO inline editor on this grid, because it has no write', async (_who, perms) => {
    signIn(perms)
    renderPage()

    // The whole defect in one assertion: not one of the six controls may render enabled for a
    // principal whose `onPatch` is `undefined` and whose link/unlink the server refuses.
    for (const label of PICKER_LABELS) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }
    expect(await nameOpensAnEditor()).toBe(false)
    expect(calls.update).not.toHaveBeenCalled()

    // Every value is still on screen — the BA's Read-only state, not Hidden.
    expect(screen.getByText(PROJECT.name)).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('2026-01-05')).toBeInTheDocument()
    expect(screen.getByText('2026-06-30')).toBeInTheDocument()
  })

  it('a WORKSPACE ADMIN keeps all six editors — the negative control for the two cases above', async () => {
    signIn(PRINCIPAL.workspaceAdmin)
    renderPage()

    for (const label of PICKER_LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(await nameOpensAnEditor()).toBe(true)
  })
})
