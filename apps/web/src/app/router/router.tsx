import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import type { QueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { bootstrapAuth } from '@/shared/api/auth-bootstrap'

// ── Extend staticData for breadcrumb support (SHELL-FR-007) ──────────────────
declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    breadcrumb?: string
  }
}

// ── Router context type ───────────────────────────────────────────────────────
export interface RouterContext {
  queryClient: QueryClient
}

// ── Root route ────────────────────────────────────────────────────────────────
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </>
  ),
})

// ── Auth guard helper ─────────────────────────────────────────────────────────
async function requireAuth() {
  await bootstrapAuth()
  const { isAuthenticated } = useAuthStore.getState()
  if (!isAuthenticated) {
    // AUTH-FR-012: preserve requested URL so login can redirect back after session expiry
    const returnTo = window.location.pathname + window.location.search
    const search =
      returnTo && returnTo !== '/' && !returnTo.startsWith('/login') ? { returnTo } : undefined
    throw redirect({ to: '/login', search } as Parameters<typeof redirect>[0])
  }
}

// ── Lazy component helper ─────────────────────────────────────────────────────
// Each page is a separate chunk — only the shell is always loaded.
import { lazy, Suspense } from 'react'

function lazyPage<T extends Record<string, React.ComponentType>>(
  factory: () => Promise<T>,
  key: keyof T,
) {
  const Lazy = lazy(() => factory().then((m) => ({ default: m[key] as React.ComponentType })))
  return () => (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <Lazy />
    </Suspense>
  )
}

// ── Public routes ─────────────────────────────────────────────────────────────
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: lazyPage(() => import('@/pages/login/login-page'), 'LoginPage'),
})

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: lazyPage(
    () => import('@/pages/forgot-password/forgot-password-page'),
    'ForgotPasswordPage',
  ),
})

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: lazyPage(
    () => import('@/pages/reset-password/reset-password-page'),
    'ResetPasswordPage',
  ),
})

// ── Authenticated layout route ────────────────────────────────────────────────
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  beforeLoad: requireAuth,
  component: lazyPage(() => import('@/widgets/app-shell/app-shell'), 'AppShell'),
})

// ── App routes (children of auth layout) ─────────────────────────────────────
const homeRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/',
  staticData: { breadcrumb: 'Home' },
  component: lazyPage(() => import('@/pages/home/home-page'), 'HomePage'),
})

const projectsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/projects',
  staticData: { breadcrumb: 'Projects' },
  component: lazyPage(() => import('@/pages/projects/projects-page'), 'ProjectsPage'),
})

const settingsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/settings',
  staticData: { breadcrumb: 'Settings' },
  component: lazyPage(() => import('@/pages/settings/settings-page'), 'SettingsPage'),
})

const notificationsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/notifications',
  staticData: { breadcrumb: 'Notifications' },
  component: lazyPage(
    () => import('@/pages/notifications/notifications-page'),
    'NotificationsPage',
  ),
})

const forbiddenRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/403',
  staticData: { breadcrumb: 'Access Denied' },
  component: lazyPage(() => import('@/pages/forbidden/forbidden-page'), 'ForbiddenPage'),
})

// ── Phase 1: Plan ─────────────────────────────────────────────────────────────

const backlogRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/backlog',
  staticData: { breadcrumb: 'Backlog' },
  component: lazyPage(() => import('@/pages/backlog/backlog-page'), 'BacklogPage'),
})

const workItemDetailRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/item/$itemKey',
  staticData: { breadcrumb: 'Work Item' },
  component: lazyPage(
    () => import('@/pages/work-item/work-item-detail-page'),
    'WorkItemDetailPage',
  ),
})

const timeboxesRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/timeboxes',
  staticData: { breadcrumb: 'Timeboxes' },
  component: lazyPage(() => import('@/pages/iterations/iterations-page'), 'IterationsPage'),
})

const iterationStatusRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/iteration-status',
  staticData: { breadcrumb: 'Iteration' },
  component: lazyPage(
    () => import('@/pages/iteration-status/iteration-status-page'),
    'IterationStatusPage',
  ),
})

// ── Not found ─────────────────────────────────────────────────────────────────

const notFoundRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '$',
  staticData: { breadcrumb: 'Not Found' },
  component: lazyPage(() => import('@/pages/not-found/not-found-page'), 'NotFoundPage'),
})

// ── Route tree ────────────────────────────────────────────────────────────────
const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  authRoute.addChildren([
    homeRoute,
    projectsRoute,
    settingsRoute,
    notificationsRoute,
    forbiddenRoute,
    backlogRoute,
    timeboxesRoute,
    iterationStatusRoute,
    workItemDetailRoute,
    notFoundRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  context: { queryClient: undefined! }, // injected in App.tsx
})

// Type-safe router registration
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
