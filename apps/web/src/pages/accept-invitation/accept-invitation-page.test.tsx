/**
 * `/accept-invitation` — the emailed link's landing page.
 *
 * WHAT THIS PINS, and why each half needs pinning separately.
 *
 * 1. THE REQUEST HAPPENS AT ALL. The defect being closed is not a wrong request, it is the ABSENCE of
 *    one: `WorkspaceService.inviteMember` emailed a link to a route that did not exist, and nothing in
 *    the SPA ever called `POST /v1/invitations/accept` — so the only code that applies the invited role
 *    and the invited per-project access was dead. An assertion that the POST fires with the token from
 *    the query string is therefore the regression test for the whole feature.
 *
 * 2. EACH REFUSAL IS ITS OWN ANSWER. `acceptInvitation` throws five codes across three HTTP statuses,
 *    two of which carry more than one meaning, and the actions they demand of the reader are
 *    different — `INVITATION_EMAIL_MISMATCH` needs a sign-out, `INVITATION_EXPIRED` needs an
 *    administrator. So the copy is asserted per state AND asserted to be mutually distinct: a shared
 *    generic message would satisfy every individual assertion and defeat the point.
 *
 * Mocked at the MODULE boundary (`@/shared/api/http-client`, `@/shared/api/sign-out`,
 * `@tanstack/react-router`) rather than at the network, so a regression is a hard failure: deleting
 * the `mutate` call, or dropping the code-branching, breaks these outright instead of changing a
 * rendered string. The QueryClient is built with the app's REAL
 * `createInvalidationMutationCache`, so the invalidation assertion exercises
 * `shared/api/invalidation.ts`'s tag fan-out rather than a restatement of the hook's `meta`.
 *
 * i18n is initialised for real (the singleton is imported), because the subject of half these tests IS
 * the copy. The alternative — asserting key names — would pass with every message identical.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import { createInvalidationMutationCache } from '@/shared/api/invalidation'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import '@/shared/i18n/i18n'

const { post, navigate, revokeSession, notifySuccess } = vi.hoisted(() => ({
  post: vi.fn(),
  navigate: vi.fn(),
  revokeSession: vi.fn(),
  notifySuccess: vi.fn(),
}))

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { POST: post, GET: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn(), PUT: vi.fn() },
}))

vi.mock('@/shared/api/sign-out', () => ({ revokeSession }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/shared/lib/toast', () => ({
  notify: {
    success: notifySuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    fromError: vi.fn(),
  },
  // The real implementation, because the `unknown` state renders the server's own message through it.
  errorMessage: (err: unknown, fallback = 'Something went wrong') =>
    err instanceof Error ? err.message : fallback,
}))

const { AcceptInvitationPage } = await import('./accept-invitation-page')

/** openapi-fetch's success tuple for a 204. */
const ACCEPTED = { data: undefined, error: undefined, response: { status: 204 } }

/** openapi-fetch's failure tuple carrying the BE error envelope. */
function refused(code: string, message: string, status = 422) {
  return { data: undefined, error: { error: { code, message } }, response: { status } }
}

let client: QueryClient
let invalidateSpy: ReturnType<typeof vi.spyOn>

function renderPage(search: string) {
  window.history.replaceState({}, '', `/accept-invitation${search}`)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<AcceptInvitationPage />, { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({
    mutationCache: createInvalidationMutationCache(() => client),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  useAuthStore.setState({
    user: {
      id: 'u-1',
      email: 'wrong.person@qnsc.dev',
      displayName: 'Wrong Person',
      locale: 'en',
      timezone: 'UTC',
      role: 'member',
      permissions: [],
      emailVerified: true,
      createdAt: '',
      updatedAt: '',
    },
    isAuthenticated: true,
  })
})

afterEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false })
})

/**
 * The route REGISTRATION, asserted against the router's source text.
 *
 * The whole defect was an absent route: the page can be perfect and the emailed link still lands on
 * `notFoundRoute`. A render test cannot see that, and neither can the existing
 * `route-permission.contract.test.tsx`, whose two assertions are about codes AGREEING — a route with
 * no code satisfies it by being absent from the map, which is exactly the state before this change.
 * Source text is the only thing that fails when the route is deleted or re-parented.
 *
 * Same shape as `widgets/app-shell/app-shell.test.tsx`, and for the same reason it gives there: the
 * property is structural, and a render test for it would need the whole router stood up.
 */
