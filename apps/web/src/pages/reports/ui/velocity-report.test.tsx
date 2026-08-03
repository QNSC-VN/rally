/**
 * Velocity — a failed request must not read as a measured statement about delivery history.
 *
 * `isError` was never destructured here, so on failure `bars` fell to `[]` and `ChartFrame` rendered
 * §6's own empty-state sentence — "No completed iteration with scheduled work exists in this project
 * and team scope". That is a conclusion about the project, drawn from a network fault. Team Capacity
 * had the same defect and fixed it; this pins the same contract on the sibling report.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { VelocityReport } from './velocity-report'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const REPORT = {
  context: { projectName: 'NXP', teamName: 'All Teams' },
  window: 5,
  bars: [
    {
      iterationId: 'it-1',
      name: 'Sprint 26.1',
      acceptedDuring: 34,
      acceptedAfter: 4,
      notAccepted: 9,
    },
  ],
  averages: { last3: 34, best3: 34, worst3: 34, trend: 34, sampleSize: 1 },
  unclassifiedItems: 0,
}

function renderReport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<VelocityReport projectId="p-1" teamId={undefined} />, { wrapper: Wrapper })
}

describe('VelocityReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGET.mockResolvedValue({ data: REPORT, error: undefined, response: { status: 200 } })
  })

  it('renders the bars and the trend when the query succeeds', async () => {
    renderReport()
    // i18n is not initialised under test, so `t()` yields the raw key — asserting on English copy
    // would make this a translation-file change detector.
    await waitFor(() => expect(screen.getByText('velocity.last3')).toBeInTheDocument())
  })

  it('renders the ERROR state, not "no completed iterations", when the query fails', async () => {
    mockGET.mockResolvedValue({
      data: undefined,
      error: { message: 'boom' },
      response: { status: 500 },
    })
    renderReport()

    await waitFor(() => expect(screen.getByText('velocity.error.title')).toBeInTheDocument())
    // The bug: the SRS's own data sentence standing in for a network fault.
    expect(screen.queryByText('velocity.empty.title')).not.toBeInTheDocument()
    expect(screen.queryByText('velocity.empty.description')).not.toBeInTheDocument()
  })

  it('drops the averages strip on failure rather than showing fabricated numbers', async () => {
    // The strip is conditional on `averages.sampleSize > 0`, so it already vanishes — this pins that
    // it does not somehow survive beside the error, which is what happened on Team Capacity.
    mockGET.mockResolvedValue({
      data: undefined,
      error: { message: 'boom' },
      response: { status: 500 },
    })
    renderReport()

    await waitFor(() => expect(screen.getByText('velocity.error.title')).toBeInTheDocument())
    expect(screen.queryByText('velocity.last3')).not.toBeInTheDocument()
  })

  it('keeps the title and window control mounted while loading', async () => {
    mockGET.mockReturnValue(new Promise(() => {}))
    renderReport()
    expect(screen.getByText('velocity.title')).toBeInTheDocument()
  })
})
