/**
 * Workspace API hooks — TanStack Query wrappers around the typed openapi-fetch client.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
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

export interface MemberTeam {
  id: string
  key: string
  name: string
}

/**
 * A workspace member enriched with the user's profile + effective role.
 * Intersected with `teams` so the field is typed ahead of the next OpenAPI regen
 * (the backend already returns it).
 */
export type WorkspaceMember = components['schemas']['MemberWithProfileResponseDto'] & {
  teams?: MemberTeam[]
}

/**
 * The ASSIGNEE / OWNER PICKER feed — `GET /v1/workspaces/{id}/member-options`.
 *
 * The roster is TWO routes by audience (RBE-07). This is the one every delivery participant may
 * read: id, name, email, avatar. `useWorkspaceMembers` below is the User Management roster and
 * carries `phone`, `lastLoginAt` and the role ids, so it is `workspace:view` (Workspace Admin)
 * gated on the backend — reading it from a picker 403s for an Editor, which is the regression this
 * hook exists to prevent.
 *
 * Structurally this is `OwnerSelectMember` (`shared/ui/owner-cell`), which is what every owner
 * picker and owner cell already accepts.
 *
 * The type is hand-declared rather than taken from `components['schemas']` because the generated
 * client is regenerated centrally from a running API; it is asserted against
 * `MemberOptionResponseDto` on the next regen and the field names are the contract.
 */
export interface WorkspaceMemberOption {
  userId: string
  displayName: string
  email: string
  avatarUrl: string | null
  /**
   * Whether a picker may OFFER this person as a new owner. It used to be the raw
   * `workspace_members.status`, which put a colleague's account state on the one feed in the product
   * with no permission code — read by everyone, read BY nobody. An inactive member is still returned
   * so an item they already own resolves to a name.
   */
  assignable: boolean
}

/**
 * Untyped view of the client for the ONE route that is newer than the committed
 * `shared/api/generated/api.ts`. Same escape hatch `features/milestones`, `features/quality` and
 * `features/team-status` already use; it disappears on the next central `codegen` run.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = apiClient as any

export function useWorkspaceMemberOptions(workspaceId: string | undefined) {
  return useQuery({
    // Nested UNDER `['workspaces']` on purpose: `invalidateQueries` matches by key PREFIX, so the
    // existing `workspace` tag in `shared/api/invalidation.ts` already fans out to this feed and no
    // new root has to be registered for a member add/remove to refresh every picker.
    queryKey: ['workspaces', 'member-options', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return []
      const { data, error, response } = await client.GET('/v1/workspaces/{id}/member-options', {
        params: { path: { id: workspaceId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as WorkspaceMemberOption[]) ?? []
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })
}

/**
 * The USER MANAGEMENT roster (profile + contact details + role) — Workspace Admin only.
 *
 * Keyed by `workspace-members-profile` so all consumers share one cache entry. For an owner or
 * assignee picker use {@link useWorkspaceMemberOptions} instead: this route is gated
 * `workspace:view` and an Editor reading it gets a 403.
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

export interface UpdateMemberInput {
  memberId: string
  status?: 'active' | 'suspended' | 'removed'
  /** When supplied, replaces the user's full set of team memberships. */
  teamIds?: string[]
}

/** Update a workspace member's status and/or team memberships (soft deactivate via status). */
export function useUpdateMember(_workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async ({ memberId, ...body }: UpdateMemberInput) => {
      const { error, response } = await apiClient.PATCH('/v1/workspaces/{id}/members/{memberId}', {
        params: { path: { id: _workspaceId!, memberId } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['workspace'] },
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
  return useMutation({
    mutationFn: async (body: UpdateWorkspaceInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/workspaces/{id}', {
        params: { path: { id: id! } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Workspace
    },
    meta: { invalidates: ['workspace'] },
  })
}

// ── Workspace formatting settings (timezone / locale / date format) ──────────

/**
 * DERIVED from the generated schema, not hand-written.
 *
 * The map is a zod record, so OpenAPI describes it as an object with an index signature rather
 * than six named keys — a hand-written `Record<PreliminaryEstimateSize, …>` looks tighter but
 * does not OVERLAP with what the client actually returns, which is a compile error at the cast
 * rather than a safety win.
 */
export type WorkspaceSettings = components['schemas']['WorkspaceSettingsResponseDto']

export function useWorkspaceSettings(id: string | undefined) {
  return useQuery({
    queryKey: ['workspace-settings', id ?? ''],
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/workspaces/{id}/settings', {
        params: { path: { id: id! } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useUpdateWorkspaceSettings(id: string | undefined) {
  return useMutation({
    mutationFn: async (body: Partial<WorkspaceSettings>) => {
      const { data, error, response } = await apiClient.PATCH('/v1/workspaces/{id}/settings', {
        params: { path: { id: id! } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    meta: { invalidates: ['workspace'] },
  })
}
