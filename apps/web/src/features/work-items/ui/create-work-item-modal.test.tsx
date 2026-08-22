/**
 * The shared `New Work Item` modal: a FIXED Project, and an Owner scoped to the Team chosen here.
 *
 * Owner — GAP-P1-WID-007 / P6-TC-007: "Work Item and Task Owner default to Unassigned. Selected Team
 * offers Unassigned plus its ACTIVE MEMBERS; No Team offers only Unassigned." The creator-seeded
 * default here is the upstream cause of P6-TC-007's "null-owner Task attributed to a named member": a
 * Task inherits its parent's assignee, so a Story silently owned by whoever opened this modal
 * produced Tasks nobody had assigned.
 *
 * Project — WIC-FR-004 AC #11 (P5-PI-003): read-only in every create flow, including this modal
 * REUSED by the Feature Children tab's `Add New`. There used to be a searchable dropdown over every
 * readable project here, so a child Story could be filed under a project other than its Feature's.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const createWorkItem = vi.fn()
const teamOwnerOptions = vi.fn()
const projectTeams = vi.fn()
const teamScope = vi.fn()
const appContext = vi.fn()

vi.mock('@/features/work-items/api', () => ({
  useCreateWorkItem: () => ({ mutateAsync: createWorkItem }),
  useStoryOptions: () => ({ data: [] }),
}))
vi.mock('@/features/teams/api', () => ({
  useProjectTeams: () => projectTeams(),
  useTeamOwnerOptions: (...args: unknown[]) => teamOwnerOptions(...args),
}))
// The caller's TEAM SCOPE, mocked rather than derived from a permission array, because this component
// must not care HOW the level was resolved — `useProjectTeamScope` owns that (and `access-levels`
// pins the codes → scope mapping on its own).
vi.mock('@/features/access/api', () => ({
  useProjectTeamScope: () => teamScope(),
}))
// The record's own project, resolved from the id the caller passed — NOT a list of projects to
// choose from. `@/features/projects/api` is deliberately NOT mocked here: the modal no longer
// imports it, and a mock for a module it does not use would keep passing after a regression.
vi.mock('@/shared/lib/deep-link-project', () => ({
  useRecordProject: (projectId: string | undefined) =>
    projectId === 'proj-1'
      ? { projectId: 'proj-1', projectKey: 'NXP', projectName: 'NextGen Platform' }
      : undefined,
}))
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => appContext(),
}))

import '@/shared/i18n/i18n'
import { CreateWorkItemModal } from './create-work-item-modal'

const ALICE = { userId: 'alice', displayName: 'Alice Smith', email: 'alice@qnsc.dev' }
const ALPHA = { id: 'team-1', name: 'Team Alpha', key: 'TA' }
const BETA = { id: 'team-2', name: 'Team Beta', key: 'TB' }

/** A Workspace Admin / per-project Admin: every Team plus the Project Backlog. */
const ADMIN = { unrestricted: true, teamRequired: false, isLoading: false }
/** A team-scoped Editor: a Team must be chosen, and `No team` is not theirs to choose. */
const EDITOR = { unrestricted: false, teamRequired: true, isLoading: false }

beforeEach(() => {
  vi.clearAllMocks()
  createWorkItem.mockResolvedValue({ id: 'wi-1', itemKey: 'US-1' })
  teamOwnerOptions.mockReturnValue({ data: [ALICE] })
  projectTeams.mockReturnValue({ data: [ALPHA, BETA] })
  teamScope.mockReturnValue(ADMIN)
  appContext.mockReturnValue({ workspace: { workspaceId: 'ws-1' }, team: { teamId: 'team-1' } })
})

function open() {
  render(
    <CreateWorkItemModal
      projectId="proj-1"
      onClose={vi.fn()}
      onCreated={vi.fn()}
      onCreatedWithDetails={vi.fn()}
    />,
  )
}

