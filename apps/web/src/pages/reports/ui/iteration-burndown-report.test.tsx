/**
 * Iteration Burndown — a failed request must not read as a measured statement about the sprint.
 *
 * `isError` was never destructured here, so on failure `data` stayed undefined and the report fell
 * through to `burndown.empty.noHistory` — "no daily history has been recorded". That is a claim about
 * what was measured during the iteration, drawn from a network fault. §5 makes only MISSING SNAPSHOTS
 * unavailable, and a 500 is not a missing snapshot.
 *
 * Third instance of one shape: Velocity and Team Capacity had it and fixed it. This pins the contract
 * on the last report that still had it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { IterationBurndownReport } from './iteration-burndown-report'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const ITERATIONS = [
  { id: 'it-1', name: 'Sprint 26.1', state: 'committed', projectId: 'p-1', teamId: null },
]

const BURNDOWN = {
  context: { projectName: 'NXP', teamName: null },
  iterationId: 'it-1',
  historyState: 'complete',
  hasScheduledWork: true,
  totalTaskEstimateAtStart: 80,
  status: 'on-track',
  partialCaptureDates: [],
  days: [{ date: '2026-08-01', remainingToDo: 80, ideal: 80 }],
}

/**
 * Two endpoints answer here — the iteration list and the burndown itself — and only the second is
 * under test. Routed by URL so a failure can be injected into the report's query while the picker
 * still populates; otherwise "no iteration selected" would mask the state being asserted.
 */
function mockRoutes({ burndownFails }: { burndownFails: boolean }) {
  mockGET.mockImplementation((url: string) => {
    if (url.includes('burndown')) {
      return burndownFails
        ? Promise.resolve({
            data: undefined,
            error: { message: 'boom' },
            response: { status: 500 },
          })
        : Promise.resolve({ data: BURNDOWN, error: undefined, response: { status: 200 } })
    }
    return Promise.resolve({
      data: { data: ITERATIONS, pageInfo: { hasNextPage: false, nextCursor: null, limit: 50 } },
      error: undefined,
      response: { status: 200 },
    })
  })
}

function renderReport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<IterationBurndownReport projectId="p-1" teamId={undefined} />, {
    wrapper: Wrapper,
  })
}

describe('IterationBurndownReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the ERROR state, not "no daily history", when the burndown query fails', async () => {
    mockRoutes({ burndownFails: true })
    renderReport()

    // i18n is not initialised under test, so `t()` yields the raw key — asserting on English copy
    // would make this a translation-file change detector.
    await waitFor(() => expect(screen.getByText('burndown.error.title')).toBeInTheDocument())

    // The bug: §5's own data sentences standing in for a network fault.
    expect(screen.queryByText('burndown.empty.noHistory')).not.toBeInTheDocument()
    expect(screen.queryByText('burndown.empty.noScheduledWork')).not.toBeInTheDocument()
  })

  it('drops the on-track verdict on failure rather than judging the sprint anyway', async () => {
    // The status pill lives in `controls`, which `ReportSurface` renders ABOVE the error slot — the
    // shape that once left four `0h` cards sitting over an error message on Team Capacity. A verdict
    // is the worst thing to keep: it is a conclusion, and there is no data behind it.
    mockRoutes({ burndownFails: true })
    renderReport()

    await waitFor(() => expect(screen.getByText('burndown.error.title')).toBeInTheDocument())
    expect(screen.queryByText('burndown.onTrack')).not.toBeInTheDocument()
    expect(screen.queryByText('burndown.behindPlan')).not.toBeInTheDocument()
  })

  it('keeps the title mounted while loading', () => {
    mockGET.mockReturnValue(new Promise(() => {}))
    renderReport()
    expect(screen.getByText('burndown.title')).toBeInTheDocument()
  })
})
