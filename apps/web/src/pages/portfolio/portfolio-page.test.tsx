/**
 * The Project cell's MOVE destinations — offered only where the caller may actually write.
 *
 * `PortfolioItemsService.updateItem` authorises a project move in BOTH directions: the source AND
 * the destination need `portfolio:edit`, because "putting work into a project is an edit of that
 * project's portfolio". The picker was built from every READABLE project (`GET /v1/projects`, scoped
 * by `listReadableProjectIds`) with no permission filter at all — so a per-project Admin was offered
 * every project in the workspace and got a 403 from the one they chose. That is almost certainly the
 * BA's "selecting AUDIT26 returns an unexpected error" (P5-PI-003), and it is invisible to a
 * Workspace Admin, whose `workspace:*` grant covers every project.
 *
 * The principal below is deliberately an Admin of ONE project: an always-true permission mock would
 * pass against the defect.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => (typeof options === 'string' ? options : key),
  }),
}))
vi.mock('@/shared/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
  errorMessage: (e: unknown) => String(e),
}))
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({
    workspace: { workspaceId: 'ws-1', workspaceName: 'QNSC' },
    project: { projectId: 'p-nxp', projectKey: 'NXP', projectName: 'NextGen Platform' },
    team: null,
  }),
}))

/** The Feature on screen sits in NXP — the one project this caller administers. */
const FEATURE = {
  id: 'fe-1',
  projectId: 'p-nxp',
  itemKey: 'FE-1',
  type: 'feature' as const,
  name: 'Payment retries',
  state: 'no_entry',
  preliminaryEstimate: 'no_entry',
  refinedEstimate: '0',
  refinedItemCountEstimate: 0,
  parentId: null,
  parentKey: null,
  teamId: null,
  teamName: null,
  releaseId: null,
  releaseName: null,
  ownerId: null,
  ownerName: null,
  projectName: 'NextGen Platform',
  childFeatureCount: 0,
  plannedStartDate: null,
  plannedEndDate: null,
  archivedAt: null,
  rank: 'a',
  rollup: {
    rollupPoints: 0,
    rollupCount: 0,
    acceptedPoints: 0,
    acceptedCount: 0,
    completedPoints: 0,
    completedCount: 0,
  },
  progress: {
    percentDonePoints: 0,
    percentDoneCount: 0,
    estimatedPoints: 0,
    estimatedCount: 0,
    completedPoints: 0,
    completedCount: 0,
  },
  health: { status: 'green', reason: 'on_track' },
  estimate: { points: { value: 0, tier: 'none' }, count: { value: 0, tier: 'none' } },
}

vi.mock('@/features/portfolio/api', () => ({
  usePortfolioItems: () => ({ items: [FEATURE], isLoading: false, isError: false, total: 1 }),
  useRankPortfolioItem: () => ({ mutate: vi.fn() }),
  useSetPortfolioItemArchived: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePortfolioItem: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

/** Three projects the caller can READ; only NXP is one they can WRITE. */
const PROJECTS = [
  { id: 'p-nxp', key: 'NXP', name: 'NextGen Platform', status: 'active' },
  { id: 'p-audit', key: 'AUDIT26', name: 'Audit 2026', status: 'active' },
  { id: 'p-old', key: 'OLD', name: 'Retired Programme', status: 'archived' },
]
vi.mock('@/features/projects/api', () => ({ useProjects: () => ({ data: PROJECTS }) }))

vi.mock('@/features/access/api', () => ({
  useProjectPermissions: () => ({ can: () => true, permissions: [], isLoading: false }),
  useProjectPermissionsFor: () => ({
    // A per-project Admin: `portfolio:edit` in NXP, nothing anywhere else.
    can: (projectId: string | undefined, code: string) =>
      projectId === 'p-nxp' && code.startsWith('portfolio:'),
    isLoading: false,
  }),
}))
vi.mock('@/features/workspaces/api', () => ({
  useWorkspaceMemberOptions: () => ({ data: [] }),
}))
vi.mock('./model/use-cell-options', () => ({
  usePortfolioCellOptions: () => () => ({ releases: [], teams: [] }),
}))

import { PortfolioPage } from './portfolio-page'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('Portfolio grid — Project move destinations', () => {
  it('offers only projects the caller may edit, and never an archived one', async () => {
    const user = userEvent.setup()
    render(<PortfolioPage />, { wrapper: wrapper() })

    await waitFor(() => expect(screen.getByText('FE-1')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'detail.fields.project' }))

    // The destination the caller can actually write to.
    expect(await screen.findByRole('button', { name: /NextGen Platform/ })).toBeInTheDocument()
    // The BA's AUDIT26: readable, NOT writable — offering it produced the "unexpected error".
    expect(screen.queryByRole('button', { name: /Audit 2026/ })).not.toBeInTheDocument()
    // Archived projects take no new work (`PROJECT_ARCHIVED`).
    expect(screen.queryByRole('button', { name: /Retired Programme/ })).not.toBeInTheDocument()
  })
})
