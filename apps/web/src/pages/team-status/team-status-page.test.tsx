/**
 * Team Status — the read-only contract, and the one progress formula (P23-14).
 *
 * Two defects are pinned here. The grid offered inline editors for Estimate, ToDo, Actuals and
 * Owner, which the SRS makes reads on this surface: §9.3's patch accepts "`title` and/or `state`",
 * §11's editable columns are Capacity / Task Name / Task State, FR-026 SHOWS the hours and FR-027
 * DISPLAYS the owner. (They stay editable on the Task Dashboard — Work Item Detail › Tasks tab,
 * FR-038 — which writes through the work-item route.) And the member progress bar switched FORMULA
 * under the State filter: hours-burned unfiltered, completed-task-COUNT filtered.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({ project: { projectId: 'p-1' }, team: { teamId: 't-1' } }),
}))

// Full edit rights, deliberately: a read-only field must be read-only for the MOST privileged
// caller, or the assertion only proves the permission gate works.
vi.mock('@/features/access/api', () => ({
  useProjectPermissions: () => ({ can: () => true }),
}))

vi.mock('@/features/iterations/api', () => ({
  useIterations: () => ({
    data: [
      {
        id: 'it-1',
        name: 'Sprint 26.1',
        teamId: 't-1',
        startDate: '2026-07-01',
        endDate: '2026-07-14',
        state: 'committed',
      },
    ],
  }),
}))

import { apiClient } from '@/shared/api/http-client'
import { TeamStatusPage } from './team-status-page'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

/**
 * Alice owns two tasks. The numbers are chosen so the two candidate progress formulas DISAGREE
 * under the filter: over the Completed task alone, hours give 3/6 = 50% while the completed-count
 * ratio gives 1/1 = 100%. Unfiltered, the server's own §10 value is 3/10 = 30%.
 */
const TEAM_STATUS = {
  projectId: 'p-1',
  teamId: 't-1',
  iteration: { id: 'it-1', name: 'Sprint 26.1', startDate: '2026-07-01', endDate: '2026-07-14' },
  totals: { capacityHours: 40, estimateHours: 10, todoHours: 7, actualHours: 3 },
  groups: [
    {
      owner: { id: 'u-1', displayName: 'Alice Smith', avatarUrl: null },
      capacityHours: 40,
      taskCount: 2,
      estimateHours: 10,
      todoHours: 7,
      actualHours: 3,
      progressPercent: 30,
      tasks: [
        {
          id: 'ta-1',
          taskKey: 'TA-1',
          title: 'DEV - wire SSO',
          displayName: 'DEV - wire SSO',
          workProduct: { id: 's-1', key: 'US-1', type: 'Story', title: 'Auth', status: 'accepted' },
          release: null,
          state: 'Completed',
          estimateHours: 6,
          todoHours: 5,
          actualHours: 3,
          owner: { id: 'u-1', displayName: 'Alice Smith', avatarUrl: null },
          rank: 'a1',
        },
        {
          id: 'ta-2',
          taskKey: 'TA-2',
          title: 'QA - regression pass',
          displayName: 'QA - regression pass',
          workProduct: { id: 's-1', key: 'US-1', type: 'Story', title: 'Auth', status: 'accepted' },
          release: null,
          state: 'Defined',
          estimateHours: 4,
          todoHours: 2,
          actualHours: 0,
          owner: { id: 'u-1', displayName: 'Alice Smith', avatarUrl: null },
          rank: 'a2',
        },
      ],
    },
  ],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<TeamStatusPage />, { wrapper })
}

/** Expand Alice's member group so her task rows render. */
async function expandAlice() {
  const member = await screen.findByText('Alice Smith')
  fireEvent.click(member)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockGET.mockResolvedValue({ data: TEAM_STATUS, error: undefined, response: { status: 200 } })
})

describe('Team Status read-only fields', () => {
  it('opens an editor for Task Name but NOT for Estimate, ToDo or Actuals', async () => {
    const { container } = renderPage()
    await expandAlice()
    await screen.findByText('DEV - wire SSO')

    /**
     * `.inline-edit-cell` is the hover affordance `InlineEditableCell` adds only when the cell is
     * editable, so counting it counts the editors on screen. Expected: the member group's Capacity
     * (FR-017) plus one Task Name per task row (FR-019) — three. It was seven: each task row also
     * carried Estimate, ToDo and Actuals.
     */
    expect(container.querySelectorAll('.inline-edit-cell')).toHaveLength(3)

    // The Task State dropdown stays (FR-021/AC-17); the Owner picker is gone (FR-027).
    expect(screen.getAllByRole('combobox', { name: 'Task state' })).toHaveLength(2)
    expect(screen.queryByRole('combobox', { name: /owner/i })).toBeNull()
  })

  it('renders the hours as values, not inputs, and never as a zero it cannot prove', async () => {
    renderPage()
    await expandAlice()
    await screen.findByText('DEV - wire SSO')

    // The numbers are still THERE — read-only is not invisible.
    expect(screen.getByText('6')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    // Clicking a value opens nothing: with the editors in place this rendered an
    // <input aria-label="Estimate hours">.
    fireEvent.click(screen.getByText('6'))
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('the member progress bar keeps ONE formula under a filter', () => {
  it('shows the §10 hours ratio unfiltered', async () => {
    renderPage()
    expect(await screen.findByText('30%')).toBeTruthy()
  })

  it('re-measures the SAME formula over the filtered rows — not a task count', async () => {
    renderPage()
    await screen.findByText('30%')

    // The State filter lives behind the shared toolbar's Filters disclosure (FR-007A).
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    fireEvent.change(await screen.findByLabelText('Filter by task state'), {
      target: { value: 'Completed' },
    })

    // 3 actual / 6 estimate over the one visible task. The count ratio the page used to switch to
    // would read 100% — one Completed task out of one visible.
    await waitFor(() => expect(screen.getByText('50%')).toBeTruthy())
    expect(screen.queryByText('100%')).toBeNull()
  })
})
