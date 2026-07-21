import { BRAND } from '@/shared/config/brand'
import { useEffect, useState } from 'react'
import { Link, Outlet, useMatches, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Check,
  HelpCircle,
  Layers,
  LogOut,
  Search,
  Settings,
  User,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageErrorBoundary } from '@/shared/ui/error-boundary'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { Avatar } from '@/shared/ui/avatar'
import { KeyChip } from '@/shared/ui/key-chip'
import { useWorkspaces } from '@/features/workspaces/api'
import { useProjects } from '@/features/projects/api'
import { useProjectTeams, type Team } from '@/features/teams/api'
import { useNotificationUnreadCount, useNotificationSse } from '@/features/notifications/api'
import { ENV } from '@/shared/config/env'
import { isFeatureEnabled } from '@/shared/config/feature-flags'
import { queryClient } from '@/shared/api/query-client'
import { NotificationPopover } from '@/widgets/notification-popover/notification-popover'

interface SubNavItem {
  path: string
  label: string
  permission?: string
  featureFlag?: string
}

interface NavItem {
  path: string
  label: string
  /** Permission code required to see this nav item. Undefined = any authenticated user. */
  permission?: string
  /** Feature flag key. When false this feature is not yet built; shows as "coming soon". */
  featureFlag?: string
  children?: SubNavItem[]
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Home' },
  {
    path: '/backlog',
    label: 'Plan',
    featureFlag: 'feature.backlog',
    permission: 'work_item:view',
    children: [
      {
        path: '/backlog',
        label: 'Backlog',
        featureFlag: 'feature.backlog',
        permission: 'work_item:view',
      },
      {
        path: '/timeboxes',
        label: 'Timeboxes',
        featureFlag: 'feature.timeboxes',
        permission: 'iteration:view',
      },
      {
        path: '/releases',
        label: 'Releases',
        featureFlag: 'feature.releases',
        permission: 'project:view',
      },
      {
        path: '/milestones',
        label: 'Milestones',
        featureFlag: 'feature.milestones',
        permission: 'milestone:view',
      },
    ],
  },
  {
    path: '/iteration-status',
    label: 'Track',
    featureFlag: 'feature.iteration-status',
    permission: 'work_item:view',
    children: [
      {
        path: '/iteration-status',
        label: 'Iteration',
        featureFlag: 'feature.iteration-status',
        permission: 'work_item:view',
      },
      {
        path: '/team-status',
        label: 'Team Status',
        featureFlag: 'feature.team-status',
        permission: 'work_item:view',
      },
    ],
  },
  {
    path: '/quality/defects',
    label: 'Quality',
    featureFlag: 'feature.quality',
    permission: 'work_item:view',
    children: [
      {
        path: '/quality/defects',
        label: 'Defects',
        featureFlag: 'feature.quality',
        permission: 'work_item:view',
      },
    ],
  },
  {
    path: '/portfolio',
    label: 'Portfolio',
    featureFlag: 'feature.portfolio',
    permission: 'project:view',
  },
  {
    path: '/reports',
    label: 'Reports',
    featureFlag: 'feature.reports',
    permission: 'project:view',
  },
]

/**
 * A single row in the workspace-switcher "Projects & Teams" tree. The row can be
 * expanded to reveal the project's teams, which are fetched lazily (only once the
 * row is opened) so a workspace with hundreds of projects never fans out into
 * hundreds of team requests.
 */
