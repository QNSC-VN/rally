/**
 * Releases API hooks — TanStack Query wrappers.
 * P3.2: Updated for Planning/Active/Accepted states and new fields.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

// ── Types ────────────────────────────────────────────────────────────────────

export type ReleaseStatus = 'planning' | 'active' | 'accepted'

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
  version: string | null
  releasedAt: string | null
  createdAt: string
  updatedAt: string
}

// ── Keys ─────────────────────────────────────────────────────────────────────

export const releaseKeys = {
  all: ['releases'] as const,
  list: (projectId: string) => [...releaseKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...releaseKeys.all, 'detail', id] as const,
} as const

// ── Queries ──────────────────────────────────────────────────────────────────

export function useReleases(projectId: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.list(projectId ?? ''),
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/releases', {
        params: { query: { projectId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return ((data as { data?: Release[] } | undefined)?.data ?? []) as Release[]
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
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