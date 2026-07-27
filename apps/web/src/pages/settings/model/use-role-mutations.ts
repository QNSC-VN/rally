import { useMutation } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { EntityTag } from '@/shared/api/invalidation'
import type { Permission } from '@/shared/config/permissions'

/**
 * Create / edit / delete workspace CUSTOM roles. Built-ins are immutable on the
 * server (ROLE_IMMUTABLE); these hooks only ever touch workspace-owned roles.
 * Each invalidates `['system-roles']` (the grid) plus `access` so any cached
 * effective-permission views refresh. CSRF + credentials ride the shared
 * `apiClient`; the MutationCache reads `meta.invalidates`.
 */

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p
  if (error || !response.ok) throw new Error(apiErrorMessage(error, response.status))
  return data as T
}

// `access` covers the ['system-roles'] + effective-permission caches; `workspace`
// refreshes the member roster that shows role names.
const invalidates: EntityTag[] = ['workspace', 'access']

export function useCreateRole() {
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null; permissions: Permission[] }) =>
      unwrap(apiClient.POST('/v1/roles', { body: input })),
    meta: { invalidates },
  })
}

export function useUpdateRolePermissions() {
  return useMutation({
    mutationFn: ({ roleId, permissions }: { roleId: string; permissions: Permission[] }) =>
      unwrap(
        apiClient.PATCH('/v1/roles/{roleId}/permissions', {
          params: { path: { roleId } },
          body: { permissions },
        }),
      ),
    meta: { invalidates },
  })
}

export function useDeleteRole() {
  return useMutation({
    mutationFn: (roleId: string) =>
      unwrap(apiClient.DELETE('/v1/roles/{roleId}', { params: { path: { roleId } } })),
    meta: { invalidates },
  })
}
