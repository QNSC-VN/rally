/**
 * Work Items API hooks — TanStack Query wrappers for Phase 1.
 * All types derive from the generated OpenAPI contract (never hand-written).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { iterationKeys } from '@/features/iterations/api'
import type { components } from '@/shared/api/generated/api'

// ── Response types from generated contract ────────────────────────────────────

export type WorkItem = components['schemas']['WorkItemResponseDto']
export type ActivityLog = components['schemas']['ActivityResponseDto']
export type TaskTotals = components['schemas']['TaskTotalsResponseDto']
export type Watcher = components['schemas']['WatcherResponseDto']
export type TimeLog = components['schemas']['TimeLogResponseDto']
export type CreateTimeLogInput = components['schemas']['CreateTimeLogDto']
export type UpdateTimeLogInput = components['schemas']['UpdateTimeLogDto']

// ── Convenience aliases (BA design names) ─────────────────────────────────────

export type WiType = WorkItem['type']
export type WiPriority = WorkItem['priority']
export type WiScheduleState = WorkItem['scheduleState']

// ── Query keys ────────────────────────────────────────────────────────────────

/**
 * Build a stable, deterministic string from filter values so that
 * TanStack Query's key-hash always changes when any value changes.
 * (JSON.stringify drops undefined properties, which causes collisions.)
 */
