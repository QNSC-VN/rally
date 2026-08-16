import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * RBE-11 / Settings §6.4 — an invitation carries initial per-Project access.
 *
 * The defect this closes: inviting someone and granting them access were two unrelated actions and
 * only the first was on this screen, so the common path produced a member who signs in and can see
 * nothing — `project_members` has no row, and no row is indistinguishable from No Access (§2.2).
 *
 * What is pinned here is the REQUEST, because that is the contract. The levels come from
 * `shared/config/access-levels.ts` (never a local array), an empty repeater must send no
 * `projectAccess` key at all (absent = the pre-§6.4 behaviour, which is why migration 0119 owes no
 * backfill), and a project already chosen must not be offerable twice — the API refuses duplicates.
 *
 * GAP-P1-USER-006 adds two things to that contract:
 *   • `roleId` is SENT, and only `workspace_admin` may be offered — the per-Project tier roles are
 *     refused at acceptance (`INVITED_ROLE_IS_PROJECT_TIER`), so offering one would mint an
 *     invitation nobody can redeem.
 *   • a REVIEW step sits between the form and the POST. The submit button must not send.
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { InviteUserModal } from './invite-user-modal'

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>
const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>

const PROJECTS = [
  { id: 'p-1', key: 'NXP', name: 'NextGen Platform' },
  { id: 'p-2', key: 'PAY', name: 'Payments' },
]

/**
 * `GET /v1/roles` as it really answers: the three canonical tier roles. Two of them are per-PROJECT
 * tiers that `WorkspaceService.acceptInvitation` refuses, so the picker must offer neither.
 */
const ROLES = [
  { id: 'r-wa', slug: 'workspace_admin', name: 'Workspace Admin', workspaceId: null },
  { id: 'r-pa', slug: 'project_admin', name: 'Project Admin', workspaceId: 'ws-1' },
  { id: 'r-pm', slug: 'project_member', name: 'Project Member', workspaceId: 'ws-1' },
]

function renderModal() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <InviteUserModal workspaceId="ws-1" onClose={vi.fn()} onSuccess={vi.fn()} />
    </QueryClientProvider>,
  )
}

function typeEmail(email = 'bob@example.com') {
  // By placeholder: `FormField` renders a `<Label>` with no `htmlFor` unless one is passed, so the
  // label is not programmatically associated with this input. Worth noting rather than working
  // around silently — it is a real (pre-existing, app-wide) a11y gap in that component.
  fireEvent.change(screen.getByPlaceholderText('colleague@company.com'), {
    target: { value: email },
  })
}

/** Add one repeater row, once the project list has actually arrived (the button is disabled until). */
async function addRow() {
  const button = await screen.findByRole('button', { name: 'Add project' })
  await waitFor(() => expect(button).toHaveProperty('disabled', false))
  fireEvent.click(button)
}

/** Step 1 of 2: the footer button opens the REVIEW step. It must never POST. */
function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Review Changes' }))
}

/** Step 2 of 2: `Send invitation` inside the review dialog is the only thing that writes. */
async function send() {
  fireEvent.click(await screen.findByRole('button', { name: 'Send invitation' }))
}

/**
 * The review dialog's own element. Radix marks the background modal `aria-hidden` once a second one
 * opens, so exactly one node has an exposed `dialog` role while the review step is up — which is
 * what makes this a reliable scope for the summary assertions.
 */
async function reviewDialog(): Promise<HTMLElement> {
  await screen.findByText('Review invitation')
  return screen.getByRole('dialog')
}

/** The whole two-step submit, for the tests whose subject is the request body. */
async function reviewAndSend() {
  submit()
  await send()
}

/** Open the row's picker and choose an option by its visible label. */
async function pick(triggerName: string | RegExp, optionLabel: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }))
  const option = await screen.findByText(optionLabel)
  fireEvent.click(option)
}

