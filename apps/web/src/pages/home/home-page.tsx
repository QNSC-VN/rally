import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowUpRight, Clock, Inbox } from 'lucide-react'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { BRAND } from '@/shared/config/brand'
import { PageHeader } from '@/shared/ui/page-header'
import { EmptyState } from '@/shared/ui/empty-state'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { KeyChip } from '@/shared/ui/key-chip'
import { TypeBadge, ScheduleStateBadge, PriorityBadge } from '@/entities/work-item/ui/badges'
import { WorkItemType, WorkItemPriority } from '@/entities/work-item/model/types'
import { type Project, useProjects, useProjectStatuses } from '@/features/projects/api'
import { useWorkItems, useMyWorkItems, useWorkItemCounts } from '@/features/work-items/api'
import { useIterations, useCommittedIterationsCount } from '@/features/iterations/api'
import { useNotifications } from '@/features/notifications/api'
import { NotificationItem } from '@/features/notifications/ui/notification-item'

// ── Type mapping helpers ───────────────────────────────────────────────────────

function toWiType(raw: string): WorkItemType {
  const map: Record<string, WorkItemType> = {
    initiative: WorkItemType.Initiative,
    feature: WorkItemType.Feature,
    story: WorkItemType.Story,
    task: WorkItemType.Task,
    defect: WorkItemType.Defect,
  }
  return map[raw] ?? WorkItemType.Task
}

function toPriority(raw: string): WorkItemPriority {
  const map: Record<string, WorkItemPriority> = {
    urgent: WorkItemPriority.Urgent,
    high: WorkItemPriority.High,
    normal: WorkItemPriority.Normal,
    low: WorkItemPriority.Low,
    none: WorkItemPriority.None,
  }
  return map[raw] ?? WorkItemPriority.None
}

function getGreeting(t: (key: string) => string) {
  const h = new Date().getHours()
  if (h < 12) return t('greeting.morning')
  if (h < 17) return t('greeting.afternoon')
  return t('greeting.evening')
}

