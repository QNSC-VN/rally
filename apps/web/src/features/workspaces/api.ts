/**
 * Workspace API hooks — TanStack Query wrappers around the typed openapi-fetch client.
 */
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

export interface Workspace {
  id: string
  tenantId: string
  slug: string
  name: string
  description: string | null
  avatarUrl: string | null
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export function useWorkspaces() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/workspaces')
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data: Workspace[] }).data
    },
    staleTime: 5 * 60_000,
  })
}
