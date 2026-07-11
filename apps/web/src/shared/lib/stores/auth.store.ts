import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { setAccessToken } from '@/shared/api/http-client'
import { queryClient } from '@/shared/api/query-client'
import { ENV, isBffAuth } from '@/shared/config/env'

export interface WorkspaceMembership {
  workspaceId: string
  name: string
  slug: string
  lastActiveAt: string | null
  /** User's primary role slug in this workspace, e.g. 'workspace_admin'. Null when no assignment exists. */
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
  memberships: WorkspaceMembership[]
  activeWorkspaceId: string | null
  isAuthenticated: boolean
  isLoading: boolean
  isSwitchingWorkspace: boolean

  setUser: (user: AuthUser, accessToken: string, memberships?: WorkspaceMembership[]) => void
  clearAuth: () => void
  setLoading: (loading: boolean) => void
  switchWorkspace: (workspaceId: string) => Promise<void>

  /** True if the user has the given permission code in their current role. */
  hasPermission: (code: string) => boolean
}

const API = ENV.API_BASE_URL

export const useAuthStore = create<AuthState>()(
  devtools(
    (set, get) => ({
      user: null,
      memberships: [],
      activeWorkspaceId: null,
      isAuthenticated: false,
      isLoading: true,
      isSwitchingWorkspace: false,

      setUser: (user, accessToken, memberships = []) => {
        setAccessToken(accessToken)
        const activeWorkspaceId = memberships[0]?.workspaceId ?? null
        set({ user, memberships, activeWorkspaceId, isAuthenticated: true, isLoading: false })
      },

      clearAuth: () => {
        setAccessToken(null)
        set({
          user: null,
          memberships: [],
          activeWorkspaceId: null,
          isAuthenticated: false,
          isLoading: false,
        })
      },

      setLoading: (isLoading) => set({ isLoading }),

      switchWorkspace: async (workspaceId: string) => {
        const { activeWorkspaceId } = get()
        if (workspaceId === activeWorkspaceId) return

        set({ isSwitchingWorkspace: true })
        try {
          if (isBffAuth) {
            // BFF: the server re-issues tokens onto the SAME session; the browser
            // keeps its session cookie and holds no tokens, so there is nothing to
            // store client-side. A 204 means the session now resolves to the new ws.
            const res = await fetch(`${API}/bff/switch-workspace`, {
              method: 'POST',
              credentials: 'include',
              referrerPolicy: 'no-referrer',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workspaceId }),
            })
            if (!res.ok) throw new Error('Switch failed')
          } else {
            const { getAccessToken, scheduleProactiveRefresh } =
              await import('@/shared/api/http-client')
            const res = await fetch(`${API}/v1/auth/switch-workspace`, {
              method: 'POST',
              credentials: 'include',
              referrerPolicy: 'no-referrer',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getAccessToken()}`,
              },
              body: JSON.stringify({ workspaceId }),
            })

            if (!res.ok) throw new Error('Switch failed')

            const { accessToken, expiresIn } = (await res.json()) as {
              accessToken: string
              expiresIn: number
            }

            setAccessToken(accessToken)
            if (expiresIn) scheduleProactiveRefresh(expiresIn)
          }

          queryClient.clear()

          // Re-order memberships so switched workspace is first
          const { memberships } = get()
          const reordered = [
            ...memberships.filter((m) => m.workspaceId === workspaceId),
            ...memberships.filter((m) => m.workspaceId !== workspaceId),
          ]
          set({ activeWorkspaceId: workspaceId, memberships: reordered })
        } finally {
          set({ isSwitchingWorkspace: false })
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
    }),
    { name: 'auth-store' },
  ),
)
