/**
 * Release Detail — the right panel's SCOPE contract, and deep linking (`P01-06`).
 *
 * Scope: P3-REL-FR-023 forbids a Task Roll-up, Burndown or any other release progress widget here,
 * FR-024 puts accepted/progress totals in `Portfolio > Release Tracking` alone, FR-037 keeps a
 * progress column/widget off the Phase 3 list/detail, and AC #10 lists the panel's fields
 * exhaustively: Start Date, Release Date, Project, State, Planned Velocity, Plan Estimate, Version.
 * The API still serves `taskRollup` (its Estimate hours are the list's `taskEstimate` column), so
 * the fixture below deliberately KEEPS the field — a page that renders nothing from a payload that
 * still carries it is the property under test.
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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), PUT: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ releaseId: 'r-pay' }),
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}))

// This suite does not exercise back navigation; the hook needs the real router (`useRouter` /
// `useCanGoBack`), which the mock above deliberately does not provide. Its own behaviour is covered
// by `shared/lib/use-detail-back.test.tsx`.
vi.mock('@/shared/lib/use-detail-back', () => ({ useDetailBack: () => vi.fn() }))
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
  plannedVelocity: 42,
  planEstimate: 24,
  taskEstimate: 18.5,
  releasedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  // Non-zero on purpose. The BA's retest saw `Estimate 0h / To Do 0h / Actual 0h / Accepted 0`,
  // and zeroes would let a still-rendered panel pass every assertion below by coincidence.
  taskRollup: { estimateHours: 18.5, toDoHours: 6, actualHours: 12.5, acceptedItems: 3 },
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

describe('the right panel is METADATA ONLY (P3-REL-FR-023/024/037, AC #10)', () => {
  async function renderDetails() {
    render(<ReleaseDetailPage />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('detailPage.metadataTitle')).toBeInTheDocument())
  }

  it('renders no Task Roll-up section, and none of its hour values', async () => {
    await renderDetails()

    expect(screen.queryByText(/task roll-?up/i)).not.toBeInTheDocument()
    expect(screen.queryByText('detailPage.rollup.title')).not.toBeInTheDocument()
    for (const hours of ['18.5h', '6h', '12.5h']) {
      expect(screen.queryByText(hours)).not.toBeInTheDocument()
    }
  })

  it('renders no Accepted total and no progress widget (FR-024, FR-037)', async () => {
    const { container } = render(<ReleaseDetailPage />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('detailPage.metadataTitle')).toBeInTheDocument())

    expect(screen.queryByText(/accepted/i)).not.toBeInTheDocument()
    expect(screen.queryByText('detailPage.rollup.accepted')).not.toBeInTheDocument()
    // The Accepted count itself — `3` from the fixture — must appear nowhere on the panel.
    expect(screen.queryByText('3')).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('renders no Burndown series or table — release progress is Phase 6, not Phase 3.2', async () => {
    await renderDetails()

    expect(screen.queryByText(/burndown/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // FR-023's own reader: nothing on this page may fetch a release progress series.
    const fetched = mockGET.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(fetched.some((p) => p.includes('burndown'))).toBe(false)
    expect(fetched.some((p) => p.includes('snapshot'))).toBe(false)
  })

  it('still renders every AC #10 metadata field', async () => {
    await renderDetails()

    // Project and State. `PAY` arrives with its own `/v1/projects/{id}` response.
    await waitFor(() => expect(screen.getByText('PAY')).toBeInTheDocument())
    expect(screen.getByLabelText('detailPage.lifecycleState')).toBeInTheDocument()
    // Start Date / Release Date. `DateField` is a popover trigger, not an <input>, so the value
    // is the trigger's TEXT.
    expect(screen.getByText('2026-08-01')).toBeInTheDocument()
    expect(screen.getByText('2026-09-01')).toBeInTheDocument()
    // Planned Velocity / Plan Estimate.
    expect(screen.getByDisplayValue('42')).toBeInTheDocument()
    expect(screen.getByDisplayValue('24')).toBeInTheDocument()
    // Their labels, and Version's.
    for (const label of [
      'detail.startDateLabel',
      'detail.releaseDateLabel',
      'detail.plannedVelocityLabel',
      'detail.planEstimateLabel',
      'detailPage.versionTag',
      'detailPage.projectScope',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('still opens Details / Artifacts / Revision History', async () => {
    await renderDetails()

    fireEvent.click(screen.getByRole('tab', { name: 'detailPage.tabs.artifacts' }))
    expect(screen.queryByText('detailPage.metadataTitle')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Revision History' }))
    expect(screen.queryByText('detailPage.metadataTitle')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'detailPage.tabs.details' }))
    expect(screen.getByText('detailPage.metadataTitle')).toBeInTheDocument()
  })
})