// ── Project Health Row ────────────────────────────────────────────────────────
function ProjectHealthRow({
  project,
  isSelected,
  currentUserId,
  currentUserDisplayName,
}: {
  project: Project
  isSelected: boolean
  currentUserId: string | undefined
  currentUserDisplayName: string | undefined
}) {
  const { t } = useTranslation('home')
  const { data: workItems = [] } = useWorkItems({ projectId: project.id, limit: 100 })
  const { data: iterations = [] } = useIterations(project.id)
  const { data: statuses = [] } = useProjectStatuses(project.id)

  const categoryMap = useMemo(
    () => Object.fromEntries(statuses.map((s) => [s.id, s.category])),
    [statuses],
  )
  const activeSprint = iterations.find((i) => i.state === 'committed')
  const done = workItems.filter((i) => categoryMap[i.statusId] === 'done').length
  const defects = workItems.filter(
    (i) => i.type === 'defect' && categoryMap[i.statusId] !== 'done',
  ).length
  const blocked = workItems.filter((i) => i.isBlocked).length
  const progress = workItems.length > 0 ? Math.round((done / workItems.length) * 100) : 0
  const progressColor =
    progress >= 70 ? BRAND.success : progress >= 40 ? BRAND.primaryLight : BRAND.warning

  return (
    <div
      className="flex h-9 items-center gap-3 border-b border-border-inner px-4 transition-colors hover:bg-surface-hover"
      style={{
        backgroundColor: isSelected ? BRAND.primaryLighter : undefined,
      }}
    >
      {/* Key */}
      <div className="w-14 shrink-0">
        <KeyChip>{project.key}</KeyChip>
      </div>
      {/* Name */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-ui-md font-medium text-foreground">
          {project.name}
        </span>
      </div>
      {/* Active Sprint */}
      <div className="w-32 shrink-0 text-ui-sm text-muted-foreground">
        {activeSprint ? (
          activeSprint.name
        ) : (
          <span className="text-foreground-subtle">{t('projectHealth.noActiveSprint')}</span>
        )}
      </div>
      {/* Progress */}
      <div className="flex w-36 shrink-0 items-center gap-2">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border-subtle">
          <div
            className="h-full rounded-full"
            style={{ width: `${progress}%`, backgroundColor: progressColor }}
          />
        </div>
        <span className="text-ui-xs font-semibold text-muted-foreground tabular-nums">
          {progress}%
        </span>
      </div>
      {/* Open Defects */}
      <div className="w-24 shrink-0">
        <span
          className="text-ui-md font-semibold tabular-nums"
          style={{ color: defects > 0 ? BRAND.danger : BRAND.success }}
        >
          {defects}
        </span>
        <span className="ml-1 text-ui-xs text-foreground-subtle">
          {t('projectHealth.defect', { count: defects })}
        </span>
      </div>
      {/* Blocked */}
      <div className="w-24 shrink-0">
        {blocked > 0 ? (
          <span className="inline-flex items-center gap-1 text-ui-xs font-semibold text-destructive">
            <AlertTriangle size={11} />
            {t('projectHealth.blockedCount', { count: blocked })}
          </span>
        ) : (
          <span className="text-ui-xs text-success">{t('projectHealth.none')}</span>
        )}
      </div>
      {/* Owner */}
      <div className="flex w-32 shrink-0 items-center">
        <OwnerCell
          name={
            project.leadId
              ? (project.leadName ??
                (project.leadId === currentUserId ? currentUserDisplayName : null))
              : null
          }
        />
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function HomePage() {
  const { t } = useTranslation('home')
  const { user } = useAuthStore()
  const { workspace, project: selectedProject } = useAppContext()
  const workspaceId = workspace?.workspaceId

  const now = useMemo(
    () =>
      new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    [],
  )

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: allProjects = [], isLoading: loadingProjects } = useProjects(workspaceId)
  const activeProjects = useMemo(
    () => allProjects.filter((p) => p.status === 'active'),
    [allProjects],
  )
  const projectsForStats = useMemo(
    () => activeProjects.map((p) => ({ id: p.id })),
    [activeProjects],
  )
  const projectsForMyWork = useMemo(
    () => activeProjects.map((p) => ({ id: p.id, key: p.key, name: p.name })),
    [activeProjects],
  )

  const { data: counts = { total: 0, blocked: 0, defects: 0 } } =
    useWorkItemCounts(projectsForStats)
  const { data: activeSprintsCount = 0 } = useCommittedIterationsCount(projectsForStats)
  const { data: myItems = [] } = useMyWorkItems(projectsForMyWork, user?.id)
  const { data: activity = [] } = useNotifications({})

  const summaryMetrics = [
    { label: t('metrics.activeProjects'), value: String(activeProjects.length), path: '/projects' },
    { label: t('metrics.openWorkItems'), value: String(counts.total), path: '/backlog' },
    { label: t('metrics.activeSprints'), value: String(activeSprintsCount), path: '/timeboxes' },
    {
      label: t('metrics.blockedItems'),
      value: String(counts.blocked),
      path: '/backlog',
      alert: true,
    },
    {
      label: t('metrics.openDefects'),
      value: String(counts.defects),
      path: '/quality',
      alert: true,
    },
    { label: t('metrics.assignedToMe'), value: String(myItems.length), path: '/backlog' },
  ]

  return (
    <div className="flex flex-1 flex-col bg-background">
      <PageHeader
        title={t('title')}
        actions={
          <div className="text-ui-sm text-muted-foreground">
            {getGreeting(t)},{' '}
            <span className="font-medium text-foreground">{user?.displayName ?? t('user')}</span> ·{' '}
            <span className="font-medium text-foreground">{now}</span>
          </div>
        }
      />

      {/* Summary strip */}
      {loadingProjects ? (
        <div className="flex shrink-0 border-b border-border-subtle bg-card">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`flex flex-1 flex-col justify-center gap-2 px-5 py-3 ${i > 0 ? 'border-l border-border-subtle' : ''}`}
            >
              <div className="h-3 w-20 animate-pulse rounded bg-gray-200" />
              <div className="h-6 w-8 animate-pulse rounded bg-gray-200" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex shrink-0 border-b border-border-subtle bg-card">
          {summaryMetrics.map((m, i) => {
            const inner = (
              <>
                <span className="text-ui-2xs font-semibold tracking-widest text-foreground-subtle uppercase">
                  {m.label}
                </span>
                <span
                  className="text-xl leading-tight font-semibold"
                  style={{ color: m.alert ? BRAND.danger : BRAND.textPrimary }}
                >
                  {m.value}
                </span>
              </>
            )
            const sharedClass = `flex flex-1 flex-col justify-center px-5 py-3 text-left transition-colors hover:bg-surface-hover ${i > 0 ? 'border-l border-border-subtle' : ''}`
            return (
              <Link key={m.label} to={m.path as '/'} className={sharedClass}>
                {inner}
              </Link>
            )
          })}
        </div>
      )}

      {/* Body grid */}
      <div className="grid flex-1 grid-cols-3 gap-4 p-4">
        {/* My Work table */}
        <div className="col-span-2 overflow-hidden rounded border border-border-subtle bg-card">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <p className="text-ui-md font-semibold text-foreground">{t('myWork.title')}</p>
            <span className="rounded-sm bg-primary-lighter px-1.5 py-px text-ui-xs font-semibold text-primary-light">
              {t('myWork.itemCount', { count: myItems.length })}
            </span>
          </div>

          {/* Table header */}
          <div className="flex h-7 items-center gap-2 border-b border-border-subtle bg-surface-hover px-3 select-none">
            {(
              [
                ['w-[60px] shrink-0', t('myWork.columns.id')],
                ['w-14 shrink-0', t('myWork.columns.type')],
                ['flex-1 min-w-0 pr-2', t('common:name')],
                ['w-24 shrink-0', t('myWork.columns.project')],
                ['w-24 shrink-0', t('common:status')],
                ['w-[80px] shrink-0', t('myWork.columns.priority')],
              ] as [string, string][]
            ).map(([cls, label]) => (
              <div
                key={label}
                className={`${cls} text-ui-2xs font-semibold tracking-widest text-foreground-subtle uppercase`}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Rows */}
          {myItems.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Inbox size={28} className="text-foreground-subtle" />}
              title={t('myWork.empty')}
            />
          ) : (
            myItems.map((item) => {
              return (
                <div
                  key={item.id}
                  className="flex h-8 items-center gap-2 border-b border-border-inner px-3 hover:bg-surface-hover"
                >
                  <div className="w-[60px] shrink-0 font-mono text-ui-xs text-muted-foreground">
                    {item.itemKey}
                  </div>
                  <div className="w-14 shrink-0">
                    <TypeBadge type={toWiType(item.type)} />
                  </div>
                  <div className="min-w-0 flex-1 pr-2">
                    <span className="block truncate text-ui-md font-medium text-foreground">
                      {item.title}
                    </span>
                  </div>
                  <div className="w-24 shrink-0 font-mono text-ui-xs text-muted-foreground">
                    {item.projectKey}
                  </div>
                  <div className="w-24 shrink-0">
                    <ScheduleStateBadge state={item.scheduleState} />
                  </div>
                  <div className="w-[80px] shrink-0">
                    <PriorityBadge priority={toPriority(item.priority)} />
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Recent Activity — sourced from the notification feed (assignments/mentions) */}
        <div className="overflow-hidden rounded border border-border-subtle bg-card">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <p className="text-ui-md font-semibold text-foreground">{t('activity.title')}</p>
            <Link
              to={'/notifications' as '/'}
              className="flex items-center gap-1 text-ui-sm text-primary-light"
            >
              {t('activity.all')} <ArrowUpRight size={11} />
            </Link>
          </div>
          {activity.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Clock size={28} className="text-foreground-subtle" />}
              title={t('activity.empty.title')}
              description={t('activity.empty.description')}
            />
          ) : (
            <ul className="flex flex-col">
              {activity.slice(0, 8).map((n) => (
                <NotificationItem key={n.id} notification={n} dense />
              ))}
            </ul>
          )}
        </div>

        {/* Project Health table */}
        <div className="col-span-3 overflow-hidden rounded border border-border-subtle bg-card">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <p className="text-ui-md font-semibold text-foreground">{t('projectHealth.title')}</p>
            {selectedProject && (
              <span className="text-ui-xs font-semibold text-primary-light">
                {t('projectHealth.selected', { key: selectedProject.projectKey })}
              </span>
            )}
          </div>
          {/* Table header */}
          <div className="flex h-7 items-center gap-3 border-b border-border-subtle bg-surface-hover px-4 select-none">
            {(
              [
                ['w-14 shrink-0', t('projectHealth.columns.key')],
                ['flex-1 min-w-0', t('projectHealth.columns.projectName')],
                ['w-32 shrink-0', t('projectHealth.columns.activeSprint')],
                ['w-36 shrink-0', t('projectHealth.columns.progress')],
                ['w-24 shrink-0', t('projectHealth.columns.openDefects')],
                ['w-24 shrink-0', t('projectHealth.columns.blocked')],
                ['w-32 shrink-0', t('common:owner')],
              ] as [string, string][]
            ).map(([cls, label]) => (
              <div
                key={label}
                className={`${cls} text-ui-2xs font-semibold tracking-widest text-foreground-subtle uppercase`}
              >
                {label}
              </div>
            ))}
          </div>
          {/* Rows */}
          {activeProjects.length === 0 ? (
            <EmptyState size="sm" title={t('projectHealth.empty')} />
          ) : (
            activeProjects.map((p) => (
              <ProjectHealthRow
                key={p.id}
                project={p}
                isSelected={selectedProject?.projectId === p.id}
                currentUserId={user?.id}
                currentUserDisplayName={user?.displayName}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
