/**
 * The Work Item sidebar's three "read the RECORD, not the selection" rules.
 *
 *  1. GAP-P1-WID-007 — Owner offers Unassigned plus the item's Team's ACTIVE members; with no Team it
 *     offers Unassigned only; and an owner who has since left the team is still NAMED.
 *  2. P6-E2E-003 — the Project field is the item's own project, never `useAppContext()`'s selection.
 *  3. The iteration LABEL comes from the reference feed, so an item in an accepted iteration does not
 *     render the "No Iteration" placeholder.
 *
 * Every feature module is mocked by factory rather than by spying on the HTTP client, deliberately:
 * `vi.mock` with a factory replaces the whole module, so if this component drifts back onto
 * `useProjectMemberOptions` for its OPTIONS, or onto `useAppContext` for the project, the import
 * simply is not there and the test fails hard instead of quietly rendering a wider list.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

const teamOwnerOptions = vi.fn()
const projectMemberOptions = vi.fn()
const recordProject = vi.fn()
const assignableIterations = vi.fn()
const iterationOptions = vi.fn()
const teamScope = vi.fn()

vi.mock('@/features/teams/api', () => ({
  useProjectTeams: () => ({ data: [{ id: 'team-1', name: 'Team Alpha', key: 'TA' }] }),
  useProjectMemberOptions: (...args: unknown[]) => projectMemberOptions(...args),
  useTeamOwnerOptions: (...args: unknown[]) => teamOwnerOptions(...args),
}))
vi.mock('@/shared/lib/deep-link-project', () => ({
  useRecordProject: (...args: unknown[]) => recordProject(...args),
}))
vi.mock('@/features/iterations/api', () => ({
  useAssignableIterations: (...args: unknown[]) => assignableIterations(...args),
  useIterationOptions: (...args: unknown[]) => iterationOptions(...args),
}))
vi.mock('@/features/work-items/api', () => ({
  useWorkItem: () => ({ data: undefined }),
  useWorkItemLabels: () => ({ data: [] }),
  useWorkItemMilestones: () => ({ data: [] }),
  useSetWorkItemMilestones: () => ({ mutateAsync: vi.fn() }),
  useTaskTotals: () => ({ data: undefined }),
  useBacklog: () => ({ data: undefined }),
}))
vi.mock('@/features/releases/api', () => ({ useReleases: () => ({ data: [] }) }))
vi.mock('@/features/portfolio/api', () => ({
  usePortfolioFeatureOptions: () => ({ data: [] }),
}))
vi.mock('@/features/milestones/api', () => ({ useMilestoneOptions: () => ({ data: [] }) }))
vi.mock('@/features/access/api', () => ({
  useProjectPermissions: () => ({ can: () => true }),
  useProjectTeamScope: () => teamScope(),
}))

import '@/shared/i18n/i18n'
import { DetailSidebar } from './detail-sidebar'
import type { WorkItem } from '@/features/work-items/api'

const ALICE = { userId: 'alice', displayName: 'Alice Smith', email: 'alice@qnsc.dev' }
const OLIVE = { userId: 'olive', displayName: 'Olive Outsider', email: 'olive@qnsc.dev' }

const item = (over: Partial<WorkItem> = {}): WorkItem =>
  ({
    id: 'wi-1',
    itemKey: 'US-1',
    type: 'story',
    title: 'Wire the SSO callback',
    projectId: 'proj-record',
    teamId: 'team-1',
    assigneeId: null,
    parentId: null,
    iterationId: null,
    releaseId: null,
    featureId: null,
    scheduleState: 'defined',
    flowState: null,
    priority: 'none',
    storyPoints: null,
    estimateHours: null,
    todoHours: null,
    actualHours: null,
    isBlocked: false,
    blockedReason: null,
    foundInEnvironment: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }) as unknown as WorkItem

function setup() {
  // Defaults every test may override. The project-wide feed always holds BOTH people, so a narrowed
  // Owner list can only come from `useTeamOwnerOptions` and never from a client-side filter.
  projectMemberOptions.mockReturnValue({ data: [ALICE, OLIVE] })
  teamOwnerOptions.mockReturnValue({ data: [ALICE] })
  recordProject.mockReturnValue({
    projectId: 'proj-record',
    projectKey: 'TEST',
    projectName: 'Test Project',
  })
  assignableIterations.mockReturnValue({ data: [] })
  iterationOptions.mockReturnValue({ data: [] })
  // An admin by default — the caller who may still move an item to the Project Backlog.
  teamScope.mockReturnValue({ unrestricted: true, teamRequired: false, isLoading: false })
}

function renderSidebar(over: Partial<WorkItem> = {}) {
  return render(
    <DetailSidebar item={item(over)} onUpdate={vi.fn()} updating={false} readOnly={false} />,
  )
}

/**
 * The option labels a `SearchableSelect` trigger opens onto.
 *
 * Matched as substrings, because an owner row's accessible text carries the `OwnerAvatar`'s initials
 * ahead of the name (`ASAlice Smith`) — asserting equality would be asserting the avatar.
 */
