/**
 * Releases API hooks — TanStack Query wrappers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

export type Release = components['schemas']['ReleaseResponseDto']

export const releaseKeys = {
  all: ['releases'] as const,
  list: (projectId: string) => [...releaseKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...releaseKeys.all, 'detail', id] as const,
} as const

export function useReleases(projectId: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.list(projectId ?? ''),
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/releases', {
        params: { query: { projectId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data: Release[] } | undefined)?.data ?? []
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

export interface CreateReleaseInput {
  projectId: string
  name: string
  description?: string
  targetDate?: string
}

export function useCreateRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateReleaseInput) => {
      const { data, error, response } = await apiClient.POST('/v1/releases', {
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Release
    },
    onSuccess: (release) => {
      void qc.invalidateQueries({ queryKey: releaseKeys.list(release.projectId) })
    },
  })
}

export interface UpdateReleaseInput {
  name?: string
  description?: string | null
  targetDate?: string | null
}

export function useUpdateRelease(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateReleaseInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/releases/{id}', {
        params: { path: { id } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Release
    },
    onSuccess: (release) => {
      qc.setQueryData(releaseKeys.detail(id), release)
      void qc.invalidateQueries({ queryKey: releaseKeys.list(release.projectId) })
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
      void qc.invalidateQueries({ queryKey: releaseKeys.all })
    },
  })
}

export function useShipRelease(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error, response } = await apiClient.POST('/v1/releases/{id}/ship', {
        params: { path: { id } },
        body: {} as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Release
    },
    onSuccess: (release) => {
      void qc.invalidateQueries({ queryKey: releaseKeys.list(release.projectId) })
    },
  })
}
