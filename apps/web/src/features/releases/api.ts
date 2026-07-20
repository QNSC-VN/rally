/**
 * Releases API hooks — TanStack Query wrappers.
 * P3.2: Updated for Planning/Active/Accepted states and new fields.
 */
import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

// ── Types ────────────────────────────────────────────────────────────────────

export type ReleaseStatus = 'planning' | 'active' | 'accepted'

export interface TaskRollup {
  totalItems: number
  completedItems: number
  acceptedItems: number
  toDoItems: number
  totalPoints: number
  completedPoints: number
  toDoPoints: number
  progressPercent: number
}

export interface Release {
  id: string
  tenantId: string
  projectId: string
  name: string
  description: string | null
  theme: string | null
  notes: string | null
  status: ReleaseStatus
  startDate: string | null
  releaseDate: string | null
  targetDate: string | null
  plannedVelocity: number | null
  planEstimate: number | null
  /** Read-only roll-up: summed estimate hours of assigned work items (SRS FR-004). */
  taskEstimate: number
  version: string | null
  releasedAt: string | null
  createdAt: string
  updatedAt: string
  taskRollup?: TaskRollup
}

export interface BurndownPoint {
  date: string
  totalPoints: number
  completedPoints: number
  remainingPoints: number
  totalItems: number
  completedItems: number
}

// ── Keys ─────────────────────────────────────────────────────────────────────

export const releaseKeys = {
  all: ['releases'] as const,
  list: (projectId: string) => [...releaseKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...releaseKeys.all, 'detail', id] as const,
  burndown: (id: string) => [...releaseKeys.all, 'burndown', id] as const,
} as const

// ── Queries ──────────────────────────────────────────────────────────────────

/** Shared fetcher so single- and multi-project hooks stay in lockstep. */
async function fetchReleases(projectId: string): Promise<Release[]> {
  const { data, error, response } = await apiClient.GET('/v1/releases', {
    params: { query: { projectId } },
  })
  if (error) throw new Error(apiErrorMessage(error, response.status))
  return ((data as { data?: Release[] } | undefined)?.data ?? []) as Release[]
}

export function useReleases(projectId: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.list(projectId ?? ''),
    queryFn: () => fetchReleases(projectId as string),
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

/**
 * Union of releases across several projects (deduped by id). Used where an
 * entity spans multiple projects — e.g. a milestone linked to more than one
 * project needs every linked project's releases as selectable options.
 * Reuses `releaseKeys.list` so results share cache with `useReleases`.
 */
export function useReleasesForProjects(projectIds: readonly string[]) {
  const ids = useMemo(
    () => [...new Set(projectIds.filter(Boolean))],
    [projectIds],
  )
  const results = useQueries({
    queries: ids.map((projectId) => ({
      queryKey: releaseKeys.list(projectId),
      queryFn: () => fetchReleases(projectId),
      staleTime: 60_000,
    })),
  })
  const isLoading = results.some((r) => r.isLoading)
  // Stable signature of the fetched pages so the memo only recomputes when the
  // underlying release data actually changes, not on every render.
  const signature = results.map((r) => r.dataUpdatedAt).join(',')
  const data = useMemo(() => {
    const byId = new Map<string, Release>()
    for (const r of results) for (const rel of r.data ?? []) byId.set(rel.id, rel)
    return [...byId.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
  return { data, isLoading }
}

export function useRelease(id: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.detail(id ?? ''),
    queryFn: async () => {
      if (!id) return null
      const { data, error, response } = await apiClient.GET('/v1/releases/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Release
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useReleaseBurndown(releaseId: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.burndown(releaseId ?? ''),
    queryFn: async () => {
      if (!releaseId) return []
      const res = await fetch(`/api/v1/releases/${releaseId}/burndown`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? `Burndown fetch failed (${res.status})`)
      }
      const json = await res.json() as BurndownPoint[]
      return json
    },
    enabled: !!releaseId,
    staleTime: 5 * 60_000,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export interface CreateReleaseInput {
  projectId: string
  name: string
  description?: string
  theme?: string
  startDate?: string
  releaseDate?: string
  state?: ReleaseStatus
}

export function useCreateRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateReleaseInput) => {
      const { data, error, response } = await apiClient.POST('/v1/releases', {
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Release
    },
    onSuccess: (release) => {
      void qc.invalidateQueries({ queryKey: releaseKeys.list(release.projectId) })
    },
  })
}

export interface UpdateReleaseInput {
  name?: string
  description?: string | null
  theme?: string | null
  notes?: string | null
  startDate?: string | null
  releaseDate?: string | null
  plannedVelocity?: number | null
  planEstimate?: number | null
  version?: string | null
  state?: ReleaseStatus
}

export function useUpdateRelease(id: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateReleaseInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/releases/{id}', {
        params: { path: { id } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Release
    },
    onSuccess: () => {
      qc.setQueryData(releaseKeys.detail(id), undefined)
      void qc.invalidateQueries({ queryKey: releaseKeys.detail(id) })
      void qc.invalidateQueries({ queryKey: releaseKeys.list(projectId) })
    },
  })
}

export function useDeleteRelease(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await apiClient.DELETE('/v1/releases/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: releaseKeys.list(projectId) })
    },
  })
}

// Inline edit helper — optimistic update for a single field.
export function useInlineReleaseField(id: string, projectId: string, field: keyof UpdateReleaseInput) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (value: unknown) => {
      const patch: UpdateReleaseInput = { [field]: value }
      const { data, error, response } = await apiClient.PATCH('/v1/releases/{id}', {
        params: { path: { id } },
        body: patch as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Release
    },
    onSuccess: () => {
      qc.setQueryData(releaseKeys.detail(id), undefined)
      void qc.invalidateQueries({ queryKey: releaseKeys.detail(id) })
      void qc.invalidateQueries({ queryKey: releaseKeys.list(projectId) })
    },
  })
}

// ── Release Artifacts (linked work items) ───────────────────────────────────────

export interface ReleaseArtifactItem {
  id: string
  itemKey: string
  type: string
  title: string
  scheduleState: string
  priority: string
  assigneeId: string | null
  assigneeName?: string | null
  storyPoints: number | null
  rank?: number
}

export interface ReleaseArtifactPageResponse {
  data: ReleaseArtifactItem[]
  pageInfo: { hasNextPage: boolean; nextCursor: string | null; limit: number; total?: number }
}

export function useReleaseArtifacts(
  releaseId: string | undefined,
  params?: { page?: number; pageSize?: number; search?: string },
) {
  return useQuery({
    queryKey: ['release', releaseId, 'artifacts', params],
    queryFn: async () => {
      if (!releaseId) return { data: [], pageInfo: { hasNextPage: false, nextCursor: null, limit: 50, total: 0 } }
      const customClient = apiClient as unknown as {
        GET: (
          url: string,
          options: {
            params: {
              path: { id: string }
              query: { limit: number; q: string | undefined }
            }
          }
        ) => Promise<{ data?: ReleaseArtifactPageResponse; error?: unknown; response: { status: number } }>
      }
      const { data, error, response } = await customClient.GET('/v1/releases/{id}/artifacts', {
        params: {
          path: { id: releaseId },
          query: {
            limit: params?.pageSize ?? 50,
            q: params?.search || undefined,
          },
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      const res = data
      return {
        data: res?.data ?? [],
        pageInfo: res?.pageInfo ?? { hasNextPage: false, nextCursor: null, limit: 50, total: 0 },
      }
    },
    enabled: !!releaseId,
    staleTime: 15_000,
  })
}