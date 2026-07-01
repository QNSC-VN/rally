/**
 * Teams & project members API hooks — TanStack Query wrappers.
 * Used by Work Item Detail sidebar dropdowns.
 */
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

// ── Local interface (generated schema is Record<string, never>) ───────────────

export interface Team {
  id: string
  tenantId: string
  workspaceId: string
  name: string
  description: string | null
  memberCount?: number
  createdAt: string
  updatedAt: string
}

export interface ProjectMember {
  id: string
  userId: string
  workspaceId: string
  roleId: string | null
  status: string
  /** Joined from users table when populated by backend */
  displayName?: string
  email?: string
  avatarUrl?: string | null
  joinedAt: string
  createdAt: string
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const teamKeys = {
  all: ['teams'] as const,
  projectTeams: (projectId: string) => [...teamKeys.all, 'project', projectId] as const,
  projectMembers: (projectId: string) => [...teamKeys.all, 'members', projectId] as const,
  workspaceTeams: (workspaceId: string) => [...teamKeys.all, 'workspace', workspaceId] as const,
} as const

// ── Project teams ─────────────────────────────────────────────────────────────

export function useProjectTeams(projectId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.projectTeams(projectId ?? ''),
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/projects/{id}/teams', {
        params: { path: { id: projectId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as Team[]) ?? []
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

// ── Project members ───────────────────────────────────────────────────────────

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.projectMembers(projectId ?? ''),
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/projects/{id}/members', {
        params: { path: { id: projectId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data: ProjectMember[] } | undefined)?.data ?? []
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

// ── Workspace teams ───────────────────────────────────────────────────────────

export function useWorkspaceTeams(workspaceId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.workspaceTeams(workspaceId ?? ''),
    queryFn: async () => {
      if (!workspaceId) return []
      const { data, error, response } = await apiClient.GET('/v1/workspaces/{workspaceId}/teams', {
        params: { path: { workspaceId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as Team[]) ?? []
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  })
}
