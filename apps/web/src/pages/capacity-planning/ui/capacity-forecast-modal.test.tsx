import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { CapacityForecastModal } from './capacity-forecast-modal'
import type { CapacityForecast, CapacityPlanTeam } from '@/features/capacity-planning/api'

const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>
const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>

const team = {
  id: 'pt-1',
  teamId: 'team-1',
  teamName: 'Team Alpha',
  capacity: null,
  metrics: { complete: 0, rollup: 0, estimated: 0, capacity: null, warnings: [] },
} as unknown as CapacityPlanTeam

const forecast = (over: Partial<CapacityForecast> = {}): CapacityForecast => ({
  min: 30,
  median: 45,
  max: 60,
  iterationsModelled: 3,
  samplesUsed: 6,
  historyDays: 84,
  // Sampled history is this fixture's case; the supplied-velocity branch has its own test.
  basis: 'history',
  insufficientData: null,
  ...over,
})

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

function renderModal(over: { canManage?: boolean } = {}) {
  const onClose = vi.fn()
  wrap(
    <CapacityForecastModal
      planId="plan-1"
      team={team}
      unitLabel="points"
      canManage={over.canManage ?? true}
      onClose={onClose}
    />,
  )
  return { onClose }
}

const calculate = () => fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))

describe('CapacityForecastModal', () => {
  beforeEach(() => {
    mockPOST.mockReset()
    mockPATCH.mockReset()
    mockPOST.mockResolvedValue({ data: forecast(), error: undefined })
    mockPATCH.mockResolvedValue({ data: {}, error: undefined })
  })

  it("sends Rally's defaults without making the planner choose first", async () => {
    // 100% availability and "typical" complexity are Rally's own defaults, so asking for a
    // forecast is one click.
    renderModal()
    calculate()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect(mockPOST.mock.calls[0][1]).toMatchObject({
      params: { path: { id: 'plan-1', teamId: 'team-1' } },
      body: { availabilityPct: 100, complexity: 'typical' },
    })
  })

  it('shows all THREE lines with their probabilities, not one suggested number', async () => {
    // Committing to the median means missing half the time; the spread is the answer.
    renderModal()
    calculate()

    await waitFor(() => expect(screen.getByText(/Delivered 85% of the time/)).toBeTruthy())
    expect(screen.getByText(/Delivered 50% of the time/)).toBeTruthy()
    expect(screen.getByText(/Delivered 15% of the time/)).toBeTruthy()
    expect(screen.getByText('30')).toBeTruthy()
    expect(screen.getByText('45')).toBeTruthy()
    expect(screen.getByText('60')).toBeTruthy()
  })

  it('writes NOTHING until a line is picked', async () => {
    renderModal()
    calculate()
    await waitFor(() => expect(mockPOST).toHaveBeenCalled())

    // Being shown a forecast is not the same act as adopting it.
    expect(mockPATCH).not.toHaveBeenCalled()
  })

  it('commits the chosen line through the ordinary capacity mutation', async () => {
    const { onClose } = renderModal()
    calculate()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Use' })).toHaveLength(3))

    // The conservative line, which is the first row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[0])

    await waitFor(() => expect(mockPATCH).toHaveBeenCalled())
    expect(mockPATCH.mock.calls[0][1]).toMatchObject({
      params: { path: { id: 'plan-1', teamId: 'team-1' } },
      body: { capacity: 30 },
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('calculates on a published plan but offers no way to set the value', async () => {
    // Read-only means read-only. Hiding the whole tool would withhold information that
    // changes nothing.
    renderModal({ canManage: false })
    calculate()

    await waitFor(() => expect(screen.getByText(/Delivered 50% of the time/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Use' })).toBeNull()
  })

  it('names WHY a forecast was impossible, and asks for nothing to be set', async () => {
    // "Wait a sprint" and "add the plan's dates" are different actions; only the reason
    // tells the planner which.
    mockPOST.mockResolvedValue({
      data: forecast({ insufficientData: 'no_window', samplesUsed: 6, historyDays: 84 }),
      error: undefined,
    })
    renderModal()
    calculate()

    await waitFor(() => expect(screen.getByText(/no planned start and end dates/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Use' })).toBeNull()
  })

  it('reports how little history there was, so the planner knows whether to wait', async () => {
    mockPOST.mockResolvedValue({
      data: forecast({ insufficientData: 'too_little_history', samplesUsed: 1, historyDays: 7 }),
      error: undefined,
    })
    renderModal()
    calculate()

    await waitFor(() => expect(screen.getByText(/Less than 14 days/)).toBeTruthy())
    expect(screen.getByText(/1 finished iterations, 7 days/)).toBeTruthy()
  })

  it('rejects an out-of-range availability before calling the API', async () => {
    renderModal()
    fireEvent.change(screen.getByLabelText(/Team availability/), { target: { value: '0' } })
    calculate()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(mockPOST).not.toHaveBeenCalled()
  })

  it('surfaces an API failure instead of leaving the dialog silent', async () => {
    mockPOST.mockResolvedValue({
      data: undefined,
      error: { message: 'Boom' },
      response: { status: 500 },
    })
    renderModal()
    calculate()

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
