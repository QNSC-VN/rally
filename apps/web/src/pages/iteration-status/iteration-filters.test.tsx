/**
 * Iteration Status Manage Filters — the SAME shared chooser, wired to the status query.
 *
 * `P2-IS-FR-022` ("User can use Manage Filters to select multiple columns and combine filters") and
 * §5, which makes this screen inherit the Backlog list patterns rather than grow its own. So the
 * assertion that matters here is parity: the identical control, producing predicates on the SERVER
 * request for `GET /v1/iterations/:id/status`.
 *
 * This screen is where the defect was worst. Schedule State, Owner and Blocked existed on the API and
 * the page used NONE of them — it re-implemented all three in the browser over the already-fetched
 * rows, then paginated the result client-side. `P2-IS-FR-020` also states outright that quick search
 * "remains outside Manage Filters", which is asserted below.
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
  useAppContext: () => ({ project: { projectId: 'p-1' }, team: undefined }),
}))

vi.mock('@/features/access/api', () => ({
  useProjectPermissions: () => ({ can: () => true }),
}))

vi.mock('@/features/teams/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useProjectMembers: () => ({ data: [{ userId: 'u-1', displayName: 'Marcus Webb' }] }),
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { IterationStatusPage } from './iteration-status-page'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const ITERATION = {
  id: 'it-1',
  projectId: 'p-1',
  teamId: null,
  iterationKey: 'IT-1',
  name: 'Sprint 24.3',
  startDate: '2026-07-01',
  endDate: '2026-07-14',
  state: 'committed',
  plannedVelocity: 47,
  completedAt: null,
}

const STATUS = {
  iteration: ITERATION,
  metrics: {
    plannedVelocityPercent: 0,
    acceptedPoints: 0,
    plannedVelocity: 47,
    acceptedPercent: 0,
    totalPlanEstimate: 0,
    daysLeft: 6,
    defectCount: 0,
    taskCount: 0,
    activeTaskCount: 0,
  },
  items: [],
  pageInfo: { hasNextPage: false, nextCursor: null, limit: 100 },
}

/** Query object of the most recent Iteration Status request. */
function lastStatusQuery(): Record<string, unknown> {
  const calls = mockGET.mock.calls.filter((c) => c[0] === '/v1/iterations/{id}/status')
  expect(calls.length, 'the status read-model was requested').toBeGreaterThan(0)
  return (calls[calls.length - 1][1] as { params: { query: Record<string, unknown> } }).params.query
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(<IterationStatusPage />, { wrapper })
}

const openBanner = () => fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
const openChooser = () => fireEvent.click(screen.getByRole('button', { name: /Manage Filters/ }))
const apply = () => fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0])

beforeEach(() => {
  vi.clearAllMocks()
  mockGET.mockImplementation((path: string) => {
    if (path === '/v1/iterations') {
      return Promise.resolve({
        data: { data: [ITERATION], pageInfo: { hasNextPage: false, nextCursor: null } },
        error: undefined,
        response: { status: 200 },
      })
    }
    if (path === '/v1/iterations/{id}/status') {
      return Promise.resolve({ data: STATUS, error: undefined, response: { status: 200 } })
    }
    // /v1/iterations/options, /v1/milestones and anything else the chrome asks for.
    return Promise.resolve({
      data: { data: [] },
      error: undefined,
      response: { status: 200 },
    })
  })
})

describe('Iteration Status Manage Filters', () => {
  it('sends Owner and Blocked as SERVER predicates after Apply (FR-022/024)', async () => {
    renderPage()
    await waitFor(() => expect(lastStatusQuery()).toBeTruthy())
    expect(lastStatusQuery().assigneeId).toBeUndefined()

    openBanner()
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-1' } })
    fireEvent.change(screen.getByLabelText('Block filter value'), { target: { value: 'false' } })
    apply()

    await waitFor(() => expect(lastStatusQuery().assigneeId).toBe('u-1'))
    // The literal `'false'`, not omitted and not a boolean. "Not blocked" is a real predicate, and the
    // API reads the two literals rather than coercing — `Boolean('false')` is true, which used to
    // invert this exact filter. The value is carried as the wire enum end to end, so nothing converts
    // it to a boolean only for the request boundary to convert it back and risk disagreeing.
    expect(lastStatusQuery().isBlocked).toBe('false')
  })

  it('offers the text/number column filters FR-023 names', async () => {
    renderPage()
    await waitFor(() => expect(lastStatusQuery()).toBeTruthy())

    openBanner()
    openChooser()
    // ID, Name, Plan Est, Task Est and To Do — the five FR-023 makes text-style, none of which had
    // any filter at all before.
    for (const column of ['ID', 'Name', 'Plan Est', 'Task Est', 'To Do']) {
      expect(screen.getByLabelText(`Filter by ${column}`)).toBeTruthy()
    }

    fireEvent.click(screen.getByLabelText('Filter by To Do'))
    fireEvent.change(screen.getByLabelText('To Do filter value'), { target: { value: '7' } })
    apply()

    await waitFor(() => expect(lastStatusQuery().toDo).toBe('7'))
  })

  it('P2-IS-FR-020: quick search stays outside Manage Filters', async () => {
    renderPage()
    await waitFor(() => expect(lastStatusQuery()).toBeTruthy())

    openBanner()
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-1' } })
    apply()
    await waitFor(() => expect(lastStatusQuery().assigneeId).toBe('u-1'))

    fireEvent.change(screen.getByLabelText('Search work items'), { target: { value: 'US-4821' } })
    await waitFor(() => expect(lastStatusQuery().q).toBe('US-4821'))
    // Both survive together — neither control disables the other.
    expect(lastStatusQuery().assigneeId).toBe('u-1')
  })
})