describe('InviteUserModal — initial per-Project access (§6.4)', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPOST.mockReset()
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects') return Promise.resolve({ data: { data: PROJECTS } })
      if (path === '/v1/roles') return Promise.resolve({ data: ROLES })
      return Promise.resolve({ data: [] })
    })
    mockPOST.mockResolvedValue({ data: {}, error: undefined, response: { status: 201 } })
  })

  it('sends NO projectAccess key when nothing was chosen (pre-§6.4 behaviour)', async () => {
    renderModal()
    typeEmail()
    await reviewAndSend()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    const body = mockPOST.mock.calls[0][1].body as Record<string, unknown>
    expect(body).toEqual({ email: 'bob@example.com' })
    expect('projectAccess' in body).toBe(false)
    // No `roleId` either — an ordinary member's authority is entirely per-Project.
    expect('roleId' in body).toBe(false)
  })

  it('sends the chosen project and level, defaulting to the team-scoped level', async () => {
    // Never Admin by default: Admin is All Teams by definition, so an invitation must not hand that
    // out unless the inviter picks it.
    renderModal()
    typeEmail()
    await addRow()
    await reviewAndSend()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect((mockPOST.mock.calls[0][1].body as Record<string, unknown>).projectAccess).toEqual([
      { projectId: 'p-1', accessLevel: 'editor' },
    ])
  })

  it('offers Admin and Editor from the shared option list, and sends the picked one', async () => {
    renderModal()
    typeEmail()
    await addRow()
    await pick('Access level', 'Admin')
    await reviewAndSend()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect((mockPOST.mock.calls[0][1].body as Record<string, unknown>).projectAccess).toEqual([
      { projectId: 'p-1', accessLevel: 'admin' },
    ])
  })

  it('does not offer a project that is already on another row', async () => {
    // The API refuses two rows for one project, so the picker must not be able to produce them.
    renderModal()
    await addRow()
    await addRow()

    // Second row's project picker. The first row already holds NXP, so the second row was created
    // holding PAY — and its popover must offer PAY alone.
    const projectTriggers = screen.getAllByRole('button', { name: 'Project' })
    fireEvent.click(projectTriggers[1])
    // The popover renders each option as its own button (there is no listbox role); the row
    // TRIGGERS carry an aria-label ("Project"), so a button named after a project can only be an
    // option.
    expect(await screen.findByRole('button', { name: /Payments/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /NextGen Platform/ })).toBeNull()
  })

  it('stops offering Add project once every project has a row', async () => {
    renderModal()
    await addRow()
    await addRow()
    expect(screen.getByRole('button', { name: 'Add project' })).toHaveProperty('disabled', true)
  })

  it('drops a row again, and sends nothing for it', async () => {
    renderModal()
    typeEmail()
    await addRow()
    fireEvent.click(screen.getByRole('button', { name: 'Remove project access' }))
    await reviewAndSend()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect('projectAccess' in (mockPOST.mock.calls[0][1].body as object)).toBe(false)
  })
})

