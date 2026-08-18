/**
 * Backlog Manage Filters — the chosen columns reach the SERVER, and quick search stays independent.
 *
 * The two named test cases:
 *
 *  • `P2-BL-TS-014` — "Select Name and Owner in Manage Filters, apply both values → Result matches
 *    both filter conditions." Asserted here as the request the grid issues: both predicates on ONE
 *    query. The matching itself is proven in `test/e2e/manage-filters.e2e.spec.ts`, against SQL.
 *  • `P2-BL-TS-015` — "Search work by `US-4821` while filters are open → Quick search still works
 *    independently from Manage Filters." Asserted in both directions: the search reaches the server
 *    as `q` while filters are applied, and applying filters does not clear the search.
 *
 * Why the assertion is on the QUERY and not on the rows: the defect class this closes is a filter
 * that narrows the fetched page instead of the query. A test that renders three rows and counts two
 * cannot tell those apart — a client-side filter passes it. What distinguishes them is whether the
 * predicate left the browser.
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

// Full rights, deliberately: the filters must work for the most privileged caller, or the assertion
// only proves the permission gate.
vi.mock('@/features/access/api', () => ({
  useProjectPermissions: () => ({ can: () => true }),
}))

// Partial mocks — these slices export more than the page uses, and the shared bulk-action components
// the page renders import from them too.
vi.mock('@/features/teams/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useProjectMembers: () => ({ data: [{ userId: 'u-1', displayName: 'Marcus Webb' }] }),
}))

vi.mock('@/features/releases/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useReleases: () => ({ data: [{ id: 'rel-1', name: 'Q4 2024', releaseKey: 'RL-1' }] }),
}))

vi.mock('@/features/iterations/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // Both compact feeds: `/options` is REFERENCE (resolves a name) and `/assignable` is ELIGIBILITY
  // (what the filter and the inline writes may offer — every state since P6-VEL-004).
  useIterationOptions: () => ({ data: [] }),
  useAssignableIterations: () => ({ data: [] }),
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { BacklogPage } from './backlog-page'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const EMPTY_PAGE = {
  data: { data: [], pageInfo: { hasNextPage: false, nextCursor: null, limit: 25, total: 0 } },
  error: undefined,
  response: { status: 200 },
}

/** Query object of the most recent backlog request. */
function lastBacklogQuery(): Record<string, unknown> {
  const calls = mockGET.mock.calls.filter((c) => c[0] === '/v1/work-items/backlog')
  expect(calls.length, 'the backlog list was requested').toBeGreaterThan(0)
  return (calls[calls.length - 1][1] as { params: { query: Record<string, unknown> } }).params.query
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(<BacklogPage />, { wrapper })
}

/** Reveal the filter banner — `PageToolbar` collapses it while no filter is active. */
const openBanner = () => fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
const openChooser = () => fireEvent.click(screen.getByRole('button', { name: /Manage Filters/ }))

beforeEach(() => {
  vi.clearAllMocks()
  // Path-aware, because the assignee feed is an ARRAY while every other route here is paged. A single
  // `mockResolvedValue` handed `{ data: { data: [] } }` to `members.map` and the page threw. The feed
  // also has to CONTAIN the member the Owner filter selects, since its options are built from it.
  mockGET.mockImplementation((path: string) => {
    if (path === '/v1/projects/{id}/member-options') {
      return Promise.resolve({
        data: [{ userId: 'u-1', displayName: 'Dev One', email: 'dev@qnsc.dev', avatarUrl: null }],
        error: undefined,
        response: { status: 200 },
      })
    }
    return Promise.resolve(EMPTY_PAGE)
  })
})

describe('Backlog Manage Filters', () => {
  it('P2-BL-TS-014: Name and Owner are applied together, on one server query', async () => {
    renderPage()
    await waitFor(() => expect(mockGET).toHaveBeenCalled())
    // Nothing is filtered before the user chooses anything.
    expect(lastBacklogQuery().title).toBeUndefined()

    openBanner()
    openChooser()
    // Checkbox column selection (FR-020): Name is offered but not visible by default.
    fireEvent.click(screen.getByLabelText('Filter by Name'))

    fireEvent.change(screen.getByLabelText('Name filter value'), { target: { value: 'SSO' } })
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-1' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0])

    await waitFor(() => expect(lastBacklogQuery().title).toBe('SSO'))
    // BOTH conditions on the same request — the "combine" half of AC-7.
    expect(lastBacklogQuery().assigneeId).toBe('u-1')
  })

  it('sends no predicate for a column until Apply (AC-7)', async () => {
    renderPage()
    await waitFor(() => expect(mockGET).toHaveBeenCalled())

    openBanner()
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-1' } })

    // Still nothing: a control that queried on change would make Apply meaningless and re-fetch on
    // every keystroke of the text filters beside it.
    expect(lastBacklogQuery().assigneeId).toBeUndefined()
  })

  it('P2-BL-TS-015: quick search still works while Manage Filters values are applied', async () => {
    renderPage()
    await waitFor(() => expect(mockGET).toHaveBeenCalled())

    openBanner()
    // The Owner control's options come from the assignee FEED, which is its own query — so wait for the
    // option to exist before selecting it. `TS-014` above happens to be immune because opening the
    // chooser and ticking a checkbox re-renders after that query lands; relying on that would make this
    // test pass for an incidental reason.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Dev One' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Owner filter value'), { target: { value: 'u-1' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0])
    await waitFor(() => expect(lastBacklogQuery().assigneeId).toBe('u-1'))

    fireEvent.change(screen.getByLabelText('Search backlog'), { target: { value: 'US-4821' } })

    // Quick search reaches the server as its OWN parameter, and the applied filter survives it —
    // independent in both directions, not one replacing the other.
    await waitFor(() => expect(lastBacklogQuery().q).toBe('US-4821'))
    expect(lastBacklogQuery().assigneeId).toBe('u-1')
  })

  it('quick search is not a Manage Filters column, so Apply cannot swallow it', async () => {
    renderPage()
    await waitFor(() => expect(mockGET).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Search backlog'), { target: { value: 'US-4821' } })
    await waitFor(() => expect(lastBacklogQuery().q).toBe('US-4821'))

    openBanner()
    openChooser()
    // The chooser lists the filter COLUMNS. Quick search must not be among them — it is toolbar
    // state with its own parameter (P2-BL-FR-003, P2-IS-FR-020).
    expect(screen.queryByLabelText(/Filter by Search/)).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0])
    await waitFor(() => expect(lastBacklogQuery().q).toBe('US-4821'))
  })
})