function ProjectTreeItem({
  project,
  selected,
  expanded,
  currentTeamId,
  onToggleExpand,
  onSelectProject,
  onSelectTeam,
}: {
  project: { id: string; key: string; name: string }
  selected: boolean
  expanded: boolean
  currentTeamId: string | null
  onToggleExpand: () => void
  onSelectProject: () => void
  /** Pass a team to scope to it, or `null` for "All Teams". */
  onSelectTeam: (team: Team | null) => void
}) {
  const { data: teams = [], isLoading } = useProjectTeams(expanded ? project.id : undefined)
  const activeTeams = teams.filter((t) => t.status === 'active')

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded hover:bg-surface-subtle"
        style={{ color: selected ? BRAND.primary : BRAND.textPrimary }}
      >
        <button
          type="button"
          aria-label={expanded ? 'Collapse project' : 'Expand project'}
          aria-expanded={expanded}
          onClick={onToggleExpand}
          className="flex h-6 w-5 shrink-0 items-center justify-center rounded hover:bg-surface-subtle"
        >
          <ChevronRight
            size={12}
            className="text-foreground-subtle"
            style={{
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 120ms',
            }}
          />
        </button>
        <button
          type="button"
          onClick={onSelectProject}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left"
          style={{ fontWeight: selected ? 600 : 400 }}
        >
          <KeyChip size="sm">{project.key}</KeyChip>
          <span className="truncate text-ui-sm">{project.name}</span>
          {selected && <Check size={10} className="ml-auto shrink-0 text-primary" />}
        </button>
      </div>
      {expanded && (
        <div className="mb-0.5 ml-5 border-l border-border-subtle pl-1.5">
          <button
            type="button"
            onClick={() => onSelectTeam(null)}
            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-subtle"
            style={{
              color: selected && !currentTeamId ? BRAND.primary : BRAND.textPrimary,
              fontWeight: selected && !currentTeamId ? 600 : 400,
            }}
          >
            <Users size={11} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-ui-sm">All Teams</span>
            {selected && !currentTeamId && (
              <Check size={10} className="ml-auto shrink-0 text-primary" />
            )}
          </button>
          {isLoading && (
            <div className="px-1.5 py-1 text-ui-xs text-foreground-subtle">Loading teams…</div>
          )}
          {!isLoading &&
            activeTeams.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTeam(t)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-subtle"
                style={{
                  color: currentTeamId === t.id ? BRAND.primary : BRAND.textPrimary,
                  fontWeight: currentTeamId === t.id ? 600 : 400,
                }}
              >
                <KeyChip size="sm" tone="muted">
                  {t.key}
                </KeyChip>
                <span className="truncate text-ui-sm">{t.name}</span>
                {currentTeamId === t.id && (
                  <Check size={10} className="ml-auto shrink-0 text-primary" />
                )}
              </button>
            ))}
          {!isLoading && activeTeams.length === 0 && (
            <div className="px-1.5 py-1 text-ui-xs text-foreground-subtle">
              No teams in this project yet
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AppShell() {
  const {
    user,
    hasPermission,
    clearAuth,
    memberships,
    activeWorkspaceId,
    switchWorkspace,
    isSwitchingWorkspace,
  } = useAuthStore()
  const { workspace, project, team, setWorkspace, setProject, setTeam } = useAppContext()
  const navigate = useNavigate()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const matches = useMatches()

  const [wsOpen, setWsOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  // Which top-nav dropdown is open, keyed by nav label (Plan, Track, …). Only one at a time.
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // Workspace-switcher project tree state (filter + which project is expanded).
  const [projectSearch, setProjectSearch] = useState('')
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)

  const { data: unreadCount = 0 } = useNotificationUnreadCount()

  // SSE real-time push — updates unread count and shows toast on new notifications.
  // Falls back to the 60s poll above when the stream is unavailable.
  useNotificationSse((payload) => {
    toast(payload.title, {
      description: payload.body ?? undefined,
      duration: 5000,
    })
  })

  // Breadcrumb: collect matches that declare a breadcrumb label
  const crumbs = matches
    .filter((m) => (m.staticData as { breadcrumb?: string })?.breadcrumb)
    .map((m) => (m.staticData as { breadcrumb: string }).breadcrumb)

  // Bootstrap workspace context from API — always sync name/slug in case they changed
  const { data: workspaces } = useWorkspaces()
  const { data: activeProjects = [] } = useProjects(workspace?.workspaceId)
  const navProjects = activeProjects.filter((p) => p.status === 'active')
  // Filter the workspace-switcher project list so the dropdown stays usable even
  // when a workspace has hundreds of projects.
  const projectQuery = projectSearch.trim().toLowerCase()
  const filteredNavProjects = projectQuery
    ? navProjects.filter(
        (p) =>
          p.name.toLowerCase().includes(projectQuery) || p.key.toLowerCase().includes(projectQuery),
      )
    : navProjects

  const selectedTeamName = team?.teamName ?? 'All Teams'
  useEffect(() => {
    if (!workspaces || workspaces.length === 0) return
    const first = workspaces[0]
    // Always sync from API — name or slug may have changed since last persist
    if (
      !workspace ||
      workspace.workspaceId !== first.id ||
      workspace.workspaceName !== first.name ||
      workspace.workspaceSlug !== first.slug
    ) {
      setWorkspace({ workspaceId: first.id, workspaceSlug: first.slug, workspaceName: first.name })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces])

  // SHELL-FR-005: Invalidate all project-scoped queries when the project context changes
  const projectId = project?.projectId
  useEffect(() => {
    if (projectId) {
      void queryClient.invalidateQueries()
    }
  }, [projectId])

  // Invalidate work-item queries when the team context changes so that
  // backlog / iteration-status / home pages re-fetch with the new teamId filter.
  const teamId = team?.teamId
  useEffect(() => {
    if (projectId) {
      void queryClient.invalidateQueries({ queryKey: ['work-items'] })
    }
  }, [teamId, projectId])

  async function handleSignOut() {
    // Revoke the server-side session (clears the __Host-rally_session cookie)
    // and return to login. The browser holds no tokens to clear.
    try {
      await fetch(`${ENV.API_BASE_URL}/v1/bff/logout`, {
        method: 'POST',
        credentials: 'include',
        referrerPolicy: 'no-referrer',
      })
    } catch {
      // Ignore network errors on sign-out — always clear local state
    }
    clearAuth()
    toast.success('Signed out')
    await navigate({ to: '/login' })
  }

  function closeAll() {
    setWsOpen(false)
    setUserOpen(false)
    setOpenMenu(null)
    setNotifOpen(false)
  }

  // Close all dropdowns on route change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    closeAll()
  }, [currentPath])

  // Close all dropdowns on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAll()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  function handleComingSoon(label: string) {
    closeAll()
    toast.info(`${label} · Coming soon`, {
      description: 'This feature will be available in a future release.',
      duration: 3000,
    })
  }

  const isActive = (path: string) =>
    path === '/' ? currentPath === '/' : currentPath.startsWith(path)

  /**
   * Determine nav item visibility:
   *  - Feature disabled → show as "coming soon" (not hidden, per spec)
   *  - Feature enabled + permission required + user lacks it → hide
   *  - Otherwise → show as active link
   */
  function navItemState(
    item: Pick<NavItem, 'featureFlag' | 'permission'>,
  ): 'coming-soon' | 'hidden' | 'active' {
    if (item.featureFlag && !isFeatureEnabled(item.featureFlag)) return 'coming-soon'
    if (item.permission && !hasPermission(item.permission)) return 'hidden'
    return 'active'
  }

  return (
    <div className="flex min-h-svh flex-col">
      {/* Backdrop to close open dropdowns when clicking outside */}
      {(openMenu !== null || wsOpen || userOpen || notifOpen) && (
        <div className="fixed inset-0 z-20" aria-hidden onClick={closeAll} />
      )}
      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <header
        className="relative z-30 flex h-10 shrink-0 items-center bg-primary px-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Logo + workspace selector */}
        <div className="mr-4 flex items-center gap-2">
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
          >
            <Layers size={13} className="text-white" />
          </div>
          <div className="relative">
            <button
              onClick={() => {
                const willOpen = !wsOpen
                setWsOpen(willOpen)
                setUserOpen(false)
                setOpenMenu(null)
                if (willOpen) {
                  // Expand the active project so its team is visible; reset the filter.
                  setExpandedProjectId(project?.projectId ?? null)
                  setProjectSearch('')
                }
              }}
              className="flex items-center gap-1.5 text-left text-white hover:opacity-90"
            >
              <div className="leading-tight">
                <div className="text-ui-lg font-semibold">
                  {memberships.find((m) => m.workspaceId === activeWorkspaceId)?.name ??
                    workspace?.workspaceName ??
                    'Select organization'}
                </div>
                <div
                  className="max-w-44 truncate text-ui-2xs"
                  style={{ color: 'rgba(255,255,255,0.55)' }}
                >
                  {project ? `${project.projectKey} · ${selectedTeamName}` : 'No project selected'}
                </div>
              </div>
              <ChevronDown size={10} className="opacity-60" />
            </button>

            {wsOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 overflow-hidden rounded border border-border bg-card py-1.5 shadow-xl">
                {/* Active organization header */}
                <div className="flex items-center gap-2.5 border-b border-border-subtle bg-surface-hover px-3 py-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-avatar text-primary">
                    <Layers size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-ui-2xs font-semibold tracking-widest text-foreground-subtle uppercase">
                      Organization
                    </div>
                    <div className="truncate text-ui-lg font-semibold text-foreground">
                      {memberships.find((m) => m.workspaceId === activeWorkspaceId)?.name ??
                        workspace?.workspaceName ??
                        '—'}
                    </div>
                  </div>
                  <span className="rounded-sm bg-success-bg px-1.5 py-0.5 text-ui-2xs font-semibold text-success">
                    Active
                  </span>
                </div>

                {/* Switch organization — only when user has multiple workspaces */}
                {memberships.length > 1 && (
                  <div className="border-b border-border-subtle px-3 pt-2 pb-1">
                    <div className="mb-1 text-ui-2xs font-semibold tracking-widest text-foreground-subtle uppercase">
                      Switch Organization
                    </div>
                    {memberships
                      .filter((m) => m.workspaceId !== activeWorkspaceId)
                      .map((m) => (
                        <button
                          key={m.workspaceId}
                          disabled={isSwitchingWorkspace}
                          onClick={async () => {
                            await switchWorkspace(m.workspaceId)
                            closeAll()
                            window.location.reload()
                          }}
                          className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left hover:bg-surface-subtle disabled:opacity-50"
                        >
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-avatar text-ui-2xs font-bold text-primary">
                            {m.name[0].toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-ui-md text-foreground">{m.name}</div>
                            {m.roleName && (
                              <div className="text-ui-xs text-foreground-subtle">{m.roleName}</div>
                            )}
                          </div>
                        </button>
                      ))}
                  </div>
                )}

                <div className="px-3 py-2 text-ui-sm text-muted-foreground">
                  {/* View workspace (deselect project) */}
                  <button
                    onClick={() => {
                      if (!project) return
                      setProject(null)
                      setTeam(null)
                      closeAll()
                    }}
                    disabled={!project}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left"
                    style={{
                      color: project ? BRAND.textPrimary : BRAND.textMuted,
                      opacity: project ? 1 : 0.65,
                      cursor: project ? 'pointer' : 'not-allowed',
                    }}
                    onMouseEnter={(e) => {
                      if (!project) return
                      e.currentTarget.style.backgroundColor = BRAND.surfaceSubtle
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <Layers
                      size={12}
                      className="shrink-0"
                      style={{ color: project ? BRAND.textSecondary : BRAND.textMuted }}
                    />
                    <span className="text-ui-sm">View workspace</span>
                  </button>
                  <div className="my-1.5 border-t border-border-subtle" />
                  {/* Projects & Teams — searchable, scrollable accordion tree.
                      Each project expands to reveal its teams (lazy-loaded). */}
                  {navProjects.length > 0 && (
                    <>
                      <div className="mb-1 flex items-center justify-between">
                        <div className="text-ui-2xs font-semibold tracking-widest text-foreground-subtle uppercase">
                          Projects & Teams
                        </div>
                        <span className="text-ui-2xs text-foreground-subtle">
                          {navProjects.length}
                        </span>
                      </div>
                      {/* Filter — only worth surfacing once the list gets long */}
                      {navProjects.length > 7 && (
                        <div className="relative mb-1">
                          <Search
                            size={11}
                            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-foreground-subtle"
                          />
                          <input
                            value={projectSearch}
                            onChange={(e) => setProjectSearch(e.target.value)}
                            placeholder="Filter projects…"
                            aria-label="Filter projects"
                            className="w-full rounded border border-border-subtle py-1 pr-2 pl-6 text-ui-sm text-foreground outline-none"
                          />
                        </div>
                      )}
                      <div className="-mx-0.5 max-h-64 overflow-y-auto px-0.5">
                        {filteredNavProjects.map((p) => (
                          <ProjectTreeItem
                            key={p.id}
                            project={p}
                            selected={project?.projectId === p.id}
                            expanded={expandedProjectId === p.id}
                            currentTeamId={team?.teamId ?? null}
                            onToggleExpand={() =>
                              setExpandedProjectId((cur) => (cur === p.id ? null : p.id))
                            }
                            onSelectProject={() => {
                              setProject({
                                projectId: p.id,
                                projectKey: p.key,
                                projectName: p.name,
                              })
                              setTeam(null)
                              closeAll()
                            }}
                            onSelectTeam={(t) => {
                              setProject({
                                projectId: p.id,
                                projectKey: p.key,
                                projectName: p.name,
                              })
                              setTeam(t ? { teamId: t.id, teamName: t.name } : null)
                              closeAll()
                            }}
                          />
                        ))}
                        {filteredNavProjects.length === 0 && (
                          <div className="px-1.5 py-2 text-center text-ui-xs text-foreground-subtle">
                            No projects match “{projectSearch.trim()}”
                          </div>
                        )}
                      </div>
                      <div className="my-1.5 border-t border-border-subtle" />
                    </>
                  )}
                  <Link
                    to="/projects"
                    onClick={closeAll}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <Settings size={12} />
                    Manage projects
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Primary nav */}
        <nav className="flex flex-1 items-center gap-0.5">
          {NAV_ITEMS.map(({ path, label, children, featureFlag, permission }) => {
            const state = navItemState({ featureFlag, permission })
            if (state === 'hidden') return null

            const comingSoon = state === 'coming-soon'

            if (children) {
              return (
                // Plan dropdown
                <div key={label} className="relative">
                  <button
                    aria-haspopup="menu"
                    aria-expanded={openMenu === label}
                    onClick={() => {
                      if (comingSoon) {
                        handleComingSoon(label)
                        return
                      }
                      // Toggle dropdown — never auto-navigate. User picks a child.
                      setOpenMenu((cur) => (cur === label ? null : label))
                      setWsOpen(false)
                      setUserOpen(false)
                    }}
                    className="flex items-center gap-1.5 rounded py-1 pr-2 pl-2.5 text-ui-lg font-medium transition-colors"
                    style={{
                      backgroundColor: isActive(path) ? 'rgba(255,255,255,0.16)' : 'transparent',
                      color: isActive(path) ? BRAND.surface : 'rgba(255,255,255,0.72)',
                    }}
                  >
                    {label}
                    {comingSoon ? (
                      <span
                        className="ml-0.5 rounded-sm px-1 py-px text-ui-2xs font-semibold tracking-wide uppercase"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.12)',
                          color: 'rgba(255,255,255,0.5)',
                        }}
                      >
                        Soon
                      </span>
                    ) : (
                      <ChevronDown
                        size={9}
                        style={{
                          color: isActive(path) ? BRAND.surface : 'rgba(255,255,255,0.55)',
                          transform: openMenu === label ? 'rotate(180deg)' : 'none',
                          transition: 'transform 0.15s',
                        }}
                      />
                    )}
                  </button>
                  {!comingSoon && openMenu === label && (
                    <div className="absolute top-full left-0 z-50 mt-1 w-44 rounded border border-border bg-card py-1 shadow-lg">
                      <div className="px-3 py-1.5 text-ui-2xs font-semibold tracking-widest text-foreground-subtle uppercase">
                        {label}
                      </div>
                      {children.map((child) => {
                        const childState = navItemState(child)
                        if (childState === 'hidden') return null
                        const childComingSoon = childState === 'coming-soon'
                        if (childComingSoon) {
                          return (
                            <button
                              key={child.path}
                              onClick={() => handleComingSoon(child.label)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-ui-lg text-foreground"
                            >
                              <span className="flex-1">{child.label}</span>
                              <span className="rounded-sm bg-border-inner px-1 py-px text-ui-2xs font-semibold tracking-wide text-foreground-subtle uppercase">
                                Soon
                              </span>
                            </button>
                          )
                        }
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            onClick={() => setOpenMenu(null)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-ui-lg"
                            style={{
                              color: isActive(child.path) ? BRAND.primary : BRAND.textPrimary,
                              backgroundColor: isActive(child.path)
                                ? BRAND.primaryLighter
                                : 'transparent',
                              fontWeight: isActive(child.path) ? 600 : 400,
                            }}
                          >
                            <span className="flex-1">{child.label}</span>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            }

            if (comingSoon) {
              return (
                <button
                  key={path}
                  onClick={() => handleComingSoon(label)}
                  className="flex items-center rounded px-2.5 py-1 text-ui-lg font-medium transition-colors"
                  style={{ color: 'rgba(255,255,255,0.55)' }}
                >
                  {label}
                  <span
                    className="rounded-sm px-1 py-px text-ui-2xs font-semibold tracking-wide uppercase"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.10)',
                      color: 'rgba(255,255,255,0.45)',
                    }}
                  >
                    Soon
                  </span>
                </button>
              )
            }

            return (
              <Link
                key={path}
                to={path as '/'}
                onClick={closeAll}
                className="flex items-center rounded px-2.5 py-1 text-ui-lg font-medium transition-colors"
                style={{
                  backgroundColor: isActive(path) ? 'rgba(255,255,255,0.16)' : 'transparent',
                  color: isActive(path) ? BRAND.surface : 'rgba(255,255,255,0.72)',
                }}
              >
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-1">
          {/* Search */}
          <div className="relative mr-1">
            <Search
              size={12}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
              style={{ color: 'rgba(255,255,255,0.4)' }}
            />
            <input
              type="search"
              placeholder="Search all work items"
              aria-label="Search all work items"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded py-1 pr-3 pl-7 text-ui-md text-white placeholder:text-[rgba(255,255,255,0.45)] focus:outline-none"
              style={{
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.18)',
                width: 200,
              }}
            />
          </div>

          {/* Notifications — click to open popover; Shift+click goes to full page */}
          <div className="relative">
            <button
              aria-label="Notifications"
              aria-haspopup="dialog"
              aria-expanded={notifOpen}
              onClick={() => {
                setNotifOpen((o) => !o)
                setWsOpen(false)
                setUserOpen(false)
                setOpenMenu(null)
              }}
              className="relative rounded p-1.5 transition-colors"
              style={{
                color: notifOpen ? BRAND.surface : 'rgba(255,255,255,0.65)',
                backgroundColor: notifOpen ? 'rgba(255,255,255,0.16)' : 'transparent',
              }}
            >
              <Bell size={14} />
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-destructive px-0.5 text-ui-2xs leading-none font-bold text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            <NotificationPopover open={notifOpen} onClose={() => setNotifOpen(false)} />
          </div>

          {/* Help */}
          <button
            className="rounded p-1.5"
            style={{ color: 'rgba(255,255,255,0.65)' }}
            aria-label="Help"
            onClick={() => toast.info('Help & documentation coming soon', { duration: 2500 })}
          >
            <HelpCircle size={14} />
          </button>

          {/* Settings */}
          <Link
            to={'/settings' as '/'}
            className="rounded p-1.5"
            style={{ color: isActive('/settings') ? BRAND.surface : 'rgba(255,255,255,0.65)' }}
            onClick={closeAll}
          >
            <Settings size={14} />
          </Link>

          {/* User menu */}
          <div className="relative ml-1">
            <button
              onClick={() => {
                setUserOpen((o) => !o)
                setWsOpen(false)
                setOpenMenu(null)
              }}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:opacity-90"
              style={{ color: 'rgba(255,255,255,0.85)' }}
            >
              <Avatar name={user?.displayName ?? 'U'} size={24} />
              <ChevronDown size={9} className="opacity-60" />
            </button>

            {userOpen && (
              <div className="absolute top-full right-0 z-50 mt-1 w-56 overflow-hidden rounded border border-border bg-card shadow-xl">
                {/* Profile info */}
                <div className="flex items-center gap-2.5 border-b border-border-subtle bg-surface-hover px-3 py-3">
                  <Avatar name={user?.displayName ?? 'U'} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ui-md font-semibold text-foreground">
                      {user?.displayName}
                    </div>
                    <div className="truncate text-ui-xs text-foreground-subtle">{user?.email}</div>
                  </div>
                </div>

                {/* Menu items */}
                <div className="py-1">
                  <Link
                    to={'/settings' as '/'}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-ui-sm text-foreground hover:bg-surface-subtle"
                    onClick={closeAll}
                  >
                    <User size={13} className="text-muted-foreground" />
                    My profile
                  </Link>
                  <Link
                    to={'/settings' as '/'}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-ui-sm text-foreground hover:bg-surface-subtle"
                    onClick={closeAll}
                  >
                    <Settings size={13} className="text-muted-foreground" />
                    Settings
                  </Link>
                </div>

                <div className="border-t border-border-subtle py-1">
                  <button
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-ui-sm text-destructive hover:bg-destructive-bg"
                  >
                    <LogOut size={13} />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Breadcrumb bar ───────────────────────────────────────────────────── */}
      {crumbs.length > 0 && (
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-card px-4 text-ui-sm">
          <span className="text-muted-foreground">{workspace?.workspaceName ?? 'Workspace'}</span>
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <ChevronRight size={11} className="text-foreground-faint" />
              <span
                style={{
                  color: i === crumbs.length - 1 ? BRAND.textPrimary : BRAND.textSecondary,
                  fontWeight: i === crumbs.length - 1 ? 600 : 400,
                }}
              >
                {crumb}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* ── Page content ─────────────────────────────────────────────────────── */}
      <main
        id="main-content"
        className="flex flex-1 flex-col overflow-auto bg-background"
        aria-label="Main content"
      >
        <PageErrorBoundary>
          <Outlet />
        </PageErrorBoundary>
      </main>
    </div>
  )
}
