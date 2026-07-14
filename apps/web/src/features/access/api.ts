/**
 * Access / permission hooks.
 *
 * Rally authorization is two-tier and purely additive:
 *  - BASELINE  = the union of the user's global + workspace role assignments.
 *    It's baked into the JWT and exposed via the auth store's `hasPermission`.
 *  - PER-PROJECT = baseline ∪ any role scoped to a specific project, resolved
 *    server-side and returned by `GET /v1/projects/:projectId/my-permissions`.
 *
 * Workspace-tier UI (navigation, settings) should keep using the auth store's
 * `hasPermission`. Project-scoped UI must use {@link useProjectPermissions} so a
 * user who is, say, admin of one project but only a viewer workspace-wide sees
 * the correct actions on that project.
 */
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { grants } from '@/shared/config/permission-check'

export const accessKeys = {
  myProjectPermissions: (projectId: string) => ['my-project-permissions', projectId] as const,
}

export interface ProjectPermissions {
  /** The effective permission codes for the current user on this project. */
  permissions: string[]
  /** Wildcard-aware check against the effective permission set. */
  can: (code: string) => boolean
  isLoading: boolean
  isError: boolean
}

/**
 * The current user's effective permissions for a project. While the per-project
 * set loads (or when no project is selected) it falls back to the workspace
 * baseline from the JWT — safe because the model is additive, so the effective
 * set only ever grows once the project grants resolve (no action a baseline
 * grant allows is ever hidden).
 */
export function useProjectPermissions(projectId: string | undefined): ProjectPermissions {
  const baseline = useAuthStore((s) => s.user?.permissions ?? [])

  const query = useQuery({
    queryKey: accessKeys.myProjectPermissions(projectId ?? ''),
    queryFn: async () => {
      if (!projectId) return [] as string[]
      const { data, error, response } = await apiClient.GET(
        '/v1/projects/{projectId}/my-permissions',
        { params: { path: { projectId } } },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data?.permissions ?? []
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })

  const permissions = query.data ?? baseline

  return {
    permissions,
    can: (code: string) => grants(permissions, code),
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
