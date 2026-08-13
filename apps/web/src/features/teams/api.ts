/**
 * Teams API hooks — TanStack Query wrappers.
 * Used by Work Item Detail sidebar dropdowns and Settings > Teams management.
 */
import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
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
  projectId: string
  accessLevel: 'admin' | 'editor' | null
  status: string
  displayName?: string
  email?: string
  avatarUrl?: string | null
  joinedAt: string
  updatedAt: string
  /** Active team_members rows for Teams linked to this project — 0 means an Editor has no scope to act in. */
  teamCount: number
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

async function fetchTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data, error, response } = await apiClient.GET('/v1/teams/{id}/members', {
    params: { path: { id: teamId } },
  })
  if (error) throw new Error(apiErrorMessage(error, response.status))
  return (data as TeamMember[]) ?? []
}

/** One team's full member roster — the team DETAIL view on the project Teams tab
 *  (mockup parity: clicking a team row shows its members). Shares cache with the
 *  memberships fan-out via `teamKeys.members`. */
export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.members(teamId ?? ''),
    queryFn: () => fetchTeamMembers(teamId as string),
    enabled: !!teamId,
    staleTime: 30_000,
  })
}

/**
 * Membership across SEVERAL teams for one user. The per-project Teams picker in
 * UserAccessModal needs "is this user in team X" for every team on a project
 * row, and there is no single endpoint for that, so this fans out one request
 * per team via `useQueries`. Uses `teamKeys.members` / `fetchTeamMembers` so
 * results share cache with `useTeamMembers` (e.g. the Teams tab's member cell),
 * and stay live after `useAddTeamMember` / `useRemoveTeamMember` — both
 * invalidate the `team` tag, whose `['teams']` root covers `teamKeys.members`
 * by prefix.
 */
export function useUserTeamMemberships(teamIds: readonly string[], userId: string | undefined) {
  const ids = useMemo(() => [...new Set(teamIds.filter(Boolean))], [teamIds])
  const results = useQueries({
    queries: ids.map((teamId) => ({
      queryKey: teamKeys.members(teamId),
      queryFn: () => fetchTeamMembers(teamId),
      enabled: !!userId,
      staleTime: 30_000,
    })),
  })
  const isLoading = results.some((r) => r.isLoading)
  // Stable signatures so the memo only recomputes when the underlying data
  // (or the team-id set itself) actually changes, not on every render.
  const signature = results.map((r) => r.dataUpdatedAt).join(',')
  const idsSignature = ids.join(',')
  const memberTeamIds = useMemo(
    () => (userId ? ids.filter((_, i) => results[i]?.data?.some((m) => m.userId === userId)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, userId, idsSignature],
  )
  return { memberTeamIds, isLoading }
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
  return useMutation({
    mutationFn: async ({ workspaceId, ...body }: CreateTeamInput) => {
      const { data, error, response } = await apiClient.POST('/v1/workspaces/{workspaceId}/teams', {
        params: { path: { workspaceId } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Team
    },
    // The `team` tag invalidates the whole teams namespace (workspace lists,
    // project-team links, member lists) plus dependent dashboards.
    meta: { invalidates: ['team'] },
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
    onSuccess: (team) => qc.setQueryData(teamKeys.detail(id), team),
    meta: { invalidates: ['team'] },
  })
}

/**
 * `teamId` is optional at the hook level so ONE instance can serve a picker that
 * varies the TEAM rather than the user (the per-project Teams picker in
 * UserAccessModal: one user, many candidate teams). The Teams tab's own
 * `TeamMembersCell` (one team, many candidate users) still binds `teamId` here
 * and calls `.mutate(userId)` exactly as before — both shapes hit the same
 * `POST /v1/teams/{id}/members`, so there is still exactly one write path.
 */
export function useAddTeamMember(teamId?: string) {
  return useMutation({
    mutationFn: async (arg: string | { userId: string; teamId: string }) => {
      const [id, userId] = typeof arg === 'string' ? [teamId, arg] : [arg.teamId, arg.userId]
      if (!id) throw new Error('useAddTeamMember: no teamId bound or supplied')
      const { data, error, response } = await apiClient.POST('/v1/teams/{id}/members', {
        params: { path: { id } },
        body: { userId } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as TeamMember
    },
    meta: { invalidates: ['team'] },
  })
}

/** See {@link useAddTeamMember} for why `teamId` is optional here too. */
export function useRemoveTeamMember(teamId?: string) {
  return useMutation({
    mutationFn: async (arg: string | { userId: string; teamId: string }) => {
      const [id, userId] = typeof arg === 'string' ? [teamId, arg] : [arg.teamId, arg.userId]
      if (!id) throw new Error('useRemoveTeamMember: no teamId bound or supplied')
      const { error, response } = await apiClient.DELETE('/v1/teams/{id}/members/{userId}', {
        params: { path: { id, userId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    // 'work-item' is invalidated because removal now nulls the member's task
    // assignments in this team — Iteration Status, Work Item detail and Backlog
    // all render task assignees, so they must refetch or they show a stale owner.
    meta: { invalidates: ['team', 'work-item'] },
  })
}

// ── Per-Project access level (RBAC migration Phase 7) ─────────────────────────

export function useUpdateProjectAccess(projectId: string) {
  return useMutation({
    mutationFn: async ({
      memberId,
      accessLevel,
    }: {
      memberId: string
      accessLevel: 'admin' | 'editor'
    }) => {
      const { error, response } = await apiClient.PATCH('/v1/projects/{id}/members/{memberId}', {
        params: { path: { id: projectId, memberId } },
        body: { accessLevel },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['team'] },
  })
}

/**
 * Add an existing workspace user to a Project (creates a project_members row). NOTE:
 * the BE currently ignores `accessLevel` on add (Stage 5 fix) — callers must follow
 * with `useUpdateProjectAccess` to set the level, which is why the Add Existing User
 * flow PATCHes immediately after this resolves.
 */
export function useAddProjectMember(projectId: string) {
  return useMutation({
    mutationFn: async ({
      userId,
      accessLevel,
    }: {
      userId: string
      accessLevel?: 'admin' | 'editor'
    }) => {
      const { data, error, response } = await apiClient.POST('/v1/projects/{id}/members', {
        params: { path: { id: projectId } },
        body: { userId, ...(accessLevel ? { accessLevel } : {}) } as never as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    meta: { invalidates: ['team'] },
  })
}

// ── Project ⇄ Team links ──────────────────────────────────────────────────────

export function useLinkProjectTeam(projectId: string) {
  return useMutation({
    mutationFn: async (teamId: string) => {
      const { error, response } = await apiClient.POST('/v1/projects/{id}/teams', {
        params: { path: { id: projectId } },
        body: { teamId } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    // A project⇄team link shows on both the team's project list and the
    // project's team list, so refresh both namespaces.
    meta: { invalidates: ['team', 'project'] },
  })
}

export function useUnlinkProjectTeam(projectId: string) {
  return useMutation({
    mutationFn: async (teamId: string) => {
      const { error, response } = await apiClient.DELETE('/v1/projects/{id}/teams/{teamId}', {
        params: { path: { id: projectId, teamId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['team', 'project'] },
  })
}
