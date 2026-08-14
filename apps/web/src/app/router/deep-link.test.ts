/**
 * Deep-link ROUTES (`P01-06`) — a shared link opens the record in its OWN project.
 *
 * The BA lists three failing deep links (`mini_rally_ui_business_review.md` :218 "`Go to item` chưa
 * deep-link", :256 "Deep-link Work Item, Notifications và Release Detail") and the overview adds the
 * security half — a user with no `project_members` row has the Project hidden and "direct URLs
 * denied".
 *
 * The diagnosis these tests pin: the URL never needed a project key. `/item/US-42` and
 * `/releases/:id` both address workspace-unique identifiers that the API resolves and authorizes
 * from the row it loads. What was broken is that the project's IDENTITY was read from
 * `useAppContext()` — the recipient's last-selected project — so the right record rendered under the
 * wrong project. And the one place that DID switch project sat on `useOpenNotification`, the
 * notification click handler, so it fixed an in-app click and not the link that click produces.
 *
 * Every case here therefore puts the record in a project that is NOT the selected one. A test that
 * deep-links inside the already-selected project passes just as well against the broken behaviour.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { router } from '@/app/router/router'
import { recordProjectKeys } from '@/shared/lib/deep-link-project'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

/**
 * Drive the REAL route loaders, not the adopters they call.
 *
 * Calling `adoptWorkItemProject` directly would pass whether or not the route is wired to it, and
 * the wiring is the fix: a deep link is a property of the route. So every case below goes through
 * `router.routesById`, exactly as a navigation does.
 */
async function openRoute(routeId: string, params: Record<string, string>): Promise<void> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const route = router.routesById[routeId as keyof typeof router.routesById]
  const loader = route.options.loader as
    | ((args: { context: { queryClient: QueryClient }; params: Record<string, string> }) => unknown)
    | undefined
  expect(loader, `${routeId} must have a deep-link loader`).toBeTypeOf('function')
  await loader!({ context: { queryClient }, params })
  lastQueryClient = queryClient
}

/** The cache the last `openRoute` populated, for the "one request per record" assertion. */
let lastQueryClient: QueryClient

const NXP = { projectId: 'p-nxp', projectKey: 'NXP', projectName: 'NextGen Platform' }
const PAY = { id: 'p-pay', key: 'PAY', name: 'Payments Platform' }

const ok = (data: unknown) => ({ data, error: undefined, response: { status: 200 } })
const fail = (status: number) => ({
  data: undefined,
  error: { message: 'nope' },
  response: { status },
})

/** The recipient is sitting on NXP with one of its teams picked — the state a link arrives into. */
beforeEach(() => {
  vi.clearAllMocks()
  useAppContext.setState({ project: NXP, team: { teamId: 't-alpha', teamName: 'Team Alpha' } })
})

/** Route the mocked client by path, so each test only states the responses it cares about. */
function respond(routes: Record<string, unknown>) {
  mockGET.mockImplementation((path: string) => {
    const value = routes[path]
    if (!value) throw new Error(`unexpected GET ${path}`)
    return Promise.resolve(value)
  })
}