describe('CreateWorkItemModal — Project is read-only (WIC-FR-004 AC #11, P5-PI-003)', () => {
  it('names the fixed project as text, with no control to change it', () => {
    open()

    // The value IS shown — read-only is not the same as absent, and WIC-FR-004 still requires the
    // field. Both the key chip and the name, exactly as the grids' Project column renders them.
    const field = screen.getByText('Project').closest('div')
    expect(field?.textContent).toContain('NXP')
    expect(field?.textContent).toContain('NextGen Platform')
  })

  it('renders NO Project picker — no combobox, no button, nothing to open', () => {
    open()

    // The BA's repro was a Project field that "is still an interactive button" whose dropdown
    // offered TEST / AUDIT26 / P6RT014. Every other picker in this modal is a `button` with its
    // label as its accessible name (`Team`, `Owner`), so asking for one named `Project` is asking
    // exactly the question the repro asks.
    expect(screen.queryByRole('button', { name: 'Project' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull()
    // And no `<select>` either — the field was a `NativeSelect` before it was a `SearchableSelect`.
    expect(screen.queryByLabelText('Project')).toBeNull()
  })

  it('creates in the project it was OPENED with, not the one the app context names', async () => {
    open()
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Child of a Feature' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    await waitFor(() => expect(createWorkItem).toHaveBeenCalled())
    expect(createWorkItem.mock.calls[0][0].projectId).toBe('proj-1')
  })

  it('sends the same project from `Create with details`', async () => {
    open()
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'With details' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create with details' }))

    await waitFor(() => expect(createWorkItem).toHaveBeenCalled())
    expect(createWorkItem.mock.calls[0][0].projectId).toBe('proj-1')
  })
})

describe('CreateWorkItemModal — Owner defaults to Unassigned', () => {
  it('does not seed the signed-in creator', () => {
    open()
    expect(screen.getByRole('button', { name: 'Owner' }).textContent).toContain('— No Entry —')
    expect(screen.getByRole('button', { name: 'Owner' }).textContent).not.toContain('Alice')
  })

  it('sends NO assigneeId when the field is left alone', async () => {
    open()
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Wire the callback' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    await waitFor(() => expect(createWorkItem).toHaveBeenCalled())
    expect(createWorkItem.mock.calls[0][0].assigneeId).toBeUndefined()
  })
})

describe('CreateWorkItemModal — Owner options follow the selected Team (GAP-P1-WID-007)', () => {
  it('asks for the roster of the team the form has chosen', () => {
    open()
    // The inherited context team, validated against the project's own team list — the same value the
    // create itself sends, so the feed cannot 422 on a team the create would drop.
    expect(teamOwnerOptions).toHaveBeenCalledWith('proj-1', 'team-1')
  })

  it('clears a stale owner when the Team changes', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Owner' }))
    fireEvent.click(await screen.findByText('Alice Smith'))
    expect(screen.getByRole('button', { name: 'Owner' }).textContent).toContain('Alice Smith')

    // Switching team re-populates the Owner list; a selection made against the previous team is no
    // longer offered, and a draft must not submit a value its own picker would not show.
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    fireEvent.click(await screen.findByText('Team Beta'))

    expect(screen.getByRole('button', { name: 'Owner' }).textContent).toContain('— No Entry —')
    expect(teamOwnerOptions).toHaveBeenLastCalledWith('proj-1', 'team-2')
  })

  it('asks for nothing at all with No Team selected', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    fireEvent.click(screen.getByText('No team'))

    // `null`, not `''` — `useTeamOwnerOptions` is disabled and returns no rows, which IS the rule.
    expect(teamOwnerOptions).toHaveBeenLastCalledWith('proj-1', null)
  })
})

/**
 * Team is REQUIRED OF AN EDITOR, and optional for an admin — BA ruling 2026-08-17.
 *
 * "Keep `team_id` nullable. Null means Project Backlog, accessible only to Workspace Admin and
 * Project Admin. Editor must select one of their assigned Teams when creating a Work Item and cannot
 * access team-less items." The requirement is therefore per-CALLER, not per-form, which is why every
 * case below renders the SAME component and changes only the scope.
 *
 * All four directions are asserted, because each one alone passes for the wrong reason: refusing a
 * blank Team for everybody would take the Project Backlog away from the admin it belongs to (this
 * modal used to do exactly that, citing a rule the SRS had superseded), and offering the blank to an
 * Editor turns the server's 412 into the only feedback there is.
 */
describe('CreateWorkItemModal — Team is required for an Editor (BA ruling 2026-08-17)', () => {
  beforeEach(() => {
    // No inherited context team, so the field starts genuinely empty.
    appContext.mockReturnValue({ workspace: { workspaceId: 'ws-1' }, team: undefined })
  })

  it('refuses to submit without a Team, and says so on the FIELD', async () => {
    teamScope.mockReturnValue(EDITOR)
    open()
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'No team chosen' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    expect(await screen.findByText(/Select one of your Teams/)).toBeInTheDocument()
    // The point of the client check: the request is never made, so there is no 412 to explain.
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('refuses `Create with details` on the same rule', async () => {
    teamScope.mockReturnValue(EDITOR)
    open()
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'No team chosen' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create with details' }))

    expect(await screen.findByText(/Select one of your Teams/)).toBeInTheDocument()
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('does not OFFER No Team to an Editor', () => {
    teamScope.mockReturnValue(EDITOR)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))

    // The teams themselves are still offered — this is a narrowing, not a disabled field.
    expect(screen.getByText('Team Alpha')).toBeInTheDocument()
    expect(screen.queryByText('No team')).toBeNull()
  })

  it('KEEPS No Team for an admin, and creates with no team when it is chosen', async () => {
    teamScope.mockReturnValue(ADMIN)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    // The TRIGGER also reads `No team` — that is the placeholder for an empty value — so the OPTION
    // is the later node with that text. The Editor case above asserts there is no such node at all.
    const noTeam = screen.getAllByText('No team')
    expect(noTeam.length).toBeGreaterThan(1)
    fireEvent.click(noTeam[noTeam.length - 1])

    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Project backlog item' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    await waitFor(() => expect(createWorkItem).toHaveBeenCalled())
    // `undefined`, which is what "file this into the Project Backlog" looks like on the wire.
    expect(createWorkItem.mock.calls[0][0].teamId).toBeUndefined()
  })

  it("prefills an Editor's ONE team, so it is not a choice to be made twice", async () => {
    teamScope.mockReturnValue(EDITOR)
    projectTeams.mockReturnValue({ data: [ALPHA] })
    open()

    // Shown as chosen, not merely defaulted at submit time — and the Owner feed follows it, which is
    // what proves the prefilled value is the one the form is actually using.
    expect(screen.getByRole('button', { name: 'Team' }).textContent).toContain('Team Alpha')
    expect(teamOwnerOptions).toHaveBeenLastCalledWith('proj-1', 'team-1')

    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Sole team' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }))

    await waitFor(() => expect(createWorkItem).toHaveBeenCalled())
    expect(createWorkItem.mock.calls[0][0].teamId).toBe('team-1')
  })

  it("does NOT prefill an admin's single team — nobody chose it", () => {
    teamScope.mockReturnValue(ADMIN)
    projectTeams.mockReturnValue({ data: [ALPHA] })
    open()

    expect(screen.getByRole('button', { name: 'Team' }).textContent).not.toContain('Team Alpha')
    expect(teamOwnerOptions).toHaveBeenLastCalledWith('proj-1', null)
  })
})
