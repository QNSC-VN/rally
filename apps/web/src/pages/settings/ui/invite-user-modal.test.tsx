import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
 */

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import '@/shared/i18n/i18n'
import { apiClient } from '@/shared/api/http-client'
import { InviteUserModal } from './members-tab'

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

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
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
      return Promise.resolve({ data: [] })
    })
    mockPOST.mockResolvedValue({ data: {}, error: undefined, response: { status: 201 } })
  })

  it('sends NO projectAccess key when nothing was chosen (pre-§6.4 behaviour)', async () => {
    renderModal()
    typeEmail()
    submit()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    const body = mockPOST.mock.calls[0][1].body as Record<string, unknown>
    expect(body).toEqual({ email: 'bob@example.com' })
    expect('projectAccess' in body).toBe(false)
  })

  it('sends the chosen project and level, defaulting to the team-scoped level', async () => {
    // Never Admin by default: Admin is All Teams by definition, so an invitation must not hand that
    // out unless the inviter picks it.
    renderModal()
    typeEmail()
    await addRow()
    submit()

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
    submit()

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
    submit()

    await waitFor(() => expect(mockPOST).toHaveBeenCalled())
    expect('projectAccess' in (mockPOST.mock.calls[0][1].body as object)).toBe(false)
  })
})