describe('/item/$itemKey — work item deep link', () => {
  it('adopts the ITEM’s project, not the selected one', async () => {
    respond({
      '/v1/work-items/by-key': ok({ id: 'wi-1', itemKey: 'US-2', projectId: 'p-pay' }),
      '/v1/projects/{id}': ok(PAY),
    })

    await openRoute('/auth/item/$itemKey', { itemKey: 'US-2' })

    expect(useAppContext.getState().project).toEqual({
      projectId: 'p-pay',
      projectKey: 'PAY',
      projectName: 'Payments Platform',
    })
  })

  it('clears the Team, which belonged to the project being left', async () => {
    respond({
      '/v1/work-items/by-key': ok({ id: 'wi-1', itemKey: 'US-2', projectId: 'p-pay' }),
      '/v1/projects/{id}': ok(PAY),
    })

    await openRoute('/auth/item/$itemKey', { itemKey: 'US-2' })

    // Same rule as the shell's own project switcher: a team of the old project would scope every
    // report and grid on the new one to a team that is not in it.
    expect(useAppContext.getState().team).toBeNull()
  })

  it('warms the cache the detail page reads, so the deep link costs ONE request per record', async () => {
    respond({
      '/v1/work-items/by-key': ok({ id: 'wi-1', itemKey: 'US-2', projectId: 'p-pay' }),
      '/v1/projects/{id}': ok(PAY),
    })
    await openRoute('/auth/item/$itemKey', { itemKey: 'US-2' })
    const qc = lastQueryClient

    // `workItemKeys.byKey` — the same key `useWorkItemByKey` reads, which is the whole point of
    // exposing query OPTIONS rather than duplicating the fetch in the loader.
    expect(qc.getQueryData(['work-items', 'by-key', 'US-2'])).toMatchObject({ id: 'wi-1' })
    expect(qc.getQueryData(recordProjectKeys.detail('p-pay'))).toEqual({
      projectId: 'p-pay',
      projectKey: 'PAY',
      projectName: 'Payments Platform',
    })
  })

  it('leaves the context alone when the record is DENIED (403)', async () => {
    // "Direct URLs denied" is the API's answer, not a redirect into the recipient's own data: the
    // HTTP client sends a 403 to `/403` globally. The loader must not half-apply a project switch on
    // the way there, or the caller lands on Access Denied with someone else's project selected.
    respond({ '/v1/work-items/by-key': fail(403) })

    await openRoute('/auth/item/$itemKey', { itemKey: 'US-2' })

    expect(useAppContext.getState().project).toEqual(NXP)
    expect(mockGET).not.toHaveBeenCalledWith('/v1/projects/{id}', expect.anything())
  })

  it('leaves the context alone when the record does NOT EXIST (404)', async () => {
    // 404 resolves to `null` rather than throwing, so the detail page can tell "no such key" from
    // "not answered yet" and render its own not-found state.
    respond({ '/v1/work-items/by-key': fail(404) })

    await openRoute('/auth/item/$itemKey', { itemKey: 'US-404' })

    expect(useAppContext.getState().project).toEqual(NXP)
  })

  it('does not re-fetch the project when the record is already in the selected one', async () => {
    respond({ '/v1/work-items/by-key': ok({ id: 'wi-9', projectId: 'p-nxp' }) })

    await openRoute('/auth/item/$itemKey', { itemKey: 'US-1' })

    expect(useAppContext.getState().project).toEqual(NXP)
    expect(useAppContext.getState().team).toEqual({ teamId: 't-alpha', teamName: 'Team Alpha' })
  })
})

describe('/releases/$releaseId — release detail deep link', () => {
  it('adopts the RELEASE’s project, not the selected one', async () => {
    respond({
      '/v1/releases/{id}': ok({ id: 'r-pay', name: 'PAY 1.0', projectId: 'p-pay' }),
      '/v1/projects/{id}': ok(PAY),
    })

    await openRoute('/auth/releases/$releaseId', { releaseId: 'r-pay' })

    expect(useAppContext.getState().project).toEqual({
      projectId: 'p-pay',
      projectKey: 'PAY',
      projectName: 'Payments Platform',
    })
  })

  it('leaves the context alone when the release is DENIED (403)', async () => {
    respond({ '/v1/releases/{id}': fail(403) })

    await openRoute('/auth/releases/$releaseId', { releaseId: 'r-pay' })

    expect(useAppContext.getState().project).toEqual(NXP)
  })

  it('leaves the context alone when the release does NOT EXIST (404)', async () => {
    respond({ '/v1/releases/{id}': fail(404) })

    await openRoute('/auth/releases/$releaseId', { releaseId: 'r-gone' })

    expect(useAppContext.getState().project).toEqual(NXP)
  })
})

describe('the project a record names is never invented', () => {
  it('keeps the selected project when the project itself is unreadable', async () => {
    // The record resolved (so the caller can read it) but `GET /projects/{id}` refused. Rather than
    // fall back to the selected project — which is the defect this whole change removes — the
    // context stays put and the page renders `--` for the scope.
    respond({
      '/v1/work-items/by-key': ok({ id: 'wi-1', projectId: 'p-pay' }),
      '/v1/projects/{id}': fail(403),
    })

    await openRoute('/auth/item/$itemKey', { itemKey: 'US-2' })

    expect(useAppContext.getState().project).toEqual(NXP)
  })
})
