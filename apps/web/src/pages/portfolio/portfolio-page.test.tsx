/**
 * The Project column is READ-ONLY — there is no move, so there are no destinations.
 *
 * This file used to assert the OPPOSITE: that the Project cell's move picker offered only projects
 * the caller could write to. That was the earlier answer to P5-PI-003 ("selecting AUDIT26 returns an
 * unexpected error") — a narrower option list for an editable cell. The BA's answer is stronger.
 * §3.1's field table: "Inherited from the current Project context at creation and read-only
 * afterward for both Feature and Epic"; its inline-edit line: "Project is read-only for both types".
 * So the cell offers nothing at all, and the assertion inverts: a picker appearing here is the
 * defect.
 *
 * The principal below is deliberately an Admin of ONE project. It no longer decides the Project
 * cell, but it still decides every other inline editor on the row, so the narrower mock keeps
 * proving the two are separate answers.
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

/**
 * Three projects the caller can READ; only NXP is one they can WRITE.
 *
 * Still three, even though nothing is chosen from them any more: the list is now only a
 * `projectId → key` lookup for the read-only chip, and the two extra rows are what prove a
 * regression that reintroduced a picker would have something to offer.
 */
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

describe('Portfolio grid — Project is read-only (§3.1, P5-PI-003)', () => {
  it('shows the row project as a chip and a name', async () => {
    render(<PortfolioPage />, { wrapper: wrapper() })

    await waitFor(() => expect(screen.getByText('FE-1')).toBeInTheDocument())
    // Read-only is not blank: the column still identifies the project, with the same `KeyChip`
    // glyph every other Project surface carries.
    expect(screen.getByText('NXP')).toBeInTheDocument()
    expect(screen.getByText('NextGen Platform')).toBeInTheDocument()
  })

  it('offers no Project control at all, so no destination can be chosen', async () => {
    render(<PortfolioPage />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('FE-1')).toBeInTheDocument())

    // The editable cell was a `SearchableSelect` whose trigger carried this accessible name; every
    // other inline picker on the row still does, so its absence is specific to Project.
    expect(screen.queryByRole('button', { name: 'detail.fields.project' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'detail.fields.project' })).toBeNull()
  })

  it('never offers another project as a move target, even to a click on the cell', async () => {
    const user = userEvent.setup()
    render(<PortfolioPage />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('FE-1')).toBeInTheDocument())

    // Clicking where the picker used to be must open nothing. AUDIT26 is the BA's own example of a
    // project the cell offered; `OLD` is archived and could never take work at all.
    await user.click(screen.getByText('NextGen Platform'))
    expect(screen.queryByText('Audit 2026')).toBeNull()
    expect(screen.queryByText('Retired Programme')).toBeNull()
  })
})
