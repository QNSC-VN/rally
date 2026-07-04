import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { setAccessToken } from '@/shared/api/http-client'
import { queryClient } from '@/shared/api/query-client'
import { ENV } from '@/shared/config/env'

export interface TenantMembership {
  tenantId: string
  tenantName: string
  tenantSlug: string
  lastActiveAt: string | null
  /** User's primary role slug in this tenant, e.g. 'workspace_admin'. Null when no assignment exists. */
  roleSlug: string | null
  /** Human-readable role name, e.g. 'Workspace Admin'. */
  roleName: string | null
}

export interface AuthUser {
  id: string
  email: string
  displayName: string
  avatarUrl?: string | null
  locale: string
  timezone: string
  role: string
  permissions: string[]
  emailVerified: boolean
  createdAt: string
  updatedAt: string
}

interface AuthState {
  user: AuthUser | null
  memberships: TenantMembership[]
  activeTenantId: string | null
  isAuthenticated: boolean
  isLoading: boolean
  isSwitchingTenant: boolean

  setUser: (user: AuthUser, accessToken: string, memberships?: TenantMembership[]) => void
  clearAuth: () => void
  setLoading: (loading: boolean) => void
  switchTenant: (tenantId: string) => Promise<void>

  /** True if the user has the given permission code in their current role. */
  hasPermission: (code: string) => boolean
}

const API = ENV.API_BASE_URL

export const useAuthStore = create<AuthState>()(devtools((set, get) => ({
  user: null,
  memberships: [],
  activeTenantId: null,
  isAuthenticated: false,
  isLoading: true,
  isSwitchingTenant: false,

  setUser: (user, accessToken, memberships = []) => {
    setAccessToken(accessToken)
    const activeTenantId = memberships[0]?.tenantId ?? null
    set({ user, memberships, activeTenantId, isAuthenticated: true, isLoading: false })
  },

  clearAuth: () => {
    setAccessToken(null)
    set({
      user: null,
      memberships: [],
      activeTenantId: null,
      isAuthenticated: false,
      isLoading: false,
    })
  },

  setLoading: (isLoading) => set({ isLoading }),

  switchTenant: async (tenantId: string) => {
    const { activeTenantId } = get()
    if (tenantId === activeTenantId) return

    set({ isSwitchingTenant: true })
    try {
      const { getAccessToken, scheduleProactiveRefresh } = await import('@/shared/api/http-client')
      const res = await fetch(`${API}/v1/auth/switch-tenant`, {
        method: 'POST',
        credentials: 'include',
        referrerPolicy: 'no-referrer',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAccessToken()}`,
        },
        body: JSON.stringify({ tenantId }),
      })

      if (!res.ok) throw new Error('Switch failed')

      const { accessToken, expiresIn } = (await res.json()) as {
        accessToken: string
        expiresIn: number
      }

      setAccessToken(accessToken)
      if (expiresIn) scheduleProactiveRefresh(expiresIn)
      queryClient.clear()

      // Re-order memberships so switched tenant is first
      const { memberships } = get()
      const reordered = [
        ...memberships.filter((m) => m.tenantId === tenantId),
        ...memberships.filter((m) => m.tenantId !== tenantId),
      ]
      set({ activeTenantId: tenantId, memberships: reordered })
    } finally {
      set({ isSwitchingTenant: false })
    }
  },

  hasPermission: (code) => {
    const { user } = get()
    if (!user) return false
    if (user.permissions.includes('workspace:*')) return true
    if (user.permissions.includes(code)) return true
    const [ns, action] = code.split(':')
    if (action && user.permissions.includes(`${ns}:*`)) return true
    return false
  },
}), { name: 'auth-store' }))
