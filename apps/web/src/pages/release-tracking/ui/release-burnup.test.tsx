/**
 * Release burnup — a failed request must not read as "this release has no history".
 *
 * `isError` was never destructured here, so on failure `points` fell to `[]` and `ChartFrame`
 * rendered the chart's own empty sentence as a measured claim about the release. The burnup has its
 * OWN query, separate from the tracking table's, so the page-level `isError` the table already reads
 * says nothing about it.
 *
 * Fourth and last instance of one shape across Phase 6 (Velocity, Team Capacity, Iteration Burndown
 * were the others): `data` is undefined while in flight AND after failure, so a report that branches
 * on `data` alone states something false about delivery whenever the request breaks.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { ReleaseBurnup } from './release-burnup'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const BURNUP = {
  context: { projectName: 'NXP', teamName: null },
  releaseId: 'rel-1',
  historyState: 'complete',
  idealTarget: 100,
  iterations: [],
  points: [{ date: '2026-08-01', planned: 100, accepted: 20, ideal: 20 }],
}

function renderBurnup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(
    <ReleaseBurnup
      projectId="p-1"
      teamId={undefined}
      releaseId="rel-1"
      releaseName="RE-1"
      releaseStart="2026-08-01"
      releaseEnd="2026-08-31"
      unit="points"
      totals={{ planned: 100, accepted: 20, preliminary: 0 }}
    />,
    { wrapper: Wrapper },
  )
}

describe('ReleaseBurnup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the ERROR state, not "no burnup history", when the query fails', async () => {
    mockGET.mockResolvedValue({
      data: undefined,
      error: { message: 'boom' },
      response: { status: 500 },
    })
    renderBurnup()

    // i18n is not initialised under test, so `t()` yields the raw key — asserting on English copy
    // would make this a translation-file change detector.
    await waitFor(() => expect(screen.getByText('burnup.error.title')).toBeInTheDocument())

    // The bug: the chart's own data sentence standing in for a network fault.
    expect(screen.queryByText('burnup.empty.title')).not.toBeInTheDocument()
    expect(screen.queryByText('burnup.empty.description')).not.toBeInTheDocument()
  })

  it('renders the chart, and no error, when the query succeeds', async () => {
    mockGET.mockResolvedValue({ data: BURNUP, error: undefined, response: { status: 200 } })
    renderBurnup()

    // The accessible data table is the chart's content (the SVG is `aria-hidden`), so its caption is
    // what proves the chart rendered rather than an empty or error state.
    await waitFor(() => expect(screen.getByText('burnup.tableCaption')).toBeInTheDocument())
    expect(screen.queryByText('burnup.error.title')).not.toBeInTheDocument()
  })
})
