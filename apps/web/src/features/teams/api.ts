/**
 * Teams & project members API hooks — TanStack Query wrappers.
 * Used by Work Item Detail sidebar dropdowns.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

// ── Local interface (generated schema is Record<string, never>) ───────────────

export interface Team {
  id: string
  tenantId: string
  workspaceId: string
  key?: string | null
  name: string
  description: string | null
  leadId?: string | null
  status?: string
  memberCount?: number
  createdAt: string
  updatedAt: string
}

export interface TeamMember {
  id?: string
  userId: string
  teamId?: string
  displayName?: string
  email?: string
  avatarUrl?: string | null
  joinedAt?: string
  createdAt?: string
}

export interface CreateTeamInput {
  workspaceId: string
  name: string
  key: string
  description?: string
  leadId?: string | null
}

export interface UpdateTeamInput {
  name?: string
  key?: string
  description?: string | null
  leadId?: string | null
  status?: 'active' | 'archived'
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
  teamMembers: (teamId: string) => [...teamKeys.all, 'team-members', teamId] as const,
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
      return (data as ProjectMember[] | undefined) ?? []
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

export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.teamMembers(teamId ?? ''),
    queryFn: async () => {
      if (!teamId) return []
      const { data, error, response } = await apiClient.GET('/v1/teams/{id}/members', {
        params: { path: { id: teamId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as TeamMember[] | undefined) ?? []
    },
    enabled: !!teamId,
    staleTime: 60_000,
  })
}

export function useCreateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateTeamInput) => {
      const { data, error, response } = await apiClient.POST('/v1/workspaces/{workspaceId}/teams', {
        params: { path: { workspaceId: input.workspaceId } },
        body: {
          name: input.name,
          key: input.key,
          description: input.description,
          leadId: input.leadId ?? undefined,
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Team
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: teamKeys.workspaceTeams(vars.workspaceId) })
    },
  })
}

export function useUpdateTeam(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateTeamInput }) => {
      const { data, error, response } = await apiClient.PATCH('/v1/teams/{id}', {
        params: { path: { id } },
        body: {
          name: input.name,
          description: input.description,
          leadId: input.leadId,
          status: input.status,
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Team
    },
    onSuccess: () => {
      if (workspaceId) void qc.invalidateQueries({ queryKey: teamKeys.workspaceTeams(workspaceId) })
    },
  })
}

export function useLinkProjectTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, teamId }: { projectId: string; teamId: string }) => {
      const { data, error, response } = await apiClient.POST('/v1/projects/{id}/teams', {
        params: { path: { id: projectId } },
        body: { teamId } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: teamKeys.projectTeams(vars.projectId) })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useAddTeamMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: string; userId: string }) => {
      const { data, error, response } = await apiClient.POST('/v1/teams/{id}/members', {
        params: { path: { id: teamId } },
        body: { userId },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: teamKeys.teamMembers(vars.teamId) })
    },
  })
}

export function useRemoveTeamMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: string; userId: string }) => {
      const { error, response } = await apiClient.DELETE('/v1/teams/{id}/members/{userId}', {
        params: { path: { id: teamId, userId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: teamKeys.teamMembers(vars.teamId) })
    },
  })
}
