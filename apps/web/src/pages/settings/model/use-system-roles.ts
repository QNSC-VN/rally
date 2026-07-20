import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/http-client'

/** A workspace or system role with its granted permission codes. */
export type Role = {
  id: string
  workspaceId: string | null
  name: string
  slug: string
  description: string | null
  isSystem: boolean
  permissions: string[]
}

/**
 * useSystemRoles — the single source of truth for the `['system-roles']` query.
 *
 * Previously defined inline three times (User Management, Teams/Audit, Roles
 * tabs) with the same key + fetch; sharing the definition keeps the cache key,
 * fetch, and return type in one place so all three consumers stay in sync.
 */
export function useSystemRoles() {
  return useQuery({
    queryKey: ['system-roles'],
    queryFn: async () => {
      const res = await apiClient.GET('/v1/roles')
      return (res.data ?? []) as Role[]
    },
  })
}
