import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store calls setAccessToken (http-client) on setUser/clearAuth — stub it so
// the test doesn't pull in the real client/network layer.
vi.mock('@/shared/api/http-client', () => ({
  setAccessToken: vi.fn(),
  scheduleProactiveRefresh: vi.fn(),
  getAccessToken: vi.fn(() => null),
}))
vi.mock('@/shared/api/query-client', () => ({ queryClient: { clear: vi.fn() } }))

import { useAuthStore } from './auth.store'

const makeUser = (permissions: string[]) =>
  ({
    id: 'u1',
    email: 'u1@acme.dev',
    displayName: 'User One',
    locale: 'en',
    timezone: 'UTC',
    permissions,
    emailVerified: true,
    createdAt: '',
    updatedAt: '',
  }) as never

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.getState().clearAuth()
  })

  describe('setUser / clearAuth', () => {
    it('setUser marks authenticated and picks the first membership tenant', () => {
      useAuthStore
        .getState()
        .setUser(makeUser([]), 'token-abc', [
          { tenantId: 't1', tenantName: 'Acme', tenantSlug: 'acme', lastActiveAt: null, roleSlug: null, roleName: null },
        ])
      const s = useAuthStore.getState()
      expect(s.isAuthenticated).toBe(true)
      expect(s.isLoading).toBe(false)
      expect(s.activeTenantId).toBe('t1')
    })

    it('clearAuth resets to an unauthenticated state', () => {
      useAuthStore.getState().setUser(makeUser(['work_item:view']), 'token', [])
      useAuthStore.getState().clearAuth()
      const s = useAuthStore.getState()
      expect(s.isAuthenticated).toBe(false)
      expect(s.user).toBeNull()
      expect(s.activeTenantId).toBeNull()
    })
  })

  describe('hasPermission (FE RBAC gate)', () => {
    it('returns false when no user is set', () => {
      expect(useAuthStore.getState().hasPermission('work_item:view')).toBe(false)
    })

    it('grants everything on the workspace:* wildcard', () => {
      useAuthStore.getState().setUser(makeUser(['workspace:*']), 'token', [])
      const { hasPermission } = useAuthStore.getState()
      expect(hasPermission('work_item:edit')).toBe(true)
      expect(hasPermission('project:delete')).toBe(true)
      expect(hasPermission('workspace:manage_teams')).toBe(true)
    })

    it('matches an exact permission code', () => {
      useAuthStore.getState().setUser(makeUser(['work_item:edit', 'project:view']), 'token', [])
      const { hasPermission } = useAuthStore.getState()
      expect(hasPermission('work_item:edit')).toBe(true)
      expect(hasPermission('project:view')).toBe(true)
      expect(hasPermission('work_item:delete')).toBe(false)
    })

    it('grants a namespace via the ns:* wildcard', () => {
      useAuthStore.getState().setUser(makeUser(['work_item:*']), 'token', [])
      const { hasPermission } = useAuthStore.getState()
      expect(hasPermission('work_item:edit')).toBe(true)
      expect(hasPermission('work_item:delete')).toBe(true)
      // A different namespace is NOT granted.
      expect(hasPermission('project:edit')).toBe(false)
    })

    it('denies when the user holds no matching permission', () => {
      useAuthStore.getState().setUser(makeUser(['work_item:view']), 'token', [])
      expect(useAuthStore.getState().hasPermission('release:manage')).toBe(false)
    })
  })
})