function filterHash(f: Record<string, unknown>): string {
  return Object.entries(f)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

export const workItemKeys = {
  all: ['work-items'] as const,
  list: (projectId: string, filters?: Record<string, unknown>) =>
    [...workItemKeys.all, 'list', projectId, filterHash(filters ?? {})] as const,
  backlog: (projectId: string, filters?: Record<string, unknown>) =>
    [...workItemKeys.all, 'backlog', projectId, filterHash(filters ?? {})] as const,
  detail: (id: string) => [...workItemKeys.all, 'detail', id] as const,
  byKey: (itemKey: string, projectId?: string | null) =>
    [...workItemKeys.all, 'by-key', itemKey, projectId ?? null] as const,
  tasks: (workItemId: string) => [...workItemKeys.all, 'tasks', workItemId] as const,
  taskTotals: (workItemId: string) => [...workItemKeys.all, 'task-totals', workItemId] as const,
  activity: (workItemId: string) => [...workItemKeys.all, 'activity', workItemId] as const,
  watchers: (workItemId: string) => [...workItemKeys.all, 'watchers', workItemId] as const,
  labels: (workItemId: string) => [...workItemKeys.all, 'labels', workItemId] as const,
  timeLogs: (workItemId: string) => [...workItemKeys.all, 'time-logs', workItemId] as const,
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
  /** Server-side sort as `"<field>[:asc|:desc]"`; omit for the default rank order. */
  sort?: string
  limit?: number
  cursor?: string
}

export function useBacklog(projectId: string | undefined, filters: BacklogFilters = {}) {
  return useQuery({
    queryKey: workItemKeys.backlog(projectId ?? '', filters as Record<string, unknown>),
    queryFn: async () => {
      if (!projectId)
        return { data: [], pageInfo: { hasNextPage: false, nextCursor: null, limit: 25, total: 0 } }
      const { data, error, response } = await apiClient.GET('/v1/work-items/backlog', {
        params: {
          query: {
            projectId,
            type: filters.type as 'story' | 'defect' | undefined,
            scheduleState: filters.scheduleState as
              'idea' | 'defined' | 'in_progress' | 'completed' | 'accepted' | 'release' | undefined,
            assigneeId: filters.assigneeId,
            iterationId: filters.iterationId,
            releaseId: filters.releaseId,
            teamId: filters.teamId,
            q: filters.q,
            sort: filters.sort,
            limit: filters.limit ?? 50,
            cursor: filters.cursor,
          },
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      const res = data as
        | {
            data?: WorkItem[]
            pageInfo?: {
              hasNextPage: boolean
              nextCursor: string | null
              limit: number
              total?: number
            }
          }
        | undefined
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

// ── Child Defects (defects with parentId set to a story) ────────────────────

export const childDefectsKeys = {
  all: ['child-defects'] as const,
  byParent: (parentId: string) => [...childDefectsKeys.all, parentId] as const,
}

export function useChildDefects(parentId: string | undefined, projectId?: string) {
  return useQuery({
    queryKey: childDefectsKeys.byParent(parentId ?? ''),
    queryFn: async () => {
      if (!parentId) return []
      const { data, error, response } = await apiClient.GET('/v1/work-items', {
        params: {
          query: {
            projectId: projectId ?? '',
            parentId,
            type: 'defect' as const,
            limit: 100,
          },
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data?: WorkItem[] } | undefined)?.data ?? []
    },
    enabled: !!parentId && !!projectId,
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

// ── Labels (Tags) ─────────────────────────────────────────────────────────────

/** A label/tag attached to a work item (from the labels endpoint). */
export interface WorkItemLabel {
  id: string
  name: string
  color: string
}

export function useWorkItemLabels(workItemId: string | undefined) {
  return useQuery({
    queryKey: workItemKeys.labels(workItemId ?? ''),
    queryFn: async () => {
      if (!workItemId) return []
      const { data, error, response } = await apiClient.GET('/v1/work-items/{id}/labels', {
        params: { path: { id: workItemId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data ?? []) as WorkItemLabel[]
    },
    enabled: !!workItemId,
    staleTime: 15_000,
  })
}

export interface WorkItemMilestone {
  id: string
  name: string
}

/**
 * Replace-set the milestones assigned to a work item. Mirrors the label
 * association pattern; the read-models that surface milestones (iteration
 * status, backlog) are refreshed on success.
 */
export function useSetWorkItemMilestones(workItemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (milestoneIds: string[]) => {
      const { data, error, response } = await apiClient.PUT('/v1/work-items/{id}/milestones', {
        params: { path: { id: workItemId } },
        body: { ids: milestoneIds },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data ?? []) as WorkItemMilestone[]
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: iterationKeys.statusAll })
    },
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
      if (item.parentId) {
        void qc.invalidateQueries({ queryKey: childDefectsKeys.byParent(item.parentId) })
      }
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
    onSuccess: (item, variables) => {
      qc.setQueryData(workItemKeys.detail(id), item)
      // Also update the work-item-by-key cache so WorkItemDetailPage reflects immediately.
      // Must pass projectId to match the exact cache key used by useWorkItemByKey().
      qc.setQueriesData({ queryKey: workItemKeys.byKey(item.itemKey, item.projectId) }, item)
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
      // Invalidate iteration-status cache so the Iteration Status page reflects
      // schedule-state / iteration changes immediately.
      void qc.invalidateQueries({ queryKey: iterationKeys.statusAll })
      // If this item is a task, invalidate its parent's task list/rollup so the
      // expanded task row (e.g. the state segmented control) reflects the change
      // without waiting for a stale-time refetch.
      if (item.parentId) {
        void qc.invalidateQueries({ queryKey: workItemKeys.tasks(item.parentId) })
        void qc.invalidateQueries({ queryKey: workItemKeys.taskTotals(item.parentId) })
        // If this item is a defect under a story, invalidate child defects cache
        if (item.type === 'defect') {
          void qc.invalidateQueries({ queryKey: childDefectsKeys.byParent(item.parentId) })
        }
      }
      // If parentId changed, also invalidate old parent's child defects
      if (
        variables.parentId !== undefined &&
        variables.parentId !== item.parentId &&
        variables.parentId
      ) {
        void qc.invalidateQueries({ queryKey: childDefectsKeys.byParent(variables.parentId) })
      }
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
      // Iteration Status shows work items too — refresh it after a deletion.
      void qc.invalidateQueries({ queryKey: iterationKeys.statusAll })
    },
  })
}

/**
 * Update a work item by id supplied at call time (vs. `useUpdateWorkItem(id)`
 * which binds the id when the hook is created). Enables bulk operations that
 * iterate over a selection — a single mutation instance can be reused for every
 * id, which the Rules of Hooks forbid with the id-bound variant.
 */
export function useUpdateAnyWorkItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateWorkItemInput }) => {
      const { data, error, response } = await apiClient.PATCH('/v1/work-items/{id}', {
        params: { path: { id } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as WorkItem
    },
    onSuccess: (item) => {
      qc.setQueryData(workItemKeys.detail(item.id), item)
      qc.setQueriesData({ queryKey: workItemKeys.byKey(item.itemKey, item.projectId) }, item)
      void qc.invalidateQueries({ queryKey: workItemKeys.backlog(item.projectId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.list(item.projectId) })
      void qc.invalidateQueries({ queryKey: iterationKeys.statusAll })
      if (item.parentId) {
        void qc.invalidateQueries({ queryKey: workItemKeys.tasks(item.parentId) })
        void qc.invalidateQueries({ queryKey: workItemKeys.taskTotals(item.parentId) })
      }
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
    queryKey: workItemKeys.list(
      params?.projectId ?? '',
      (params as unknown as Record<string, unknown>) ?? {},
    ),
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

// ── Time logs (Jira-style worklog) ──────────────────────────────────────────────
// `work_items.actual_hours` is trigger-derived from the SUM of a work item's
// time logs (trg_sync_actual_hours), so logging time is the single source of
// truth for Actual hours. Mutations invalidate the whole work-item tree so the
// derived Actual value + parent task roll-ups refresh everywhere.

export function useTimeLogs(workItemId: string | undefined) {
  return useQuery({
    queryKey: workItemKeys.timeLogs(workItemId ?? ''),
    queryFn: async () => {
      if (!workItemId) return [] as TimeLog[]
      const { data, error, response } = await apiClient.GET('/v1/work-items/{id}/time-logs', {
        params: { path: { id: workItemId }, query: { pageSize: 100 } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      // The controller returns a `{ items, total }` envelope at runtime even
      // though the generated contract declares a bare array (backend
      // @ApiResponse decorator omits the envelope) — normalise both shapes.
      const res = data as unknown as { items?: TimeLog[] } | TimeLog[] | undefined
      return Array.isArray(res) ? res : (res?.items ?? [])
    },
    enabled: !!workItemId,
    staleTime: 15_000,
  })
}

function invalidateAfterTimeLog(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: workItemKeys.all })
  void qc.invalidateQueries({ queryKey: iterationKeys.statusAll })
}

export function useLogTime(workItemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTimeLogInput) => {
      const { data, error, response } = await apiClient.POST('/v1/work-items/{id}/time-logs', {
        params: { path: { id: workItemId } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as TimeLog
    },
    onSuccess: () => invalidateAfterTimeLog(qc),
  })
}

export function useDeleteTimeLog(workItemId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (logId: string) => {
      const { error, response } = await apiClient.DELETE('/v1/work-items/{id}/time-logs/{logId}', {
        params: { path: { id: workItemId, logId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => invalidateAfterTimeLog(qc),
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
      void qc.invalidateQueries({ queryKey: iterationKeys.statusAll })
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
      void qc.invalidateQueries({ queryKey: iterationKeys.statusAll })
      void qc.invalidateQueries({ queryKey: ['team-status'] })
    },
  })
}

export function useRankAnyWorkItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string } & RankWorkItemInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/work-items/{id}/rank', {
        params: { path: { id } },
        body: input as RankWorkItemInput,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as WorkItem
    },
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: workItemKeys.backlog(item.projectId) })
      void qc.invalidateQueries({ queryKey: workItemKeys.list(item.projectId) })
      void qc.invalidateQueries({ queryKey: iterationKeys.statusAll })
      void qc.invalidateQueries({ queryKey: ['team-status'] })
    },
  })
}

// ── Relations (F6 — work-item linking) ────────────────────────────────────────
// New endpoints; called via raw fetch (mirrors the attachment-upload pattern)
// until the generated OpenAPI client is regenerated against the live API.

export type WorkItemRelationType = 'blocks' | 'duplicates' | 'relates_to' | 'depends_on' | 'causes'

export interface WorkItemRelationView {
  id: string
  relationType: WorkItemRelationType
  direction: 'outbound' | 'inbound'
  label: string
  relatedItem: {
    id: string
    itemKey: string
    title: string
    type: string
    scheduleState: string
  }
  createdAt: string
}

const relationKeys = {
  list: (workItemId: string) => ['work-item-relations', workItemId] as const,
}

export function useRelations(workItemId: string | undefined) {
  return useQuery({
    queryKey: relationKeys.list(workItemId ?? ''),
    queryFn: async (): Promise<WorkItemRelationView[]> => {
      if (!workItemId) return []
      const res = await fetch(`/v1/work-items/${workItemId}/relations`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`Failed to load linked items (${res.status})`)
      return (await res.json()) as WorkItemRelationView[]
    },
    enabled: !!workItemId,
    staleTime: 15_000,
  })
}

export function useLinkWorkItem(workItemId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      targetId: string
      relationType: WorkItemRelationType
    }): Promise<WorkItemRelationView[]> => {
      if (!workItemId) throw new Error('workItemId required')
      const res = await fetch(`/v1/work-items/${workItemId}/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        throw new Error(body?.message ?? `Failed to link item (${res.status})`)
      }
      return (await res.json()) as WorkItemRelationView[]
    },
    onSuccess: () => {
      if (workItemId) void qc.invalidateQueries({ queryKey: relationKeys.list(workItemId) })
    },
  })
}

export function useUnlinkWorkItem(workItemId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (relationId: string): Promise<void> => {
      if (!workItemId) throw new Error('workItemId required')
      const res = await fetch(`/v1/work-items/${workItemId}/relations/${relationId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`Failed to remove link (${res.status})`)
    },
    onSuccess: () => {
      if (workItemId) void qc.invalidateQueries({ queryKey: relationKeys.list(workItemId) })
    },
  })
}
