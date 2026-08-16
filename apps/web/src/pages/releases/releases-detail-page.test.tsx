/**
 * Release Detail opened by DEEP LINK — the record's own project decides everything (`P01-06`).
 *
 * `/releases/$releaseId` addresses a workspace-unique uuid, so a forwarded or bookmarked link opens
 * any release the caller can read — including one in a project they do not have selected. This page
 * asked `useProjectPermissions` about the SELECTED project and printed the SELECTED project as
 * "Project Scope", so a PAY release opened by an NXP-selected reader was labelled `NXP` and gated on
 * their NXP rights. Its own Artifacts tab already used `release.projectId` and carried a comment
 * saying why ("a release opened from a notification need not belong to the selected project") — the
 * comment was true of one of the file's four project readers and false of the other three.
 *
 * Every case here selects NXP and loads a PAY release. Selecting the release's own project would
 * pass identically against the broken code.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), PUT: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ releaseId: 'r-pay' }),
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fallback?: string) => fallback ?? k }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Rich text and the tab bodies are irrelevant here and expensive to mount.
vi.mock('@/shared/ui/rich-text-editor', () => ({
  RichTextEditor: ({ title }: { title: string }) => <div>{title}</div>,
}))
vi.mock('./ui/release-artifacts-tab', () => ({ ReleaseArtifactsTab: () => <div /> }))
vi.mock('@/entities/activity/ui/activity-history-tab', () => ({
  ActivityHistoryTab: () => <div />,
}))

/**
 * The load-bearing mock: permissions are granted on the RELEASE's project and refused on the
 * selected one, so `canManage` can only come out true if the page asked about the right project.
 * A single always-true mock would pass against the defect.
 */
const askedAbout: (string | undefined)[] = []
vi.mock('@/features/access/api', () => ({
  useProjectPermissions: (projectId: string | undefined) => {
    askedAbout.push(projectId)
    return { can: () => projectId === 'p-pay', permissions: [], isLoading: false, isError: false }
  },
}))

import { apiClient } from '@/shared/api/http-client'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { ReleaseDetailPage } from './releases-detail-page'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const RELEASE = {
  id: 'r-pay',
  workspaceId: 'ws-1',
  projectId: 'p-pay',
  releaseKey: 'RE-9',
  name: 'Payments 1.0',
  description: null,
  theme: null,
  notes: null,
  releaseNotes: null,
  version: null,
  status: 'planning',
  state: 'planning',
  startDate: '2026-08-01',
  releaseDate: '2026-09-01',
  plannedVelocity: null,
  planEstimate: null,
  taskEstimate: 0,
  releasedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  taskRollup: { estimateHours: 0, toDoHours: 0, actualHours: 0, acceptedItems: 0 },
}

const PAY = { id: 'p-pay', key: 'PAY', name: 'Payments Platform' }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  askedAbout.length = 0
  // The recipient is sitting on NXP — the state a forwarded link arrives into.
  useAppContext.setState({
    project: { projectId: 'p-nxp', projectKey: 'NXP', projectName: 'NextGen Platform' },
    team: null,
  })
  mockGET.mockImplementation((path: string) => {
    if (path === '/v1/releases/{id}')
      return Promise.resolve({ data: RELEASE, error: undefined, response: { status: 200 } })
    if (path === '/v1/projects/{id}')
      return Promise.resolve({ data: PAY, error: undefined, response: { status: 200 } })
    // Activity log and anything else the page happens to ask for.
    return Promise.resolve({ data: [], error: undefined, response: { status: 200 } })
  })
})

describe('a release deep-linked from another project', () => {
  it('shows the RELEASE’s project as the scope, never the selected one', async () => {
    render(<ReleaseDetailPage />, { wrapper: wrapper() })

    // `PAY` is the release's project; `NXP` is the one the reader had selected.
    await waitFor(() => expect(screen.getByText('PAY')).toBeInTheDocument())
    expect(screen.queryByText('NXP')).not.toBeInTheDocument()
  })

  it('resolves permissions against the RELEASE’s project', async () => {
    render(<ReleaseDetailPage />, { wrapper: wrapper() })

    await waitFor(() => expect(screen.getByDisplayValue('Payments 1.0')).toBeInTheDocument())
    // Never asked about the selected project. Both directions matter: asking about `p-nxp` would
    // lock the page for someone who can edit this release, and would ALSO unlock it for an admin of
    // `p-nxp` who cannot — every Save then 403ing to `/403`.
    expect(askedAbout).not.toContain('p-nxp')
    expect(askedAbout).toContain('p-pay')
  })

  it('renders the editable title, because the caller CAN manage this release', async () => {
    render(<ReleaseDetailPage />, { wrapper: wrapper() })

    // `canManage` is the page's whole read/write switch. Under the defect it resolved from `p-nxp`,
    // where this caller holds nothing, so the release opened permanently read-only — the name a flat
    // string instead of the editable field. (`common:name` is the i18n KEY: `t` is stubbed as
    // identity here, so the aria-label is the key rather than "Name".)
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'common:name' })).toBeInTheDocument(),
    )
  })
})
