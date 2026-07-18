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
import { PageSpinner } from '@/shared/ui/spinner'

function lazyPage<T extends Record<string, React.ComponentType>>(
  factory: () => Promise<T>,
  key: keyof T,
) {
  const Lazy = lazy(() => factory().then((m) => ({ default: m[key] as React.ComponentType })))
  return () => (
    <Suspense fallback={<PageSpinner />}>
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
  staticData: { breadcrumb: 'Iteration Status' },
  component: lazyPage(
    () => import('@/pages/iteration-status/iteration-status-page'),
    'IterationStatusPage',
  ),
})

const releasesRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/releases',
  staticData: { breadcrumb: 'Releases' },
  component: lazyPage(() => import('@/pages/releases/releases-page'), 'ReleasesPage'),
})

const releaseDetailRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/releases/$releaseId',
  staticData: { breadcrumb: 'Release Detail' },
  component: lazyPage(() => import('@/pages/releases/releases-detail-page'), 'ReleaseDetailPage'),
})

const milestonesRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/milestones',
  staticData: { breadcrumb: 'Milestones' },
  component: lazyPage(() => import('@/pages/milestones/milestones-page'), 'MilestonesPage'),
})

const milestoneDetailRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/milestones/$milestoneId',
  staticData: { breadcrumb: 'Milestone Detail' },
  component: lazyPage(
    () => import('@/pages/milestones/milestones-detail-page'),
    'MilestoneDetailPage',
  ),
})

const qualityRedirectRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/quality',
  beforeLoad: () => {
    throw redirect({ to: '/quality/defects' })
  },
})

const qualityDefectsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/quality/defects',
  staticData: { breadcrumb: 'Quality' },
  component: lazyPage(() => import('@/pages/quality/quality-page'), 'QualityPage'),
})

const teamStatusRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/team-status',
  staticData: { breadcrumb: 'Team Status' },
  component: lazyPage(() => import('@/pages/team-status/team-status-page'), 'TeamStatusPage'),
})

const teamBoardRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/team-board',
  staticData: { breadcrumb: 'Team Board' },
  component: lazyPage(() => import('@/pages/team-board/team-board-page'), 'TeamBoardPage'),
})

const portfolioRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/portfolio',
  staticData: { breadcrumb: 'Portfolio' },
  component: lazyPage(() => import('@/pages/portfolio/portfolio-page'), 'PortfolioPage'),
})

const reportsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/reports',
  staticData: { breadcrumb: 'Reports' },
  component: lazyPage(() => import('@/pages/reports/reports-page'), 'ReportsPage'),
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
  authRoute.addChildren([
    homeRoute,
    projectsRoute,
    settingsRoute,
    notificationsRoute,
    forbiddenRoute,
    backlogRoute,
    timeboxesRoute,
    iterationStatusRoute,
    releasesRoute,
    releaseDetailRoute,
    milestonesRoute,
    milestoneDetailRoute,
    qualityRedirectRoute,
    qualityDefectsRoute,
    teamStatusRoute,
    teamBoardRoute,
    reportsRoute,
    portfolioRoute,
    workItemDetailRoute,
    notFoundRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  context: { queryClient: undefined! }, // injected in App.tsx
  defaultPreload: 'intent', // prefetch route chunks + loaders on link hover
})

// Type-safe router registration
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
