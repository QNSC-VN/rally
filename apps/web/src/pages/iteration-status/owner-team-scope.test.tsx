/**
 * Iteration Status — the inline Owner / Dev Owner pickers are scoped to the ROW's Team.
 *
 * `Phase 2/03_Iteration_Status/SRS.md:435` (= Backlog AC-16, `Phase 2/01_Backlog_Enhancement/
 * SRS.md:336`): "Owner must be `Unassigned` or an active member of the Work Item Team; a `No team` Work
 * Item allows only `Unassigned`." This grid fed both pickers the whole PROJECT while the server refuses
 * anyone outside the item's team (`ASSIGNEE_NOT_TEAM_MEMBER`) — it offered people the write rejects.
 *
 * Three properties, because closing this narrowing wrong is how the two documented traps get reached:
 * the roster comes from the ROW's own team (never the selected iteration's, which names no team on a
 * shared sprint), a team-less row offers only `Unassigned`, and an owner who has LEFT the team is still
 * NAMED — `searchable-select` resolves its trigger label by looking the value up in the options, so a
 * narrowing that forgets the current owner reprints a genuinely-owned row as `Unassigned`.
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

const teamOwnerOptions = vi.fn()

vi.mock('@/features/teams/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // The project-wide feed stays the id→NAME source and always holds BOTH people, so a narrowed picker
  // can only have come from `useTeamOwnerOptions`.
  useProjectMemberOptions: () => ({ data: [ALICE, BRUNO] }),
  useProjectMembers: () => ({ data: [ALICE, BRUNO] }),
  useTeamOwnerOptions: (...args: unknown[]) => teamOwnerOptions(...args),
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { IterationStatusPage } from './iteration-status-page'

const ALICE = { userId: 'u-alice', displayName: 'Alice Smith', email: 'alice@qnsc.dev' }
/** A project member who is on NO team — the person the rule withholds. */
const BRUNO = { userId: 'u-bruno', displayName: 'Bruno Beta', email: 'bruno@qnsc.dev' }

/** A SHARED sprint: `teamId: null`, the shape 195 of 206 local iterations have. */
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

const METRICS = {
  plannedVelocityPercent: 0,
  acceptedPoints: 0,
  plannedVelocity: 47,
  acceptedPercent: 0,
  totalPlanEstimate: 0,
  daysLeft: 6,
  defectCount: 0,
  taskCount: 0,
  activeTaskCount: 0,
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'wi-1',
  itemKey: 'US-1',
  type: 'story',
  title: 'Wire SSO',
  scheduleState: 'in_progress',
  iterationId: 'it-1',
  isBlocked: false,
  blockedReason: null,
  planEstimate: 3,
  taskEstimate: 0,
  toDo: 0,
  actual: 0,
  taskTotal: 0,
  taskDone: 0,
  assigneeId: null,
  devOwnerId: null,
  teamId: 'team-1',
  rank: 'a1',
  featureId: null,
  featureKey: null,
  featureTitle: null,
  defectCount: 0,
  openDefectCount: 0,
  milestones: [],
  ...over,
})

let items: ReturnType<typeof row>[] = []

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  items = [row()]
  teamOwnerOptions.mockReturnValue({ data: [ALICE] })
  mockGET.mockImplementation((path: string) => {
    const ok = (data: unknown) =>
      Promise.resolve({ data, error: undefined, response: { status: 200 } })
    if (path === '/v1/iterations/options') return ok([ITERATION])
    if (path === '/v1/iterations/{id}/status') {
      return ok({
        iteration: ITERATION,
        metrics: METRICS,
        items,
        pageInfo: { hasNextPage: false, nextCursor: null, limit: 100 },
      })
    }
    // Every remaining feed the chrome asks for is a bare ARRAY (milestone options, assignable
    // iterations, member options); an object here reaches a `.map` and the page throws.
    return ok([])
  })
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(<IterationStatusPage />, { wrapper })
}

/**
 * The trigger only exists once the status read-model has resolved AND the grid has mounted its rows, so
 * every lookup here is a `find*` with a generous timeout — the whole page is under test, and the default
 * 1s window is a load-dependent race rather than a property of the code.
 */
const findRowButton = (name: 'Owner' | 'Dev owner') =>
  screen.findByRole('button', { name }, { timeout: 5000 })

const openPicker = async (name: 'Owner' | 'Dev owner') => {
  const trigger = await findRowButton(name)
  fireEvent.click(trigger)
  return trigger
}

describe("Iteration Status Owner picker is scoped to the row's Team (SRS:435)", () => {
  it("offers the ROW's team roster, not the project — keyed on the item's own teamId", async () => {
    renderPage()

    // The ROW's team, not the iteration's: this iteration deliberately carries `teamId: null`, so a
    // picker narrowed by the selected timebox would have asked for `null` and offered nothing.
    await waitFor(() => expect(teamOwnerOptions).toHaveBeenCalledWith('p-1', 'team-1'), {
      timeout: 5000,
    })
    expect(teamOwnerOptions).not.toHaveBeenCalledWith('p-1', null)

    await openPicker('Owner')
    expect(screen.queryByText('Alice Smith')).toBeTruthy()
    // On the project, on no team — withheld, because the server would refuse the write.
    expect(screen.queryByText('Bruno Beta')).toBeNull()
  })

  it('narrows Dev Owner the same way', async () => {
    renderPage()
    await openPicker('Dev owner')

    expect(screen.queryByText('Alice Smith')).toBeTruthy()
    expect(screen.queryByText('Bruno Beta')).toBeNull()
  })

  it('offers only Unassigned for a `No team` row', async () => {
    items = [row({ teamId: null })]
    // `useTeamOwnerOptions` never fetches without a team — the rule lives in the feed, so `data` is
    // undefined and the caller's `?? []` is the empty roster the second clause asks for.
    teamOwnerOptions.mockReturnValue({ data: undefined })
    renderPage()

    await waitFor(() => expect(teamOwnerOptions).toHaveBeenCalledWith('p-1', null), {
      timeout: 5000,
    })

    await openPicker('Owner')
    // Quick Picks' "— No Entry —" is the only option left; nobody from the project is offered.
    expect(screen.queryAllByText('— No Entry —').length).toBeGreaterThan(0)
    expect(screen.queryByText('Alice Smith')).toBeNull()
    expect(screen.queryByText('Bruno Beta')).toBeNull()
  })

  it('still NAMES an owner who has left the team', async () => {
    // Bruno owns the row and is not on its team: the narrowed roster cannot resolve his label, so the
    // name has to come from the project-wide feed via `OwnerSelectCell`'s separate `ownerName` prop.
    items = [row({ assigneeId: BRUNO.userId, devOwnerId: BRUNO.userId })]
    renderPage()

    const owner = await findRowButton('Owner')
    expect(owner.textContent).toContain('Bruno Beta')
    const devOwner = await findRowButton('Dev owner')
    expect(devOwner.textContent).toContain('Bruno Beta')

    // …and he is still selectable/visible in the list as the CURRENT owner, while the offerable
    // roster stays the team's.
    fireEvent.click(owner)
    expect(screen.queryByText('Alice Smith')).toBeTruthy()
  })
})
