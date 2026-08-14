/**
 * `useRecordProject` — the DISPLAY side of a deep link never falls back to the selector.
 *
 * Companion to `app/router/deep-link.test.ts`, which drives the route loaders. Split by LAYER, not by
 * taste: `shared` may not import `app` (`boundaries/dependencies`), and the router lives in `app`.
 *
 * The rule under test is the absent-versus-wrong distinction the whole `P01-06` finding turns on.
 * Three surfaces used to render `useAppContext().project` as the project of a record they had just
 * loaded, so a deep-linked PAY release was labelled `NXP`. Returning `undefined` until the record's
 * own project is known makes `ProjectCell` render `EMPTY_VALUE` (`--`) for a moment, which is honest;
 * the selected project would be a confident lie.
 */
import { createElement } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { adoptRecordProject, useRecordProject } from '@/shared/lib/deep-link-project'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

const NXP = { projectId: 'p-nxp', projectKey: 'NXP', projectName: 'NextGen Platform' }
const PAY = { id: 'p-pay', key: 'PAY', name: 'Payments Platform' }

const ok = (data: unknown) => ({ data, error: undefined, response: { status: 200 } })
const fail = (status: number) => ({
  data: undefined,
  error: { message: 'nope' },
  response: { status },
})

function mount(projectId: string | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useRecordProject(projectId), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: qc }, children),
  })
}

/** The recipient is sitting on NXP — the state a forwarded link arrives into. */
beforeEach(() => {
  vi.clearAllMocks()
  useAppContext.setState({ project: NXP, team: null })
})

describe('useRecordProject — the display side never falls back to the selector', () => {
  it('reports the project as UNKNOWN while it loads, not as the selected one', async () => {
    // A DEFERRED response, not a slow one: the ordering has to be deterministic. This is the
    // absent-versus-wrong distinction the whole finding turns on — `ProjectCell` renders `--` for
    // `undefined`, and a placeholder that resolves in a moment is strictly better than the
    // recipient's own project name rendered with confidence for one paint.
    let release!: (v: unknown) => void
    const pending = new Promise((resolve) => {
      release = resolve
    })
    mockGET.mockImplementation((path: string) =>
      path === '/v1/projects/{id}' ? pending : Promise.resolve(fail(404)),
    )

    const { result } = mount('p-pay')

    expect(result.current).toBeUndefined()

    release(ok(PAY))
    await waitFor(() =>
      expect(result.current).toEqual({
        projectId: 'p-pay',
        projectKey: 'PAY',
        projectName: 'Payments Platform',
      }),
    )
  })

  it('uses the selected project when it IS the record’s project, with no extra request', async () => {
    // The ordinary in-app case: the reader is already on this project, so the value is right without
    // waiting for a round trip. This is the only situation in which the selector may be consulted at
    // all, and it is safe precisely because the ids were compared first.
    mockGET.mockResolvedValue(ok({ id: 'p-nxp', key: 'NXP', name: 'NextGen Platform' }))

    const { result } = mount('p-nxp')

    expect(result.current).toEqual(NXP)
  })

  it('is undefined when the record has no project yet (still loading)', () => {
    const { result } = mount(undefined)

    expect(result.current).toBeUndefined()
    expect(mockGET).not.toHaveBeenCalled()
  })
})

/**
 * `adoptRecordProject` — a HOVER may warm the cache and must not move the app.
 *
 * The router runs `defaultPreload: 'intent'`, so a route's loader fires on hover with
 * `cause: 'preload'` and no navigation. This loader is not a pure fetch: it writes `setProject` and
 * `setTeam(null)`. `widgets/app-shell/global-search.tsx` renders a `<Link to="/item/$itemKey">` for
 * whatever key the reader types, and item keys are workspace-unique — so pointing at a suggestion
 * for another project's item silently switched the whole app to that project and cleared the
 * selected Team, with no click and nothing on screen to explain it.
 *
 * Both directions, because the fix must not be "stop preloading": the fetch has to still happen on
 * hover or the preload is pointless, and the commit has to still happen on a real navigation or a
 * deep link lands in the wrong project — the defect this whole module exists to fix.
 */
describe('adoptRecordProject — preload fetches, navigation commits', () => {
  it('does NOT switch project on a hover-time preload, but still warms the cache', async () => {
    mockGET.mockResolvedValue(ok(PAY))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await adoptRecordProject(qc, PAY.id, { commit: false })

    // The reader has not gone anywhere: they are still on the project they chose.
    expect(useAppContext.getState().project).toEqual(NXP)
    expect(useAppContext.getState().team).toBeNull()
    // …and the request was made, so the eventual click paints from cache.
    expect(mockGET).toHaveBeenCalledTimes(1)
    expect(qc.getQueryData(['project', PAY.id])).toEqual({
      projectId: PAY.id,
      projectKey: PAY.key,
      projectName: PAY.name,
    })
  })

  it('DOES switch project when the navigation is real', async () => {
    mockGET.mockResolvedValue(ok(PAY))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await adoptRecordProject(qc, PAY.id)

    expect(useAppContext.getState().project).toEqual({
      projectId: PAY.id,
      projectKey: PAY.key,
      projectName: PAY.name,
    })
    // The Team belonged to the project being left, exactly as the shell's own switcher does.
    expect(useAppContext.getState().team).toBeNull()
  })

  it('leaves the selected Team alone on a preload of the project already selected', async () => {
    // The case that made this invisible: inside a project-scoped list the ids match, the early
    // return fires, and nothing happens either way. Pinned so the early return cannot be "tidied"
    // into a store write.
    useAppContext.setState({ project: NXP, team: { teamId: 't-1', teamName: 'Team Alpha' } })

    await adoptRecordProject(new QueryClient(), NXP.projectId, { commit: false })

    expect(useAppContext.getState().team).toEqual({ teamId: 't-1', teamName: 'Team Alpha' })
    expect(mockGET).not.toHaveBeenCalled()
  })
})