describe('the emailed link resolves to a route', () => {
  const ROUTER = readFileSync(join(import.meta.dirname, '../../app/router/router.tsx'), 'utf8')

  it('declares /accept-invitation', () => {
    expect(ROUTER).toMatch(/path: '\/accept-invitation'/)
  })

  it('registers it in the route tree, not just as an unused const', () => {
    // `createRoute` alone renders nothing — the route only exists once it is a child of `authRoute`.
    expect(ROUTER).toMatch(/authRoute\.addChildren\(\[[\s\S]*acceptInvitationRoute[\s\S]*\]\)/)
  })

  it('parents it on authRoute, so an unauthenticated arrival is sent to login and returned', () => {
    const block = ROUTER.split('const acceptInvitationRoute = createRoute({')[1]?.split('})')[0]
    expect(block).toBeDefined()
    expect(block).toMatch(/getParentRoute: \(\) => authRoute/)
  })

  it('carries no permission gate — a fresh member holds nothing yet', () => {
    const block = ROUTER.split('const acceptInvitationRoute = createRoute({')[1]?.split('})')[0]
    expect(block).not.toMatch(/guardedPage\(/)
    expect(block).toMatch(/lazyPage\(/)
  })
})

describe('the accept-invitation page sends the token', () => {
  it('POSTs /v1/invitations/accept with the token from the query string', async () => {
    post.mockResolvedValue(ACCEPTED)
    renderPage('?token=raw-token-abc')

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledWith('/v1/invitations/accept', {
      body: { token: 'raw-token-abc' },
    })
  })

  it('fires exactly once, even though the effect re-runs on re-render', async () => {
    // Accepting is not idempotent: a second call loses to the first with INVITATION_ALREADY_USED,
    // which would render a REFUSAL for a success. The mutation's own state changes cause re-renders,
    // so "once" is a real risk, not a theoretical one.
    post.mockResolvedValue(ACCEPTED)
    renderPage('?token=raw-token-abc')

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('sends nothing at all when the link carries no token', async () => {
    renderPage('')
    // The absent-token panel is rendered synchronously — no request, no invented failure.
    expect(
      screen.getByText(/This invitation link is incomplete/, { selector: 'p' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(post).not.toHaveBeenCalled())
  })

  it('treats a token that is only whitespace as absent', async () => {
    renderPage('?token=%20%20')
    expect(
      screen.getByText(/This invitation link is incomplete/, { selector: 'p' }),
    ).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('on success it invalidates the stale reads and leaves', () => {
  it('invalidates the project list, the permission read and the workspace roster', async () => {
    post.mockResolvedValue(ACCEPTED)
    renderPage('?token=raw-token-abc')

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    const invalidated = (invalidateSpy.mock.calls as { queryKey: unknown }[][]).map(([arg]) =>
      JSON.stringify(arg.queryKey),
    )
    // `['projects']` is the feed `useInitialProject` picks a brand-new member's FIRST project from —
    // without it the shell stays on "No project selected" and every route guard resolves against
    // nothing, which is the No Access experience for someone who has just been granted access.
    expect(invalidated).toContain(JSON.stringify(['projects']))
    // The route guards' own source.
    expect(invalidated).toContain(JSON.stringify(['my-project-permissions']))
    // The workspace roster + invitation list the admin is looking at.
    expect(invalidated).toContain(JSON.stringify(['workspace-invitations']))
  })

  it('navigates to Home and says so', async () => {
    post.mockResolvedValue(ACCEPTED)
    renderPage('?token=raw-token-abc')

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }))
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining('Invitation accepted'))
  })

  it('renders a polite pending state, never an alert, while the request is in flight', async () => {
    post.mockReturnValue(new Promise(() => {})) // never settles
    renderPage('?token=raw-token-abc')

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

/**
 * One case per refusal. The `code` is what each branches on — NOT the status, which is why two of
 * these deliberately share 422 and would collapse into one answer if the status were read instead.
 */
const REFUSALS: { code: string; status: number; message: string; copy: RegExp }[] = [
  {
    code: 'INVITATION_NOT_FOUND',
    status: 404,
    message: 'Invalid or unknown invitation token',
    copy: /We could not find this invitation/,
  },
  {
    code: 'INVITATION_ALREADY_USED',
    status: 422,
    message: 'Invitation has already been used or cancelled',
    copy: /This invitation has already been used/,
  },
  {
    code: 'INVITATION_EXPIRED',
    status: 422,
    message: 'Invitation has expired',
    copy: /This invitation has expired/,
  },
  {
    code: 'INVITATION_EMAIL_MISMATCH',
    status: 422,
    message: 'This invitation was sent to a different email address',
    copy: /You are signed in with the wrong account/,
  },
  {
    code: 'INVITED_ROLE_IS_PROJECT_TIER',
    status: 409,
    message: 'Per-Project roles cannot be granted at invitation',
    copy: /This invitation cannot be accepted/,
  },
]

describe('each refusal is its own answer', () => {
  for (const { code, status, message, copy } of REFUSALS) {
    it(`${code} renders its own message`, async () => {
      post.mockResolvedValue(refused(code, message, status))
      renderPage('?token=raw-token-abc')

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(copy)
      // A refusal never navigates: the reader has to act, and being bounced to Home would hide why.
      expect(navigate).not.toHaveBeenCalled()
    })
  }

  it('a 500 is NOT reported as one of the five — nothing about the invitation is established', async () => {
    post.mockResolvedValue(refused('INTERNAL_ERROR', 'Something broke', 500))
    renderPage('?token=raw-token-abc')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/We could not complete this just now/)
    // The server's own message is kept as the detail line, for support.
    expect(alert).toHaveTextContent(/Something broke/)
  })

  it('all seven states render MUTUALLY DISTINCT copy', async () => {
    // The assertion the per-state cases cannot make. A single shared "Invitation failed" panel would
    // satisfy every one of them individually; only comparing the seven answers catches it.
    //
    // Each render is UNMOUNTED before the next. Left mounted, `findByRole('alert')` resolves against
    // the FIRST panel still in the document the instant it matches — so the loop read the same string
    // seven times and the test passed nothing while looking thorough.
    const seen: string[] = []

    // TITLE + DESCRIPTION only. `detail` carries the server's own message on the `unknown` state,
    // which differs per failure — so comparing whole panels would report seven distinct answers even
    // if every headline read "Invitation failed". Verified by breaking exactly that.
    const answer = (alert: HTMLElement) =>
      ['invitation-title', 'invitation-description']
        .map((slot) => alert.querySelector(`[data-slot="${slot}"]`)?.textContent ?? '')
        .join(' | ')

    const first = renderPage('')
    seen.push(answer(screen.getByRole('alert')))
    first.unmount()

    const cases = [
      ...REFUSALS.map(({ code, status, message }) => ({ code, status, message })),
      { code: 'INTERNAL_ERROR', status: 500, message: 'Something broke' },
    ]
    for (const { code, status, message } of cases) {
      post.mockResolvedValue(refused(code, message, status))
      const view = renderPage('?token=raw-token-abc')
      seen.push(answer(await screen.findByRole('alert')))
      view.unmount()
    }

    expect(seen).toHaveLength(7)
    expect(new Set(seen).size, `duplicate refusal copy:\n${seen.join('\n---\n')}`).toBe(7)
  })
})

describe('the wrong-account refusal is actionable', () => {
  it('names the account the reader is signed in as', async () => {
    post.mockResolvedValue(refused('INVITATION_EMAIL_MISMATCH', 'different email address'))
    renderPage('?token=raw-token-abc')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/wrong\.person@qnsc\.dev/)
  })

  it('signs out and returns to login with this same invitation link as returnTo', async () => {
    post.mockResolvedValue(refused('INVITATION_EMAIL_MISMATCH', 'different email address'))
    renderPage('?token=raw-token-abc')

    await userEvent.click(await screen.findByRole('button', { name: /Sign out/ }))

    await waitFor(() => expect(revokeSession).toHaveBeenCalledTimes(1))
    expect(navigate).toHaveBeenCalledWith({
      to: '/login',
      search: { returnTo: '/accept-invitation?token=raw-token-abc' },
    })
  })

  it('offers no sign-out on a refusal signing out cannot fix', async () => {
    post.mockResolvedValue(refused('INVITATION_EXPIRED', 'Invitation has expired'))
    renderPage('?token=raw-token-abc')

    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: /Sign out/ })).not.toBeInTheDocument()
    // Nor a retry: trying again cannot un-expire an invitation, so offering it would be a lie.
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument()
  })

  it('offers a retry only where retrying can change the answer', async () => {
    post.mockResolvedValue(refused('INTERNAL_ERROR', 'Something broke', 500))
    renderPage('?token=raw-token-abc')

    await userEvent.click(await screen.findByRole('button', { name: /Try again/ }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  })
})
