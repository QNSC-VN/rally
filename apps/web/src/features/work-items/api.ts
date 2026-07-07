/**
 * Work Items API hooks — TanStack Query wrappers for Phase 1.
 * All types derive from the generated OpenAPI contract (never hand-written).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

// ── Response types from generated contract ────────────────────────────────────

export type WorkItem = components['schemas']['WorkItemResponseDto']
export type ActivityLog = components['schemas']['ActivityResponseDto']
export type TaskTotals = components['schemas']['TaskTotalsResponseDto']
export type Watcher = components['schemas']['WatcherResponseDto']

// ── Convenience aliases (BA design names) ─────────────────────────────────────

export type WiType = WorkItem['type']
export type WiPriority = WorkItem['priority']
export type WiScheduleState = WorkItem['scheduleState']

// ── Query keys ────────────────────────────────────────────────────────────────

export const workItemKeys = {
  all: ['work-items'] as const,
  list: (projectId: string, filters?: Record<string, unknown>) =>
    [...workItemKeys.all, 'list', projectId, filters] as const,
  backlog: (projectId: string, filters?: Record<string, unknown>) =>
    [...workItemKeys.all, 'backlog', projectId, filters] as const,
  detail: (id: string) => [...workItemKeys.all, 'detail', id] as const,
  byKey: (itemKey: string, projectId?: string | null) =>
    [...workItemKeys.all, 'by-key', itemKey, projectId ?? null] as const,
  tasks: (workItemId: string) => [...workItemKeys.all, 'tasks', workItemId] as const,
  taskTotals: (workItemId: string) => [...workItemKeys.all, 'task-totals', workItemId] as const,
  activity: (workItemId: string) => [...workItemKeys.all, 'activity', workItemId] as const,
  watchers: (workItemId: string) => [...workItemKeys.all, 'watchers', workItemId] as const,
} as const

// ── Backlog list ──────────────────────────────────────────────────────────────

export interface BacklogFilters {
  type?: 'story' | 'defect'
  scheduleState?: WiScheduleState
  assigneeId?: string
  iterationId?: string
  releaseId?: string
  teamId?: string
  q?: string
  limit?: number
  cursor?: string
}

export function useBacklog(projectId: string | undefined, filters: BacklogFilters = {}) {
  return useQuery({
    queryKey: workItemKeys.backlog(projectId ?? '', filters as Record<string, unknown>),
    queryFn: async () => {
      if (!projectId) return { data: [], pageInfo: { hasNextPage: false, nextCursor: null, limit: 25, total: 0 } }
      const { data, error, response } = await apiClient.GET('/v1/work-items/backlog', {
        params: {
          query: {
            projectId,
            type: filters.type as 'story' | 'defect' | undefined,
            scheduleState: filters.scheduleState as 'idea' | 'defined' | 'in_progress' | 'completed' | 'accepted' | 'released' | undefined,
            assigneeId: filters.assigneeId,
            iterationId: filters.iterationId,
            releaseId: filters.releaseId,
            teamId: filters.teamId,
            q: filters.q,
            limit: filters.limit ?? 50,
            cursor: filters.cursor,
          },
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      const res = data as { data?: WorkItem[]; pageInfo?: { hasNextPage: boolean; nextCursor: string | null; limit: number; total?: number } } | undefined
      return {
        data: res?.data ?? [],
        pageInfo: res?.pageInfo ?? { hasNextPage: false, nextCursor: null, limit: 50, total: 0 },
      }
    },
    enabled: !!projectId,
    staleTime: 15_000,
  })
}

// ── Work Item detail ──────────────────────────────────────────────────────────

export function useWorkItem(id: string | undefined) {
  return useQuery({
    queryKey: workItemKeys.detail(id ?? ''),
    queryFn: async () => {
      if (!id) return null
      const { data, error, response } = await apiClient.GET('/v1/work-items/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as WorkItem
    },
    enabled: !!id,
    staleTime: 15_000,
  })
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export function useTasks(workItemId: string | undefined) {
  return useQuery({
    queryKey: workItemKeys.tasks(workItemId ?? ''),
    queryFn: async () => {
      if (!workItemId) return []
      const { data, error, response } = await apiClient.GET('/v1/work-items/{id}/tasks', {
        params: { path: { id: workItemId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      // API returns WorkItemResponseDto[] directly (not wrapped)
      return (data as WorkItem[]) ?? []
    },
    enabled: !!workItemId,
    staleTime: 15_000,
  })
}

export function useTaskTotals(workItemId: string | undefined) {
  return useQuery({
    queryKey: workItemKeys.taskTotals(workItemId ?? ''),
    queryFn: async () => {
      if (!workItemId) return null
      const { data, error, response } = await apiClient.GET('/v1/work-items/{id}/tasks/totals', {
        params: { path: { id: workItemId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as TaskTotals
    },
    enabled: !!workItemId,
    staleTime: 15_000,
  })
}

// ── Activity Log ──────────────────────────────────────────────────────────────

export function useActivityLog(workItemId: string | undefined) {
  return useQuery({
    queryKey: workItemKeys.activity(workItemId ?? ''),
    queryFn: async () => {
      if (!workItemId) return []
      const { data, error, response } = await apiClient.GET('/v1/work-items/{id}/activity', {
        params: { path: { id: workItemId }, query: { page: 1, pageSize: 100 } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      // API returns { data: ActivityResponseDto[]; total: number; page: number; pageSize: number }
      return (data as { data?: ActivityLog[] } | undefined)?.data ?? []
    },
    enabled: !!workItemId,
    staleTime: 15_000,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export type CreateWorkItemInput = components['schemas']['CreateWorkItemDto']
export type UpdateWorkItemInput = components['schemas']['UpdateWorkItemDto']
export type CreateTaskInput = components['schemas']['CreateTaskDto']

export function useCreateWorkItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateWorkItemInput) => {
      const { data, error, response } = await apiClient.POST('/v1/work-items', { body: input })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as WorkItem
    },
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: workItemKeys.backlog(item.projectId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.list(item.projectId) })
    },
  })
}

export function useUpdateWorkItem(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateWorkItemInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/work-items/{id}', {
        params: { path: { id } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as WorkItem
    },
    onSuccess: (item) => {
      qc.setQueryData(workItemKeys.detail(id), item)
      // Also update the work-item-by-key cache so WorkItemDetailPage reflects immediately
      qc.setQueriesData({ queryKey: workItemKeys.byKey(item.itemKey) }, item)
      // Optimistically update the item inside any cached backlog list so the
      // inline-edit selects reflect the new value without waiting for the refetch.
      qc.setQueriesData<{ data?: WorkItem[]; pageInfo?: unknown }>(
        { queryKey: workItemKeys.backlog(item.projectId) },
        (old) => {
          if (!old?.data) return old
          return { ...old, data: old.data.map((w) => (w.id === item.id ? item : w)) }
        },
      )
      void qc.invalidateQueries({ queryKey: workItemKeys.backlog(item.projectId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.activity(id) })
    },
  })
}

export function useCreateTask(parentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const { data, error, response } = await apiClient.POST('/v1/work-items/{id}/tasks', {
        params: { path: { id: parentId } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as WorkItem
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workItemKeys.tasks(parentId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.taskTotals(parentId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.activity(parentId) })
    },
  })
}

export function useDeleteWorkItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      const { error, response } = await apiClient.DELETE('/v1/work-items/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return projectId
    },
    onSuccess: (projectId) => {
      void qc.invalidateQueries({ queryKey: workItemKeys.backlog(projectId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.list(projectId) })
    },
  })
}

// ── Legacy hooks (used by home page) ─────────────────────────────────────────

export interface ListWorkItemsParams {
  projectId: string
  type?: WiType
  statusId?: string
  assigneeId?: string
  iterationId?: string
  releaseId?: string
  limit?: number
}

export function useWorkItems(params: ListWorkItemsParams | null) {
  return useQuery({
    queryKey: workItemKeys.list(params?.projectId ?? '', (params as unknown as Record<string, unknown>) ?? {}),
    queryFn: async () => {
      if (!params) return []
      const { data, error, response } = await apiClient.GET('/v1/work-items', {
        params: {
          query: {
            projectId: params.projectId,
            type: params.type as 'initiative' | 'feature' | 'story' | 'task' | 'defect' | undefined,
            statusId: params.statusId,
            assigneeId: params.assigneeId,
            iterationId: params.iterationId,
            releaseId: params.releaseId,
            limit: params.limit ?? 100,
          },
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data?: WorkItem[] } | undefined)?.data ?? []
    },
    enabled: !!params,
    staleTime: 30_000,
  })
}

export function useMyWorkItems(
  projects: Array<{ id: string; key: string; name: string }>,
  userId: string | undefined,
) {
  return useQuery({
    queryKey: ['my-work-items', [...projects.map((p) => p.id)].sort(), userId],
    queryFn: async () => {
      if (!userId || projects.length === 0) return []
      const results = await Promise.all(
        projects.map(async (project) => {
          const { data } = await apiClient.GET('/v1/work-items', {
            params: { query: { projectId: project.id, assigneeId: userId, limit: 50 } },
          })
          const items = (data as { data: WorkItem[] } | undefined)?.data ?? []
          return items.map((item) => ({
            ...item,
            projectKey: project.key,
            projectName: project.name,
          }))
        }),
      )
      return results.flat()
    },
    enabled: !!userId && projects.length > 0,
    staleTime: 30_000,
  })
}

export function useWorkItemCounts(projects: Array<{ id: string }>) {
  return useQuery({
    queryKey: ['work-item-counts', [...projects.map((p) => p.id)].sort()],
    queryFn: async () => {
      if (projects.length === 0) return { total: 0, blocked: 0, defects: 0 }
      const allItems = await Promise.all(
        projects.map(async (project) => {
          const { data } = await apiClient.GET('/v1/work-items', {
            params: { query: { projectId: project.id, limit: 100 } },
          })
          return (data as { data: WorkItem[] } | undefined)?.data ?? []
        }),
      )
      const flat = allItems.flat()
      return {
        total: flat.length,
        blocked: flat.filter((i) => i.isBlocked).length,
        defects: flat.filter((i) => i.type === 'defect').length,
      }
    },
    enabled: projects.length > 0,
    staleTime: 30_000,
  })
}

export function useCommittedIterationsWorkItems(projectIds: string[], userId?: string) {
  return useQuery({
    queryKey: ['work-items-committed-iterations', projectIds.sort(), userId],
    queryFn: async () => {
      if (projectIds.length === 0) return []
      const results = await Promise.all(
        projectIds.map(async (projectId) => {
          const { data } = await apiClient.GET('/v1/work-items', {
            params: { query: { projectId, assigneeId: userId, limit: 50 } },
          })
          return (data as { data: WorkItem[] } | undefined)?.data ?? []
        }),
      )
      return results.flat()
    },
    enabled: projectIds.length > 0,
    staleTime: 30_000,
  })
}

// ── Watchers (P1-23) ──────────────────────────────────────────────────────────

export function useWatchers(workItemId: string | undefined) {
  return useQuery({
    queryKey: workItemKeys.watchers(workItemId ?? ''),
    queryFn: async () => {
      if (!workItemId) return [] as Watcher[]
      const { data, error, response } = await apiClient.GET('/v1/work-items/{id}/watchers', {
        params: { path: { id: workItemId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data ?? []) as Watcher[]
    },
    enabled: !!workItemId,
    staleTime: 30_000,
  })
}

/** Toggle watch on/off for the current user. Returns true = now watching. */
export function useToggleWatch(workItemId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (watching: boolean) => {
      if (!workItemId) throw new Error('workItemId required')
      if (watching) {
        const { error, response } = await apiClient.DELETE('/v1/work-items/{id}/watchers', {
          params: { path: { id: workItemId } },
        })
        if (error) throw new Error(apiErrorMessage(error, response.status))
      } else {
        const { error, response } = await apiClient.POST('/v1/work-items/{id}/watchers', {
          params: { path: { id: workItemId } },
        })
        if (error) throw new Error(apiErrorMessage(error, response.status))
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workItemKeys.watchers(workItemId ?? '') })
    },
  })
}

