/**
 * Iterations API hooks — TanStack Query wrappers.
 *
 * Rally "Iteration" is the timebox entity (formerly Sprint). State follows the
 * Rally vocabulary: planning → committed → accepted. Endpoints live under
 * /v1/iterations (see libs/modules/iterations).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

export type IterationState = 'planning' | 'committed' | 'accepted'

export type Iteration = components['schemas']['IterationResponseDto']
export type CreateIterationInput = components['schemas']['CreateIterationDto']
export type UpdateIterationInput = components['schemas']['UpdateIterationDto']
export type IterationStatus = components['schemas']['IterationStatusResponseDto']
export type IterationStatusItem = IterationStatus['items'][number]
export type CreateIterationItemInput = components['schemas']['CreateIterationItemDto']

export const iterationKeys = {
  all: ['iterations'] as const,
  list: (projectId: string) => ['iterations', projectId] as const,
  detail: (id: string) => ['iteration', id] as const,
  status: (id: string, filters?: unknown) =>
    filters ? (['iteration-status', id, filters] as const) : (['iteration-status', id] as const),
}

// ── List ────────────────────────────────────────────────────────────────────

export function useIterations(projectId: string | undefined, teamId?: string) {
  return useQuery({
    queryKey: [...iterationKeys.list(projectId ?? ''), teamId ?? null],
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/iterations', {
        params: { query: { projectId, teamId, limit: 100 } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data?.data ?? []) as Iteration[]
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

// Committed iterations count across all projects (the Rally "active" timebox).
export function useCommittedIterationsCount(projects: Array<{ id: string }>) {
  return useQuery({
    queryKey: ['committed-iterations-count', [...projects.map((p) => p.id)].sort()],
    queryFn: async () => {
      if (projects.length === 0) return 0
      const allIterations = await Promise.all(
        projects.map(async (project) => {
          const { data } = await apiClient.GET('/v1/iterations', {
            params: { query: { projectId: project.id, limit: 100 } },
          })
          return (data?.data ?? []) as Iteration[]
        }),
      )
      return allIterations.flat().filter((i) => i.state === 'committed').length
    },
    enabled: projects.length > 0,
    staleTime: 60_000,
  })
}

// ── Detail ──────────────────────────────────────────────────────────────────

export function useIteration(id: string | undefined) {
  return useQuery({
    queryKey: iterationKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/iterations/{id}', {
        params: { path: { id: id! } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Iteration
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateIteration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateIterationInput) => {
      const { data, error, response } = await apiClient.POST('/v1/iterations', { body: input })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Iteration
    },
    onSuccess: (iteration) => {
      void qc.invalidateQueries({ queryKey: iterationKeys.list(iteration.projectId) })
    },
  })
}

export function useUpdateIteration(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateIterationInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/iterations/{id}', {
        params: { path: { id } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Iteration
    },
    onSuccess: (iteration) => {
      qc.setQueryData(iterationKeys.detail(id), iteration)
      void qc.invalidateQueries({ queryKey: iterationKeys.list(iteration.projectId) })
    },
  })
}

// ── Iteration Status (P2.3) ─────────────────────────────────────────────────

export type IterationStatusSortBy =
  | 'rank'
  | 'itemKey'
  | 'type'
  | 'title'
  | 'scheduleState'
  | 'planEstimate'
  | 'taskEstimate'
  | 'toDo'

export interface IterationStatusFilters {
  q?: string
  type?: IterationStatusItem['type']
  scheduleState?: IterationStatusItem['scheduleState']
  isBlocked?: boolean
  assigneeId?: string
  sortBy?: IterationStatusSortBy
  sortDirection?: 'asc' | 'desc'
}

export function useIterationStatus(id: string | undefined, filters: IterationStatusFilters = {}) {
  return useQuery({
    queryKey: iterationKeys.status(id ?? '', filters),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/iterations/{id}/status', {
        params: { path: { id: id! }, query: { ...filters, limit: 100 } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as IterationStatus
    },
    enabled: !!id,
    staleTime: 15_000,
  })
}

export function useCreateIterationItem(iterationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateIterationItemInput) => {
      const { data, error, response } = await apiClient.POST('/v1/iterations/{id}/work-items', {
        params: { path: { id: iterationId } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as { workItemId: string }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: iterationKeys.status(iterationId) })
    },
  })
}
