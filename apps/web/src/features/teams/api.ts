/**
 * Teams API hooks — TanStack Query wrappers.
 * Used by Work Item Detail sidebar dropdowns and Settings > Teams management.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

// ── Types (generated schema uses Record<string,never> for team types) ─────────

/** A project a team is actively linked to (via project_teams). */
export interface TeamProjectLink {
  projectId: string
  key: string
  name: string
}

export interface Team {
  id: string
  workspaceId: string
  name: string
  key: string
  description: string | null
  leadId: string | null
  status: 'active' | 'archived'
  memberCount?: number
  /** Active project links, oldest-first; first is the "primary" for the list column. */
  projects?: TeamProjectLink[]
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
  workspaceTeams: (workspaceId: string, includeInactive = false) =>
    [...teamKeys.all, 'workspace', workspaceId, includeInactive] as const,
  detail: (id: string) => [...teamKeys.all, 'detail', id] as const,
  members: (id: string) => [...teamKeys.all, 'members', id] as const,
  projectTeams: (projectId: string) => [...teamKeys.all, 'project', projectId] as const,
  projectMembers: (projectId: string) => [...teamKeys.all, 'projectMembers', projectId] as const,
} as const

// ── Queries ───────────────────────────────────────────────────────────────────

export function useWorkspaceTeams(workspaceId: string | undefined, includeInactive = false) {
  return useQuery({
    queryKey: teamKeys.workspaceTeams(workspaceId ?? '', includeInactive),
    queryFn: async () => {
      if (!workspaceId) return []
      const { data, error, response } = await apiClient.GET('/v1/workspaces/{workspaceId}/teams', {
        params: {
          path: { workspaceId },
          ...(includeInactive ? { query: { includeInactive: true } } : {}),
        },
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

/**
 * Raw shape returned by `GET /v1/projects/{id}/teams` — a `project_team` LINK
 * row, where `id` is the link id and `teamId` is the actual team id.
 */
interface ProjectTeamLinkRow extends Team {
  teamId: string
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
      // The endpoint returns project_team LINK rows: `.id` is the link id and
      // `.teamId` is the real team id. Normalize so `.id` is the TEAM id — every
      // consumer treats this list as teams keyed by team id (Edit Project
      // checkbox matching, team-name lookups, pickers). The link id is never
      // used on the client (unlink is by teamId).
      const links = (data as ProjectTeamLinkRow[]) ?? []
      return links.map((l): Team => ({ ...l, id: l.teamId }))
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
  leadId?: string | null
  status?: 'active' | 'archived'
  /** Required by the API (≥1); a team must link to at least one project. */
  projectIds: string[]
  memberUserIds?: string[]
}

export function useCreateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId, ...body }: CreateTeamInput) => {
      const { data, error, response } = await apiClient.POST('/v1/workspaces/{workspaceId}/teams', {
        params: { path: { workspaceId } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Team
    },
    // Invalidate the whole teams namespace: workspace lists (both includeInactive
    // variants), project-team link lists, and any member lists are all affected.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKeys.all })
    },
  })
}

export interface UpdateTeamInput {
  name?: string
  description?: string | null
  leadId?: string | null
  status?: 'active' | 'archived'
  /** When supplied, replaces the full set of linked projects (≥1). */
  projectIds?: string[]
  /** When supplied, replaces the full set of members. */
  memberUserIds?: string[]
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
      void qc.invalidateQueries({ queryKey: teamKeys.all })
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

// ── Project ⇄ Team links ──────────────────────────────────────────────────────

export function useLinkProjectTeam(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (teamId: string) => {
      const { error, response } = await apiClient.POST('/v1/projects/{id}/teams', {
        params: { path: { id: projectId } },
        body: { teamId } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKeys.projectTeams(projectId) })
    },
  })
}

export function useUnlinkProjectTeam(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (teamId: string) => {
      const { error, response } = await apiClient.DELETE('/v1/projects/{id}/teams/{teamId}', {
        params: { path: { id: projectId, teamId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKeys.projectTeams(projectId) })
    },
  })
}
