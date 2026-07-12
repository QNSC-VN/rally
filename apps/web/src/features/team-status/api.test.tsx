import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { teamStatusKeys, useUpdateCapacity, useUpdateTeamTask } from './api'

const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>

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

describe('useUpdateCapacity', () => {
  it('PATCHes /v1/team-status/capacity with the scoping ids merged into the body', async () => {
    mockPATCH.mockResolvedValue({ data: { ok: true }, error: undefined, response: { status: 200 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateCapacity('proj-1', 'team-1', 'iter-1'), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ userId: 'u-1', capacityHours: 8 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockPATCH).toHaveBeenCalledWith('/v1/team-status/capacity', {
      body: { projectId: 'proj-1', teamId: 'team-1', iterationId: 'iter-1', userId: 'u-1', capacityHours: 8 },
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: teamStatusKeys.detail('proj-1', 'team-1', 'iter-1'),
    })
  })
})

describe('useUpdateTeamTask', () => {
  it('PATCHes /v1/team-status/tasks/{taskId} and invalidates all related status queries', async () => {
    mockPATCH.mockResolvedValue({ data: { ok: true }, error: undefined, response: { status: 200 } })
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateTeamTask('proj-1', 'team-1', 'iter-1'), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ taskId: 'task-1', state: 'Completed' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockPATCH).toHaveBeenCalledWith('/v1/team-status/tasks/{taskId}', {
      params: { path: { taskId: 'task-1' } },
      body: { state: 'Completed' },
    })
    expect(invalidateSpy).toHaveBeenCalledTimes(3)
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: teamStatusKeys.detail('proj-1', 'team-1', 'iter-1'),
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['iteration-status'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['work-items'],
    })
  })
})