function openOptions(label: string): string[] {
  fireEvent.click(screen.getByRole('button', { name: label }))
  const list = screen.getByRole('dialog')
  return within(list)
    .getAllByRole('button')
    .map((b) => b.textContent?.trim() ?? '')
    .filter((t) => t !== '')
}

const has = (options: string[], text: string) => options.some((o) => o.includes(text))

describe('DetailSidebar — Owner options are team-scoped (GAP-P1-WID-007)', () => {
  it("offers the item's TEAM members, not every project member", () => {
    setup()
    renderSidebar({ teamId: 'team-1' })

    // The narrowing is a REQUEST, keyed on the item's own project and team.
    expect(teamOwnerOptions).toHaveBeenCalledWith('proj-record', 'team-1')

    const options = openOptions('Owner')
    expect(has(options, 'Alice Smith')).toBe(true)
    // In the project feed, not on the team — the "unrelated Workspace users" the rule excludes.
    expect(has(options, 'Olive Outsider')).toBe(false)
  })

  it('offers ONLY Unassigned when the item carries no Team', () => {
    setup()
    // `useTeamOwnerOptions` never fetches without a team, so `data` is undefined — the hook, not the
    // caller, is what makes "No Team offers only Unassigned" unforgettable.
    teamOwnerOptions.mockReturnValue({ data: undefined })
    renderSidebar({ teamId: null })

    expect(teamOwnerOptions).toHaveBeenCalledWith('proj-record', null)
    expect(openOptions('Owner')).toEqual(['— No Entry —'])
  })

  it('still NAMES an owner who has left the team', () => {
    setup()
    // Olive owns the item but is no longer on Team Alpha.
    renderSidebar({ teamId: 'team-1', assigneeId: 'olive' })

    // `searchable-select` resolves its label out of the OPTIONS (`display = first?.label ??
    // placeholder`), so a narrowed list that omitted her would print "Unassigned" on an item that is
    // genuinely owned — the same defect as the iteration label below.
    expect(screen.getByRole('button', { name: 'Owner' }).textContent).toContain('Olive Outsider')
    // And she stays selectable, so opening the dropdown to read the owner cannot lose it.
    expect(has(openOptions('Owner'), 'Olive Outsider')).toBe(true)
  })
})

describe("DetailSidebar — the Project field is the RECORD's project (P6-E2E-003)", () => {
  it("resolves the item's own projectId", () => {
    setup()
    renderSidebar({ projectId: 'proj-record' })

    expect(recordProject).toHaveBeenCalledWith('proj-record')
    expect(screen.getByText('TEST')).toBeTruthy()
    expect(screen.getByText('Test Project')).toBeTruthy()
  })

  it('renders the absent placeholder rather than falling back to a selected project', () => {
    setup()
    // `useRecordProject` returns undefined until the row is known — including while the selected
    // project is a DIFFERENT one, which is the whole point.
    recordProject.mockReturnValue(undefined)
    renderSidebar()

    // `ProjectCell` renders EMPTY_VALUE for undefined. A confident wrong project name is the defect;
    // a dash that resolves in a moment is not.
    expect(screen.queryByText('TEST')).toBeNull()
  })
})

describe('DetailSidebar — the Iteration selector offers a CLOSED sprint (P6-VEL-004)', () => {
  /**
   * The BA's repro, on the Work Item Detail half: US-2 must be assignable back INTO the finished
   * `Carryover Sprint` it was moved out of, because Velocity attributes points by an item's CURRENT
   * iteration and the move-out already changed the bar.
   *
   * The eligibility feed stopped filtering by state server-side; the property this test adds is that
   * this select does not re-filter it here, and that choosing a closed sprint goes through the
   * ORDINARY update path — one `{ iterationId }` patch, so Schedule State, Flow State and the
   * acceptance stamp are untouched by construction.
   */
  it('offers an ACCEPTED iteration and persists it through the ordinary update', () => {
    setup()
    const onUpdate = vi.fn()
    assignableIterations.mockReturnValue({
      data: [
        { id: 'it-open', name: 'Empty Sprint', iterationKey: 'IT-2', state: 'planning' },
        { id: 'it-done', name: 'Carryover Sprint', iterationKey: 'IT-1', state: 'accepted' },
      ],
    })
    render(
      <DetailSidebar
        item={item({ iterationId: null })}
        onUpdate={onUpdate}
        updating={false}
        readOnly={false}
      />,
    )

    const options = openOptions('Iteration')
    // `--` / no iteration stays the un-assign choice, and the closed sprint is offered beside it.
    expect(has(options, 'No iteration')).toBe(true)
    expect(has(options, 'IT-1')).toBe(true)
    expect(has(options, 'IT-2')).toBe(true)

    const list = screen.getByRole('dialog')
    fireEvent.click(
      within(list)
        .getAllByRole('button')
        .find((b) => (b.textContent ?? '').includes('IT-1'))!,
    )

    // ONE field. Nothing about state, flow or acceptance rides along with an iteration change.
    expect(onUpdate).toHaveBeenCalledWith({ iterationId: 'it-done' })
  })

  it('keeps the eligibility feed scoped to the item, not to the selected project or team', () => {
    setup()
    renderSidebar({ projectId: 'proj-record', teamId: 'team-1' })

    expect(assignableIterations).toHaveBeenCalledWith('proj-record', 'team-1')
  })
})

