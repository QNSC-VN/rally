import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { iterationKeys } from '@/features/iterations/api'
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

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
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
  it('POSTs to /v1/work-items and invalidates backlog + list for the project', async () => {
    const item = { id: 'wi-1', projectId: 'proj-1' }
    mockPOST.mockResolvedValue({ data: item, error: undefined, response: { status: 201 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useCreateWorkItem(), { wrapper: makeWrapper(qc) })
    result.current.mutate({ title: 'New' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockPOST).toHaveBeenCalledWith('/v1/work-items', { body: { title: 'New' } })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.backlog('proj-1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.list('proj-1') })
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

  it('invalidates backlog, activity and iteration-status, but NOT task lists when the item has no parent', async () => {
    const item = { id: 'wi-1', projectId: 'proj-1', itemKey: 'RALLY-1', parentId: null }
    mockPATCH.mockResolvedValue({ data: item, error: undefined, response: { status: 200 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateWorkItem('wi-1'), { wrapper: makeWrapper(qc) })
    result.current.mutate({ title: 'Renamed' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.backlog('proj-1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.activity('wi-1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: iterationKeys.statusAll })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: workItemKeys.tasks(expect.anything()) })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: workItemKeys.taskTotals(expect.anything()) })
  })

  // Regression test: onSuccess previously failed to invalidate the parent task
  // list/rollup after a task-state edit, so the expanded task row on the parent
  // work item didn't refresh. Locks in the fix.
  it('regression: invalidates the parent task list + totals when the updated item has a parentId', async () => {
    const item = { id: 'task-1', projectId: 'proj-1', itemKey: 'RALLY-2', parentId: 'wi-parent' }
    mockPATCH.mockResolvedValue({ data: item, error: undefined, response: { status: 200 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateWorkItem('task-1'), { wrapper: makeWrapper(qc) })
    result.current.mutate({ scheduleState: 'in_progress' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.tasks('wi-parent') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.taskTotals('wi-parent') })
  })

  it('updates the detail cache with the returned item', async () => {
    const item = { id: 'wi-1', projectId: 'proj-1', itemKey: 'RALLY-1', parentId: null, title: 'Renamed' }
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

    expect(mockDELETE).toHaveBeenCalledWith('/v1/work-items/{id}', { params: { path: { id: 'wi-1' } } })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.backlog('proj-1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.list('proj-1') })
  })
})

describe('useCreateTask', () => {
  it('POSTs to /v1/work-items/{id}/tasks and invalidates the parent tasks, totals and activity', async () => {
    mockPOST.mockResolvedValue({ data: { id: 'task-1' }, error: undefined, response: { status: 201 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useCreateTask('wi-parent'), { wrapper: makeWrapper(qc) })
    result.current.mutate({ title: 'Task' } as never)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockPOST).toHaveBeenCalledWith('/v1/work-items/{id}/tasks', {
      params: { path: { id: 'wi-parent' } },
      body: { title: 'Task' },
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.tasks('wi-parent') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.taskTotals('wi-parent') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: workItemKeys.activity('wi-parent') })
  })
})
