import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { INVALIDATION_MAP, createInvalidationMutationCache } from '@/shared/api/invalidation'
import {
  workItemKeys,
  useCreateWorkItem,
  useUpdateWorkItem,
  useDeleteWorkItem,
  useCreateTask,
} from './api'

const mockPOST = apiClient.POST as ReturnType<typeof vi.fn>
const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>
const mockDELETE = apiClient.DELETE as ReturnType<typeof vi.fn>

// Keys the `work-item` tag fans out to — the single source the mutations now
// declare via `meta: { invalidates: ['work-item'] }`.
const WORK_ITEM_ROOTS = INVALIDATION_MAP['work-item']

// Build a client wired with the real invalidation MutationCache, so the tests
// exercise the actual meta → registry → invalidateQueries path end to end.
function makeClient() {
  const ref: { current: QueryClient | null } = { current: null }
  const client = new QueryClient({
    mutationCache: createInvalidationMutationCache(() => ref.current as QueryClient),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  ref.current = client
  return client
}

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useCreateWorkItem', () => {
  it('POSTs to /v1/work-items and refreshes every work-item read-model', async () => {
    const item = { id: 'wi-1', projectId: 'proj-1' }
    mockPOST.mockResolvedValue({ data: item, error: undefined, response: { status: 201 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useCreateWorkItem(), { wrapper: makeWrapper(qc) })
    result.current.mutate({ title: 'New' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockPOST).toHaveBeenCalledWith('/v1/work-items', { body: { title: 'New' } })
    expect(invalidateSpy).toHaveBeenCalledTimes(WORK_ITEM_ROOTS.length)
    for (const queryKey of WORK_ITEM_ROOTS) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey })
    }
  })
})

describe('useUpdateWorkItem', () => {
  it('PATCHes /v1/work-items/{id} with the given id and body', async () => {
    const item = { id: 'wi-1', projectId: 'proj-1', itemKey: 'RALLY-1', parentId: null }
    mockPATCH.mockResolvedValue({ data: item, error: undefined, response: { status: 200 } })
    const qc = makeClient()

    const { result } = renderHook(() => useUpdateWorkItem('wi-1'), { wrapper: makeWrapper(qc) })
    result.current.mutate({ title: 'Renamed' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/{id}', {
      params: { path: { id: 'wi-1' } },
      body: { title: 'Renamed' },
    })
  })

  it('refreshes every work-item-derived read-model after an update', async () => {
    const item = { id: 'wi-1', projectId: 'proj-1', itemKey: 'RALLY-1', parentId: null }
    mockPATCH.mockResolvedValue({ data: item, error: undefined, response: { status: 200 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateWorkItem('wi-1'), { wrapper: makeWrapper(qc) })
    result.current.mutate({ title: 'Renamed' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Every read-model root is refreshed exactly once — the single-source fix that
    // stops inline edits reverting until reload on Quality / Team Status / etc.
    expect(invalidateSpy).toHaveBeenCalledTimes(WORK_ITEM_ROOTS.length)
    for (const queryKey of WORK_ITEM_ROOTS) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey })
    }
  })

  // Regression test: onSuccess previously failed to refresh the parent task
  // list/rollup after a task-state edit, so the expanded task row on the parent
  // work item didn't refresh. The shared work-items root now covers it.
  it('regression: refreshes the work-items root (covers parent task list) when the item has a parentId', async () => {
    const item = { id: 'task-1', projectId: 'proj-1', itemKey: 'RALLY-2', parentId: 'wi-parent' }
    mockPATCH.mockResolvedValue({ data: item, error: undefined, response: { status: 200 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateWorkItem('task-1'), { wrapper: makeWrapper(qc) })
    result.current.mutate({ scheduleState: 'in_progress' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // workItemKeys.tasks(...) is nested under this root, so it is invalidated too.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.all })
  })

  it('updates the detail cache with the returned item', async () => {
    const item = {
      id: 'wi-1',
      projectId: 'proj-1',
      itemKey: 'RALLY-1',
      parentId: null,
      title: 'Renamed',
    }
    mockPATCH.mockResolvedValue({ data: item, error: undefined, response: { status: 200 } })
    const qc = makeClient()

    const { result } = renderHook(() => useUpdateWorkItem('wi-1'), { wrapper: makeWrapper(qc) })
    result.current.mutate({ title: 'Renamed' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(qc.getQueryData(workItemKeys.detail('wi-1'))).toEqual(item)
  })
})

describe('useDeleteWorkItem', () => {
  it('DELETEs /v1/work-items/{id} and invalidates backlog + list for the project', async () => {
    mockDELETE.mockResolvedValue({ data: undefined, error: undefined, response: { status: 204 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useDeleteWorkItem(), { wrapper: makeWrapper(qc) })
    result.current.mutate({ id: 'wi-1', projectId: 'proj-1' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockDELETE).toHaveBeenCalledWith('/v1/work-items/{id}', {
      params: { path: { id: 'wi-1' } },
    })
    expect(invalidateSpy).toHaveBeenCalledTimes(WORK_ITEM_ROOTS.length)
    for (const queryKey of WORK_ITEM_ROOTS) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey })
    }
  })
})

describe('useCreateTask', () => {
  it('POSTs to /v1/work-items/{id}/tasks and invalidates the parent tasks, totals and activity', async () => {
    mockPOST.mockResolvedValue({
      data: { id: 'task-1' },
      error: undefined,
      response: { status: 201 },
    })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useCreateTask('wi-parent'), { wrapper: makeWrapper(qc) })
    result.current.mutate({ title: 'Task' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockPOST).toHaveBeenCalledWith('/v1/work-items/{id}/tasks', {
      params: { path: { id: 'wi-parent' } },
      body: { title: 'Task' },
    })
    // Tasks/totals/activity live under the work-items root; Team Status shows the
    // same task, so all read-models are refreshed via the shared helper.
    expect(invalidateSpy).toHaveBeenCalledTimes(WORK_ITEM_ROOTS.length)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.all })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['team-status'] })
  })
})
