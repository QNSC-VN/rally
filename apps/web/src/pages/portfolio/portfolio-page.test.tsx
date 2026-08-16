/**
 * The Project cell is READ-ONLY, and it still renders the project's KEY.
 *
 * This started as a permission test over the cell's move destinations: `updateItem` authorises a
 * project move in BOTH directions, the picker offered every READABLE project, and a per-project
 * Admin got a 403 from the one they chose (the BA's "selecting AUDIT26 returns an unexpected
 * error", P5-PI-003). The BA resolved it the other way — the move is GONE, `updateItem` no longer
 * accepts `projectId`, and Project is a chip. So the assertion below is the inverse of the one this
 * file opened with: no destination is offered, not even the one the caller may legally write.
 *
 * The principal is deliberately an Admin of ONE project, and two of the three projects are ones a
 * move could never have accepted anyway (unwritable, archived) — kept because they are what proves
 * the cell is inert rather than merely narrowed to a single option.
 *
 * The KEY assertion is the load-bearing half: the chip resolves it from `useProjects`, which is why
 * the page still passes `projects` down after losing the move. The portfolio DTO carries
 * `projectName` and no key, so a "tidy-up" dropping that prop would blank the chip silently.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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

describe('Portfolio grid — the Project cell', () => {
  it('renders the project KEY and offers no move destination at all', async () => {
    render(<PortfolioPage />, { wrapper: wrapper() })

    await waitFor(() => expect(screen.getByText('FE-1')).toBeInTheDocument())

    // Resolved from `useProjects`, not from the DTO, which carries only the name.
    expect(screen.getByText('NXP')).toBeInTheDocument()

    // No editor to open: the cell is not a control, so there is no trigger for one.
    expect(screen.queryByRole('button', { name: 'detail.fields.project' })).not.toBeInTheDocument()
    // And no destination, including the one project this caller COULD have written to.
    expect(screen.queryByRole('button', { name: /NextGen Platform/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Audit 2026/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retired Programme/ })).not.toBeInTheDocument()
  })
})