describe('DetailSidebar — the Iteration label comes from the reference feed', () => {
  it('names an iteration that is outside the eligibility feed, and keeps it selected', () => {
    setup()
    // An iteration the eligibility feed does not carry — since P6-VEL-004 that is a TEAM-scope
    // difference rather than a state one (the item's team changed, say), not a closed sprint.
    assignableIterations.mockReturnValue({
      data: [{ id: 'it-open', name: 'Sprint 26.2', iterationKey: 'IT-2' }],
    })
    iterationOptions.mockReturnValue({
      data: [
        { id: 'it-open', name: 'Sprint 26.2', iterationKey: 'IT-2' },
        { id: 'it-done', name: 'Sprint 26.1', iterationKey: 'IT-1' },
      ],
    })
    renderSidebar({ iterationId: 'it-done' })

    // Was the "No Iteration" placeholder — the BA's "valid Iterations were unavailable".
    expect(screen.getByRole('button', { name: 'Iteration' }).textContent).toContain('IT-1')

    const options = openOptions('Iteration')
    expect(has(options, 'IT-2')).toBe(true)
    expect(has(options, 'IT-1')).toBe(true)
  })

  it('does not add the reference feed to the ASSIGNABLE options', () => {
    setup()
    assignableIterations.mockReturnValue({
      data: [{ id: 'it-open', name: 'Sprint 26.2', iterationKey: 'IT-2' }],
    })
    iterationOptions.mockReturnValue({
      data: [
        { id: 'it-open', name: 'Sprint 26.2', iterationKey: 'IT-2' },
        { id: 'it-done', name: 'Sprint 26.1', iterationKey: 'IT-1' },
      ],
    })
    // No iteration set, so there is nothing to keep NAMED. The reference feed is a LABEL source, and
    // unioning it into the options would offer rows the eligibility feed deliberately left out —
    // out-of-team timeboxes now that state is no longer a predicate.
    renderSidebar({ iterationId: null })

    const options = openOptions('Iteration')
    expect(has(options, 'IT-1')).toBe(false)
    expect(has(options, 'IT-2')).toBe(true)
  })
})

/**
 * Clearing the Team is a MOVE INTO the Project Backlog — BA ruling 2026-08-17.
 *
 * "Null means Project Backlog, accessible only to Workspace Admin and Project Admin. Editor … cannot
 * access team-less items." `updateWorkItem` re-checks the DESTINATION team, so an Editor choosing the
 * empty option gets `PROJECT_BACKLOG_ADMIN_ONLY` (403) — and were it ever to succeed they would have
 * sent the item somewhere they can no longer open it. The option is therefore not offered to them.
 *
 * Both directions, because withdrawing it from everyone would make the Team a one-way move for the
 * admin it belongs to — the exact defect the field's own comment records being fixed once already.
 */
describe('DetailSidebar — the Project Backlog is admin-only (BA ruling 2026-08-17)', () => {
  it('offers no empty Team option to an Editor', () => {
    setup()
    teamScope.mockReturnValue({ unrestricted: false, teamRequired: true, isLoading: false })
    renderSidebar({ teamId: 'team-1' })

    const options = openOptions('Team')
    // The team itself is still offered — a narrowing, not a disabled field.
    expect(has(options, 'Team Alpha')).toBe(true)
    expect(has(options, 'No team')).toBe(false)
  })

  it('keeps it for an admin, so the move stays two-way', () => {
    setup()
    renderSidebar({ teamId: 'team-1' })

    const options = openOptions('Team')
    expect(has(options, 'No team')).toBe(true)
  })
})