describe('InviteUserModal — the workspace role (GAP-P1-USER-006a)', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPOST.mockReset()
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects') return Promise.resolve({ data: { data: PROJECTS } })
      if (path === '/v1/roles') return Promise.resolve({ data: ROLES })
      return Promise.resolve({ data: [] })
    })
    mockPOST.mockResolvedValue({ data: {}, error: undefined, response: { status: 201 } })
  })

  /**
   * There is no role selector at all now, and both halves of that are asserted.
   *
   * The previous two tests here pinned a Workspace-Admin-only picker, which was correct against the
   * text of the day: the per-project tiers are refused at acceptance, so `workspace_admin` was the
   * only value left. The BA has since forbidden that one too —
   * `Phase 4/03_Settings_Audit/SRS.md:173`, "Invitation does not create a Workspace Admin account" —
   * which leaves no grantable workspace role and makes the control itself wrong. `roleId` is gone from
   * `InviteMemberSchema`, so the API cannot accept one either.
   */
  it('offers NO workspace-role control', async () => {
    renderModal()

    expect(screen.queryByRole('button', { name: 'Role' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Workspace Admin' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Project Admin' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Project Member' })).toBeNull()
  })

  it('never sends a roleId — an invitation that carried one could not be redeemed', async () => {
    renderModal()
    typeEmail()
    submit()

    expect(await screen.findByText('Review invitation')).toBeTruthy()
    expect(screen.getByText('bob@example.com')).toBeTruthy()
    await send()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    const body = mockPOST.mock.calls[0][1].body as Record<string, unknown>
    expect(body).toEqual({ email: 'bob@example.com' })
    expect('roleId' in body).toBe(false)
  })

  it('shows no workspace role in the review step', async () => {
    // §6.4:172 lists "Project, Access Level and Team assignment" — no role.
    renderModal()
    typeEmail()
    submit()

    expect(await screen.findByText('Review invitation')).toBeTruthy()
    expect(screen.queryByText('Workspace Admin')).toBeNull()
    expect(screen.queryByText(/^Member$/)).toBeNull()
  })
})

describe('InviteUserModal — the review step (GAP-P1-USER-006b)', () => {
  beforeEach(() => {
    mockGET.mockReset()
    mockPOST.mockReset()
    mockGET.mockImplementation((path: string) => {
      if (path === '/v1/projects') return Promise.resolve({ data: { data: PROJECTS } })
      if (path === '/v1/roles') return Promise.resolve({ data: ROLES })
      return Promise.resolve({ data: [] })
    })
    mockPOST.mockResolvedValue({ data: {}, error: undefined, response: { status: 201 } })
  })

  it('does NOT send on submit — it opens the review step first', async () => {
    renderModal()
    typeEmail()
    submit()

    expect(await screen.findByText('Review invitation')).toBeTruthy()
    expect(mockPOST).not.toHaveBeenCalled()
  })

  it('abandons on Back without sending, and the form is still there to edit', async () => {
    renderModal()
    typeEmail()
    submit()
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))

    expect(mockPOST).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('colleague@company.com')).toBeTruthy()
  })

  it('never reaches the review step with an invalid address', async () => {
    // The zod resolver runs first, so the summary cannot claim an address that will be refused.
    //
    // Asserted on the STATE, not on the message: the field-level message does not currently render
    // at all (see the note at the bottom of this file), and that is pre-existing behaviour of the
    // shared react-hook-form + zodResolver wiring rather than anything this step introduced. What
    // must hold either way is that nothing is sent and no summary claims otherwise.
    renderModal()
    typeEmail('not-an-email')
    submit()
    await waitFor(() => expect(mockGET).toHaveBeenCalled())

    expect(screen.queryByText('Review invitation')).toBeNull()
    expect(mockPOST).not.toHaveBeenCalled()
  })

  it('lists the project rows the invitation will grant', async () => {
    renderModal()
    typeEmail()
    await addRow()
    submit()

    // Scoped to the review dialog: the repeater row's own project picker renders the same label
    // behind it, so an unscoped query finds two and proves nothing about the summary.
    const review = within(await reviewDialog())
    expect(review.getByText('NXP · NextGen Platform')).toBeTruthy()
    expect(review.getByText('Editor')).toBeTruthy()
  })

  it('says so, rather than nothing, when no project access was chosen', async () => {
    renderModal()
    typeEmail()
    submit()

    expect(
      await screen.findByText('None — No Access until a Workspace Admin grants a level.'),
    ).toBeTruthy()
  })

  it('brings the API failure back to the form instead of stranding it behind the dialog', async () => {
    mockPOST.mockResolvedValue({
      error: { error: { message: 'Already invited' } },
      response: { status: 409 },
    })
    renderModal()
    typeEmail()
    await reviewAndSend()

    expect(await screen.findByText('Already invited')).toBeTruthy()
    expect(screen.queryByText('Review invitation')).toBeNull()
  })
})

/**
 * FOUND, NOT FIXED, and not introduced here: a FIELD-level validation failure on this form renders
 * no message. Submitting `not-an-email` correctly refuses to open the review step and sends nothing,
 * but `formState.errors` stays `{}`, so the `FormField` error slot has nothing to show and the
 * button appears to do nothing.
 *
 * Narrowed down: `zodResolver(schema)` called directly DOES return
 * `{ errors: { email: { message: 'Enter a valid email address' } } }`, and `form.setError('root')`
 * from the mutation's `onError` DOES render (pinned by the test above), so neither the schema nor the
 * `formState` subscription is at fault — the errors never reach the subscription from inside
 * `handleSubmit`. The wiring is identical to what `members-tab.tsx` had before this file was split
 * out of it, and `profile-tab.tsx` is the other consumer of the same stack (react-hook-form 7.81 +
 * @hookform/resolvers 5.4 + zod 4.4), so it is likely affected too. Fixing it belongs with that
 * shared stack, not here.
 */
