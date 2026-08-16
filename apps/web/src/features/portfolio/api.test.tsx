/**
 * `usePortfolioChildren` drains every page — the Feature Children truncation test.
 *
 * The defect: the hook asked for `limit: PAGE_SIZE` (100) and DISCARDED `pageInfo`, while its own
 * comment claimed the children arrive in "one response". Every consumer paginates on the client
 * (`useClientPagination` in the Children tab, `slice()` in the two disclosure previews), so past 100
 * children the tab's count, its totals row and the `+N more` label all described 100 rows as if they
 * were the whole set — a grid that looks complete, with nothing on screen distinguishing it from one
 * that is.
 *
 * Two halves, both needed: the rows of every page arrive in order from ONE call (a single-page mock
 * passes against the defect, which is why there are three pages here), and the loop TERMINATES —
 * asserted as an exact request count with the exact cursors, because the failure mode on the other
 * side of a drain is an unbounded one.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { usePortfolioChildren } from './api'

const mockGET = apiClient.GET as ReturnType<typeof vi.fn>

function child(id: string, itemKey: string) {
  return { id, itemKey, type: 'story', title: itemKey, scheduleState: 'defined', rank: id }
}

function page(rows: ReturnType<typeof child>[], nextCursor: string | null) {
  return {
    data: { data: rows, pageInfo: { nextCursor, hasNextPage: nextCursor !== null, limit: 100 } },
    error: undefined,
    response: { status: 200 },
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  // `reset`, not `clear`: `clearAllMocks` keeps the `…Once` queue, so a test that consumes fewer
  // pages than it queued — which is exactly what a broken drain does — poisons the next one.
  vi.resetAllMocks()
})

describe('usePortfolioChildren', () => {
  it('returns the children of EVERY page, in order', async () => {
    mockGET
      .mockResolvedValueOnce(page([child('w-1', 'US-5'), child('w-2', 'US-12')], 'cursor-2'))
      .mockResolvedValueOnce(page([child('w-3', 'DE-3')], 'cursor-3'))
      .mockResolvedValueOnce(page([child('w-4', 'US-99')], null))

    const { result } = renderHook(() => usePortfolioChildren('fe-1'), { wrapper })

    await waitFor(() => expect(result.current.data).toHaveLength(4))
    expect(result.current.data?.map((c) => c.itemKey)).toEqual(['US-5', 'US-12', 'DE-3', 'US-99'])
    expect(mockGET).toHaveBeenCalledTimes(3)
    expect(mockGET.mock.calls.map((c) => c[1].params.query.cursor)).toEqual([
      undefined,
      'cursor-2',
      'cursor-3',
    ])
  })

  it('stops after one request when there is no next page', async () => {
    mockGET.mockResolvedValue(page([child('w-1', 'US-5')], null))

    const { result } = renderHook(() => usePortfolioChildren('fe-1'), { wrapper })

    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(mockGET).toHaveBeenCalledTimes(1)
  })

  it('stops instead of looping when the server repeats a cursor', async () => {
    // A cursor that never advances would otherwise re-fetch the same page MAX_PAGES times and
    // report its rows 50 times over.
    mockGET.mockResolvedValue(page([child('w-1', 'US-5')], 'stuck'))

    const { result } = renderHook(() => usePortfolioChildren('fe-1'), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(mockGET).toHaveBeenCalledTimes(2)
    expect(result.current.data).toHaveLength(2)
  })

  it('does not fetch at all without an id', () => {
    renderHook(() => usePortfolioChildren(undefined), { wrapper })

    expect(mockGET).not.toHaveBeenCalled()
  })

  it('surfaces a failure as an error rather than an empty list', async () => {
    mockGET.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'PORTFOLIO_ITEM_NOT_FOUND', message: 'Portfolio item not found' } },
      response: { status: 404 },
    })

    const { result } = renderHook(() => usePortfolioChildren('fe-1'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
