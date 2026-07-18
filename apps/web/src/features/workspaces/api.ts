/**
 * Workspace API hooks — TanStack Query wrappers around the typed openapi-fetch client.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

export interface Workspace {
  id: string
  slug: string
  name: string
  description: string | null
  avatarUrl: string | null
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** A workspace member enriched with the user's profile + effective role. */
export type WorkspaceMember = components['schemas']['MemberWithProfileResponseDto']

/**
 * Single source of truth for the workspace member roster (profile + role).
 * Shared by Settings (members/admins management) and the Projects owner picker.
 * Keyed by `workspace-members-profile` so all consumers share one cache entry.
 */
export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace-members-profile', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return []
      const { data, error, response } = await apiClient.GET(
        '/v1/workspaces/{id}/members-with-profile',
        { params: { path: { id: workspaceId } } },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as WorkspaceMember[]) ?? []
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })
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

export interface UpdateWorkspaceInput {
  name?: string
  description?: string | null
  avatarUrl?: string | null
}

export function useUpdateWorkspace(id: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateWorkspaceInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/workspaces/{id}', {
        params: { path: { id: id! } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Workspace
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}
