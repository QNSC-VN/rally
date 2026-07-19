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
import { invalidateWorkItemViews } from '@/shared/api/invalidate-work-item-views'
import type { components } from '@/shared/api/generated/api'

export type IterationState = 'planning' | 'committed' | 'accepted'

export type Iteration = components['schemas']['IterationResponseDto']
export type CreateIterationInput = components['schemas']['CreateIterationDto']
export type UpdateIterationInput = components['schemas']['UpdateIterationDto']
export type IterationStatus = components['schemas']['IterationStatusResponseDto']
export type IterationStatusItem = IterationStatus['items'][number]
export type CreateIterationItemInput = components['schemas']['CreateIterationItemDto']

export type IterationOption = components['schemas']['IterationOptionDto']

export const iterationKeys = {
  all: ['iterations'] as const,
  list: (projectId: string) => ['iterations', projectId] as const,
  options: (projectId: string, teamId?: string | null) =>
    ['iteration-options', projectId, teamId ?? null] as const,
  detail: (id: string) => ['iteration', id] as const,
  committedCount: (projectIds: string[]) =>
    ['iterations', 'committed-count', [...projectIds].sort()] as const,
  statusAll: ['iteration-status'] as const,
  status: (id: string, filters?: unknown) =>
    filters
      ? ([...iterationKeys.statusAll, id, filters] as const)
      : ([...iterationKeys.statusAll, id] as const),
}

// ── Assignment options (P2-IT-10) — compact picker feed ─────────────────────

export function useIterationOptions(projectId: string | undefined, teamId?: string | null) {
  return useQuery({
    queryKey: iterationKeys.options(projectId ?? '', teamId),
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/iterations/options', {
        params: { query: { projectId, teamId: teamId ?? undefined } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data ?? []) as IterationOption[]
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

// ── List ────────────────────────────────────────────────────────────────────

/**
 * Iterations are a bounded working set (a project has a finite number of
 * timeboxes), so we follow the cursor to load the COMPLETE set instead of a
 * single 100-item page. This keeps client-side filtering/counting honest —
 * a silent first-page cap would drop iterations past the 100th. MAX_PAGES is a
 * safety ceiling against pathological loops.
 */
const MAX_PAGES = 50

async function fetchAllIterations(projectId: string, teamId?: string): Promise<Iteration[]> {
  const out: Iteration[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error, response } = await apiClient.GET('/v1/iterations', {
      params: { query: { projectId, teamId, limit: 100, cursor } },
    })
    if (error) throw new Error(apiErrorMessage(error, response.status))
    out.push(...((data?.data ?? []) as Iteration[]))
    const next = data?.pageInfo?.nextCursor
    if (!next) break
    cursor = next
  }
  return out
}

export function useIterations(projectId: string | undefined, teamId?: string) {
  return useQuery({
    queryKey: [...iterationKeys.list(projectId ?? ''), teamId ?? null],
    queryFn: () => (projectId ? fetchAllIterations(projectId, teamId) : Promise.resolve([])),
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

// Committed iterations count across all projects (the Rally "active" timebox).
export function useCommittedIterationsCount(projects: Array<{ id: string }>) {
  return useQuery({
    queryKey: iterationKeys.committedCount(projects.map((p) => p.id)),
    queryFn: async () => {
      if (projects.length === 0) return 0
      const allIterations = await Promise.all(
        projects.map((project) => fetchAllIterations(project.id)),
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

// ── Lifecycle transitions (BA F1 — gated, single-source) ─────────────────────
// Commit (Planning → Committed) and Accept (Committed → Accepted) are guarded
// server-side (one committed iteration per project; accept needs ≥1 assigned
// Story/Defect all accepted). Rollover moves the unfinished (not-accepted)
// items out to another iteration or the backlog — the mirror of the accept
// gate. These replace free-form state edits so the FE cannot bypass the rules.

export type RolloverIterationInput = components['schemas']['RolloverIterationDto']

/** Invalidate every cached view a lifecycle transition can affect. */
function invalidateIterationViews(qc: ReturnType<typeof useQueryClient>, id: string) {
  void qc.invalidateQueries({ queryKey: iterationKeys.detail(id) })
  void qc.invalidateQueries({ queryKey: iterationKeys.all })
  void qc.invalidateQueries({ queryKey: ['iteration-options'] })
  // Commit/accept/rollover move work items between states/iterations, so refresh
  // every work-item-derived read-model too (this also covers iteration-status).
  invalidateWorkItemViews(qc)
}

export function useCommitIteration(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await apiClient.POST('/v1/iterations/{id}/commit', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Iteration
    },
    onSuccess: (iteration) => {
      qc.setQueryData(iterationKeys.detail(id), iteration)
      invalidateIterationViews(qc, id)
    },
  })
}

export function useAcceptIteration(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await apiClient.POST('/v1/iterations/{id}/accept', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Iteration
    },
    onSuccess: (iteration) => {
      qc.setQueryData(iterationKeys.detail(id), iteration)
      invalidateIterationViews(qc, id)
    },
  })
}

export function useRolloverIteration(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RolloverIterationInput) => {
      const { data, error, response } = await apiClient.POST('/v1/iterations/{id}/rollover', {
        params: { path: { id } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      // The endpoint returns a bare `{ movedCount }` with no response DTO, so the
      // generated client types the body as `undefined`; the value is present at
      // runtime, hence the cast through `unknown`.
      return data as unknown as { movedCount: number }
    },
    onSuccess: () => invalidateIterationViews(qc, id),
  })
}

// ── Iteration Status (P2.3) ─────────────────────────────────────────────────

export interface IterationStatusFilters {
  q?: string
  type?: IterationStatusItem['type']
  scheduleState?: IterationStatusItem['scheduleState']
  isBlocked?: boolean
  assigneeId?: string
}

export function useIterationStatus(id: string | undefined, filters: IterationStatusFilters = {}) {
  return useQuery({
    queryKey: iterationKeys.status(id ?? '', filters),
    queryFn: async () => {
      // One iteration is a bounded working set and the Board view needs every
      // item to allow drag across columns, so we follow the cursor to load the
      // whole set. `metrics`/`iteration` are full-iteration aggregates computed
      // server-side (page-independent), so we keep them from the first page and
      // concatenate items across pages.
      let result: IterationStatus | undefined
      const items: IterationStatusItem[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error, response } = await apiClient.GET('/v1/iterations/{id}/status', {
          params: { path: { id: id! }, query: { ...filters, limit: 100, cursor } },
        })
        if (error) throw new Error(apiErrorMessage(error, response.status))
        const page$ = data as IterationStatus
        if (!result) result = page$
        items.push(...page$.items)
        const next = page$.pageInfo?.nextCursor
        if (!next) break
        cursor = next
      }
      return { ...result!, items }
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
      return data as { workItemId: string; itemKey: string }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: iterationKeys.status(iterationId) })
    },
  })
}
