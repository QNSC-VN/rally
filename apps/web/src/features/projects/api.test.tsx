import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { useProjects } from './api'
import { listResource } from '@/shared/lib/query/resource'

/**
 * `useProjects` drains every page — the truncation test.
 *
 * The defect
 * ----------
 * The hook asked for `limit: 100` and returned that one page, while all twelve consumers filtered
 * CLIENT-side. Past 100 projects the Projects grid's Active/Archived tabs, its search box and its
 * four metric tiles silently omitted rows: a grid that looks complete and a total that reads as
 * measured. Nothing on screen distinguished "4 projects" from "4 projects on the first page".
 *
 * What this pins, and why each half is needed
 * -------------------------------------------
 *  1. BOTH pages' rows arrive, in order, from ONE `useProjects` call. Without the effect-driven
 *     `fetchNextPage` the hook returns page 1 and stops — which is exactly the shipped defect, and it
 *     is invisible to any test whose mock has a single page. Hence two pages here.
 *  2. The cursor ADVANCES and the loop TERMINATES. A drain is a loop over a server-supplied token, so
 *     the failure mode on the other side is an unbounded one: a cursor that never changes, or a
 *     `hasNextPage` that never clears, would fetch until `MAX_PAGES`. Asserted as an exact call count
 *     with the exact cursors, not as "more than one call".
 *  3. A FAILURE leaves `data` undefined, so `listResource` reports `error` and not `empty`. The whole
 *     point of returning the query shape rather than a bare array (see `resource.ts`): with 100+
 *     projects the drain makes a mid-flight partial answer normal, so the phases have to stay honest.
 */

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

function project(id: string, key: string) {
  return { id, key, name: key, status: 'active', memberCount: 0, teamCount: 0 }
}

function page(rows: ReturnType<typeof project>[], nextCursor: string | null) {
  return {
    data: { data: rows, pageInfo: { nextCursor, hasNextPage: nextCursor !== null, limit: 100 } },
    error: undefined,
    response: { status: 200 },
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  // `reset`, not `clear`: `clearAllMocks` keeps the `…Once` QUEUE, so a test that consumes fewer
  // pages than it queued (which is precisely what a broken drain does) hands its leftovers to the
  // next test and fails it too. That noise is the sort that gets a real failure misread as a flake.
  vi.resetAllMocks()
})

describe('useProjects', () => {
  it('drains every page and stops when the cursor does not advance', async () => {
    mockGET
      .mockResolvedValueOnce(page([project('p-1', 'NXP'), project('p-2', 'PAY')], 'cursor-2'))
      .mockResolvedValueOnce(page([project('p-3', 'OPS')], null))

    const { result } = renderHook(() => useProjects('ws-1'), { wrapper })

    // Page 2's row is the assertion that matters: `NXP`/`PAY` alone is what the defect returned.
    await waitFor(() =>
      expect(result.current.data?.map((p) => p.key)).toEqual(['NXP', 'PAY', 'OPS']),
    )
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false))

    expect(mockGET).toHaveBeenCalledTimes(2)
    expect(mockGET).toHaveBeenNthCalledWith(1, '/v1/projects', {
      params: { query: { workspaceId: 'ws-1', limit: 100, cursor: undefined } },
    })
    expect(mockGET).toHaveBeenNthCalledWith(2, '/v1/projects', {
      params: { query: { workspaceId: 'ws-1', limit: 100, cursor: 'cursor-2' } },
    })
  })

  it('reports isLoadingMore until the last page has landed, so a count is never partial', async () => {
    // Page 2 is held on a DEFERRED promise rather than resolved immediately: the partial window is a
    // couple of microtasks wide otherwise, so an `await waitFor(…toHaveLength(1))` observes 2 and the
    // assertion is decided by luck. `CLAUDE.md` records the same lesson from a frozen-draft bug that
    // presented as a flaky test — pin the ordering, do not widen the timeout.
    let releasePage2!: () => void
    const page2 = new Promise<unknown>((resolve) => {
      releasePage2 = () => resolve(page([project('p-2', 'PAY')], null))
    })
    mockGET
      .mockResolvedValueOnce(page([project('p-1', 'NXP')], 'cursor-2'))
      .mockReturnValueOnce(page2)

    const { result } = renderHook(() => useProjects('ws-1'), { wrapper })

    // The flag exists because `rows.length` is a MEASUREMENT: taken here it is 1 of 2 — the same
    // silent truncation `limit: 100` used to ship, transient instead of permanent.
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.isLoadingMore).toBe(true)

    releasePage2()
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false))
    expect(result.current.data).toHaveLength(2)
  })

  it('leaves data undefined on failure, so listResource says error and not empty', async () => {
    mockGET.mockResolvedValue({
      data: undefined,
      error: { message: 'nope' },
      response: { status: 500 },
    })

    const { result } = renderHook(() => useProjects('ws-1'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(listResource(result.current).phase).toBe('error')
  })

  it('does not fetch at all without a workspace', () => {
    const { result } = renderHook(() => useProjects(undefined), { wrapper })
    expect(mockGET).not.toHaveBeenCalled()
    // Not `isLoading`: a disabled query is not in flight, and a permanent skeleton is what a caller
    // would render if it were.
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeUndefined()
  })
})
