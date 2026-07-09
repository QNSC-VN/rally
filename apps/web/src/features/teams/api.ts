/**
 * Teams API hooks — TanStack Query wrappers.
 * Used by Work Item Detail sidebar dropdowns and Settings > Teams management.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

// ── Types (generated schema uses Record<string,never> for team types) ─────────

export interface Team {
  id: string
  workspaceId: string
  name: string
  key: string
  description: string | null
  leadId: string | null
  status: 'active' | 'archived'
  memberCount?: number
  createdAt: string
  updatedAt: string
}

export interface TeamMember {
  id: string
  teamId: string
  userId: string
  status: string
  joinedAt: string
  /** Resolved from workspace members at query time */
  displayName?: string
  email?: string
  avatarUrl?: string | null
}

export interface ProjectMember {
  id: string
  userId: string
  workspaceId: string
  roleId: string | null
  status: string
  displayName?: string
  email?: string
  avatarUrl?: string | null
  joinedAt: string
  createdAt: string
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const teamKeys = {
  all: ['teams'] as const,
  workspaceTeams: (workspaceId: string) => [...teamKeys.all, 'workspace', workspaceId] as const,
  detail: (id: string) => [...teamKeys.all, 'detail', id] as const,
  members: (id: string) => [...teamKeys.all, 'members', id] as const,
  projectTeams: (projectId: string) => [...teamKeys.all, 'project', projectId] as const,
  projectMembers: (projectId: string) => [...teamKeys.all, 'projectMembers', projectId] as const,
} as const

// ── Queries ───────────────────────────────────────────────────────────────────

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
    staleTime: 30_000,
  })
}

export function useTeam(id: string | undefined) {
  return useQuery({
    queryKey: teamKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/teams/{id}', {
        params: { path: { id: id! } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Team
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.members(teamId ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/teams/{id}/members', {
        params: { path: { id: teamId! } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as TeamMember[]) ?? []
    },
    enabled: !!teamId,
    staleTime: 30_000,
  })
}

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

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface CreateTeamInput {
  workspaceId: string
  name: string
  key: string
  description?: string
}

export function useCreateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId, ...body }: CreateTeamInput) => {
      const { data, error, response } = await apiClient.POST(
        '/v1/workspaces/{workspaceId}/teams',
        { params: { path: { workspaceId } }, body: body as never },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Team
    },
    onSuccess: (team) => {
      void qc.invalidateQueries({ queryKey: teamKeys.workspaceTeams(team.workspaceId) })
    },
  })
}

export interface UpdateTeamInput {
  name?: string
  description?: string | null
  leadId?: string | null
  status?: 'active' | 'archived'
}

export function useUpdateTeam(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateTeamInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/teams/{id}', {
        params: { path: { id } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Team
    },
    onSuccess: (team) => {
      qc.setQueryData(teamKeys.detail(id), team)
      void qc.invalidateQueries({ queryKey: teamKeys.workspaceTeams(team.workspaceId) })
    },
  })
}

export function useAddTeamMember(teamId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error, response } = await apiClient.POST('/v1/teams/{id}/members', {
        params: { path: { id: teamId } },
        body: { userId } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as TeamMember
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKeys.members(teamId) })
    },
  })
}

export function useRemoveTeamMember(teamId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error, response } = await apiClient.DELETE('/v1/teams/{id}/members/{userId}', {
        params: { path: { id: teamId, userId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKeys.members(teamId) })
    },
  })
}
