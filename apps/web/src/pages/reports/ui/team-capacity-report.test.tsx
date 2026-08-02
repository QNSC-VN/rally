/**
 * Team Capacity report — the cross-screen consistency contract with Team Status.
 *
 * These assertions exist because the report drifted from Team Status while sharing its
 * primitives: body cells omitted the `px-2` the shared header and totals row both apply, so
 * every number sat ~8px right of its own column, and a failed request rendered the "no capacity
 * planned" empty state — a data conclusion drawn from a network fault.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@/features/iterations/api', () => ({
  useIterations: () => ({ data: [{ id: 'it-1', name: 'Sprint 26.1' }] }),
}))

import { apiClient } from '@/shared/api/http-client'
import { TeamCapacityReport } from './team-capacity-report'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const REPORT = {
  projectId: 'p-1',
  teamId: 'all',
  context: { projectName: 'NXP', teamName: 'All Teams' },
  iteration: { id: 'it-1', name: 'Sprint 26.1', startDate: '2026-07-01', endDate: '2026-07-14' },
  hasCapacity: true,
  hasTaskHours: true,
  totals: { capacityHours: 178, estimateHours: 96, todoHours: 40, actualHours: 61 },
  teams: [
    {
      id: 't-1',
      name: 'Core Platform',
      totals: { capacityHours: 178, estimateHours: 96, todoHours: 40, actualHours: 61 },
      members: [
        {
          id: 'u-1',
          name: 'Marcus Webb',
          hours: { capacityHours: 96, estimateHours: 60, todoHours: 25, actualHours: 40 },
        },
      ],
    },
  ],
}

function renderReport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<TeamCapacityReport projectId="p-1" teamId={undefined} />, { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('TeamCapacityReport', () => {
  it('pads and monospaces every hour cell, matching the shared header and totals row', async () => {
    mockGET.mockResolvedValue({ data: REPORT, error: undefined, response: { status: 200 } })
    renderReport()

    // The member row's four hour cells are the ones that were misaligned. Scope to that row —
    // `96h` is also this member's Capacity indicator up in the MetricStrip.
    const memberName = await screen.findByText('Marcus Webb')
    const memberRow = memberName.closest<HTMLElement>('div.flex.h-8')!
    const cell = within(memberRow).getByText('96h').closest<HTMLElement>('div')!

    // `px-2` is the shared header's per-column padding; without it the digits sat right of
    // their own header label. `font-mono`/`tabular-nums` is NUMERIC_CELL_CLASS — the totals
    // row already monospaces right-aligned columns, so anything else split one column's font.
    expect(cell.className).toContain('px-2')
    expect(cell.className).toContain('font-mono')
    expect(cell.className).toContain('tabular-nums')
    expect(cell.className).toContain('text-right')
  })

  it('renders the error state, not the "no capacity planned" empty state, when the query fails', async () => {
    mockGET.mockResolvedValue({
      data: undefined,
      error: { message: 'boom' },
      response: { status: 500 },
    })
    renderReport()

    // i18n is not initialised under test, so `t()` yields the raw key — assert on that rather
    // than on English copy, which would make this test a translation-file change detector.
    await waitFor(() => expect(screen.getByText('capacity.error.title')).toBeInTheDocument())
    // The bug: a network fault rendering as a statement about the data.
    expect(screen.queryByText('capacity.empty.noCapacity')).not.toBeInTheDocument()
    expect(screen.queryByText('capacity.empty.neither')).not.toBeInTheDocument()
  })

  it('keeps the header, iteration picker and totals mounted while loading', async () => {
    mockGET.mockReturnValue(new Promise(() => {}))
    renderReport()

    // Chrome must not blank out on load — that was the chart reports' early-return skeleton.
    expect(screen.getByText('capacity.title')).toBeInTheDocument()
    expect(screen.getByText('capacity.source')).toBeInTheDocument()
  })
})
