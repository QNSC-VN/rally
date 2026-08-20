/**
 * Project detail — the same rule as the list, one level up.
 *
 * `canManage` was `can('project:edit')`, and every control it opens is a `PATCH /projects/:id` field
 * (name, description, lead, dates, status) or a `POST|DELETE /projects/:id/teams` link — all three
 * routes gated `workspace:edit`
 * (`libs/modules/projects/src/interface/http/projects.controller.ts:276,505,520`). `project:edit` is
 * a PROJECT-tier code a per-project Admin holds for label and workflow-status configuration, so this
 * page handed that level six editable fields the server refuses, on the very row the BA marks
 * "View Project Details and Teams | Edit | Read-only | Read-only, scoped | Hidden"
 * (`Phase 4/02_Roles_Permissions/SRS.md:70`, with project edit Hidden at `:68`).
 *
 * i18n is not initialised under test, so every `aria-label` here is the raw KEY — assert on the key,
 * per the convention the other page tests follow.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ projectKey: 'NXP' }),
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

// This suite does not exercise back navigation; the hook needs the real router (`useRouter` /
// `useCanGoBack`), which the mock above deliberately does not provide. Its own behaviour is covered
// by `shared/lib/use-detail-back.test.tsx`.
vi.mock('@/shared/lib/use-detail-back', () => ({ useDetailBack: () => vi.fn() }))

vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({ workspace: { workspaceId: 'ws-1', workspaceName: 'QNSC' } }),
}))

// Tiptap owns real DOM through ProseMirror; the subject here is the GATE, so the editor is stubbed
// down to the one thing this test cares about — whether it was told to be read-only.
vi.mock('@/shared/ui/rich-text-editor', () => ({
  RichTextEditor: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="description" data-readonly={String(!!readOnly)} />
  ),
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

const calls = { update: vi.fn(), link: vi.fn(), unlink: vi.fn() }

vi.mock('@/features/projects/api', () => ({
  useProjects: () => ({ data: [PROJECT], isLoading: false, isError: false, isLoadingMore: false }),
  useUpdateProject: () => ({ mutateAsync: calls.update, isPending: false }),
  useProjectActivityLog: () => ({ data: [], isLoading: false, isError: false }),
}))

vi.mock('@/features/teams/api', () => ({
  useProjectMemberOptions: () => ({ data: [] }),
  useProjectTeams: () => ({ data: [{ id: 't-1', key: 'ALP', name: 'Team Alpha' }] }),
  useWorkspaceTeams: () => ({ data: [{ id: 't-1', key: 'ALP', name: 'Team Alpha' }] }),
  useLinkProjectTeam: () => ({ mutate: calls.link }),
  useUnlinkProjectTeam: () => ({ mutate: calls.unlink }),
}))

import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { ProjectDetailPage } from './projects-detail-page'

/**
 * Raw i18n keys, because no instance is initialised under test — except End Date, whose call site
 * passes a defaultValue (`t('detail.endDate', 'End Date')`), which `t` returns instead of the key.
 */
const FIELD_LABELS = [
  'fields.lead',
  'detail.startDate',
  'End Date',
  'common:status',
  'fields.teams',
] as const

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
  return render(<ProjectDetailPage />, { wrapper })
}

beforeEach(() => {
  calls.update.mockClear()
  calls.link.mockClear()
  calls.unlink.mockClear()
})

describe('Project detail — structural fields need `workspace:edit`, not `project:edit`', () => {
  it('a per-project ADMIN sees every field read-only, and the values are all still there', () => {
    signIn(['project:view', 'project:edit', 'project:manage_members', 'portfolio:view'])
    renderPage()

    // The name was an editable header input for this level, wired to a write it cannot make.
    expect(screen.queryByRole('textbox', { name: 'common:name' })).toBeNull()
    for (const label of FIELD_LABELS) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }
    expect(screen.getByTestId('description')).toHaveAttribute('data-readonly', 'true')

    // Read-only, not Hidden (`P3_RBAC_AND_SYSTEM_STATES.md:34`).
    expect(screen.getByText(PROJECT.name)).toBeInTheDocument()
    expect(screen.getByText('Team Alpha')).toBeInTheDocument()
  })

  it('a WORKSPACE ADMIN keeps them editable — the negative control', () => {
    signIn(['workspace:*'])
    renderPage()

    expect(screen.getByRole('textbox', { name: 'common:name' })).toBeInTheDocument()
    for (const label of FIELD_LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByTestId('description')).toHaveAttribute('data-readonly', 'false')
  })
})
