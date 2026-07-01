/**
 * Releases API hooks — TanStack Query wrappers.
 */
import { useQuery } from '@tanstack/react-query'
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