// ── Bulk assignment + reorder (P2-BL-03/04/05) ──────────────────────────────────

export type BulkAssignReleaseInput = components['schemas']['BulkAssignReleaseDto']
export type BulkAssignIterationInput = components['schemas']['BulkAssignIterationDto']
export type RankWorkItemInput = components['schemas']['RankWorkItemDto']

export function useBulkAssignRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: BulkAssignReleaseInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/work-items/bulk-release', {
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as { updated: number }
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: workItemKeys.backlog(input.projectId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.list(input.projectId) })
    },
  })
}

export function useBulkAssignIteration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: BulkAssignIterationInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/work-items/bulk-iteration', {
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as { updated: number }
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: workItemKeys.backlog(input.projectId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.list(input.projectId) })
      void qc.invalidateQueries({ queryKey: ['iteration-status'] })
    },
  })
}

export function useRankWorkItem(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RankWorkItemInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/work-items/{id}/rank', {
        params: { path: { id } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as WorkItem
    },
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: workItemKeys.backlog(item.projectId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.list(item.projectId) })
      void qc.invalidateQueries({ queryKey: ['iteration-status'] })
    },
  })
}

export function useRankWorkItemMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: RankWorkItemInput }) => {
      const { data, error, response } = await apiClient.PATCH('/v1/work-items/{id}/rank', {
        params: { path: { id } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as WorkItem
    },
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: workItemKeys.backlog(item.projectId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.list(item.projectId) })
      void qc.invalidateQueries({ queryKey: ['iteration-status'] })
    },
  })
}
