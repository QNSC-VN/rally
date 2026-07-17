import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowUpRight, Clock, Inbox } from 'lucide-react'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { BRAND } from '@/shared/config/brand'
import { PageHeader } from '@/shared/ui/page-header'
import { TypeBadge, ScheduleStateBadge, PriorityBadge } from '@/entities/work-item/ui/badges'
import { WorkItemType, WorkItemPriority } from '@/entities/work-item/model/types'
import { type Project, useProjects, useProjectStatuses } from '@/features/projects/api'
import { useWorkItems, useMyWorkItems, useWorkItemCounts } from '@/features/work-items/api'
import { useIterations, useCommittedIterationsCount } from '@/features/iterations/api'

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

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
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
      className="flex h-9 items-center gap-3 px-4 transition-colors hover:bg-surface-hover"
      style={{
        borderBottom: `1px solid ${BRAND.borderInner}`,
        backgroundColor: isSelected ? BRAND.primaryLighter : undefined,
      }}
    >
      {/* Key */}
      <div className="w-14 shrink-0">
        <span
          className="rounded-sm px-1.5 py-px font-mono text-[10px] font-semibold"
          style={{
            backgroundColor: isSelected ? '#d8e5f7' : BRAND.pageBg,
            color: isSelected ? BRAND.primaryLight : BRAND.textSecondary,
          }}
        >
          {project.key}
        </span>
      </div>
      {/* Name */}
      <div className="min-w-0 flex-1">
        <span
          className="block truncate text-[12px] font-medium"
          style={{ color: BRAND.textPrimary }}
        >
          {project.name}
        </span>
      </div>
      {/* Active Sprint */}
      <div className="w-32 shrink-0 text-[11px]" style={{ color: BRAND.textSecondary }}>
        {activeSprint ? (
          activeSprint.name
        ) : (
          <span style={{ color: BRAND.textMuted }}>No active sprint</span>
        )}
      </div>
      {/* Progress */}
      <div className="flex w-36 shrink-0 items-center gap-2">
        <div
          className="h-1.5 w-20 overflow-hidden rounded-full"
          style={{ backgroundColor: '#e4e8ed' }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${progress}%`, backgroundColor: progressColor }}
          />
        </div>
        <span
          className="text-[10px] font-semibold tabular-nums"
          style={{ color: BRAND.textSecondary }}
        >
          {progress}%
        </span>
      </div>
      {/* Open Defects */}
      <div className="w-24 shrink-0">
        <span
          className="text-[12px] font-semibold tabular-nums"
          style={{ color: defects > 0 ? BRAND.danger : BRAND.success }}
        >
          {defects}
        </span>
        <span className="ml-1 text-[10px]" style={{ color: BRAND.textMuted }}>
          {defects === 1 ? 'defect' : 'defects'}
        </span>
      </div>
      {/* Blocked */}
      <div className="w-24 shrink-0">
        {blocked > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold"
            style={{ color: BRAND.danger }}
          >
            <AlertTriangle size={11} />
            {blocked} blocked
          </span>
        ) : (
          <span className="text-[10px]" style={{ color: BRAND.success }}>
            None
          </span>
        )}
      </div>
      {/* Owner */}
      <div className="w-32 shrink-0 text-[11px]" style={{ color: BRAND.textSecondary }}>
        {project.leadId === currentUserId ? (
          (currentUserDisplayName ?? 'You')
        ) : (
          <span style={{ color: BRAND.textMuted }}>—</span>
        )}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function HomePage() {
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

  const summaryMetrics = [
    { label: 'Active Projects', value: String(activeProjects.length), path: '/projects' },
    { label: 'Open Work Items', value: String(counts.total), path: '/backlog' },
    { label: 'Active Sprints', value: String(activeSprintsCount), path: '/timeboxes' },
    { label: 'Blocked Items', value: String(counts.blocked), path: '/backlog', alert: true },
    { label: 'Open Defects', value: String(counts.defects), path: '/quality', alert: true },
    { label: 'Assigned to Me', value: String(myItems.length), path: '/backlog' },
  ]

  return (
    <div className="flex flex-1 flex-col" style={{ backgroundColor: BRAND.pageBg }}>
      <PageHeader
        title="Home"
        actions={
          <div className="text-[11px]" style={{ color: BRAND.textSecondary }}>
            {getGreeting()},{' '}
            <span className="font-medium" style={{ color: BRAND.textPrimary }}>
              {user?.displayName ?? 'User'}
            </span>{' '}
            ·{' '}
            <span className="font-medium" style={{ color: BRAND.textPrimary }}>
              {now}
            </span>
          </div>
        }
      />

      {/* Summary strip */}
      {loadingProjects ? (
        <div
          className="flex shrink-0 bg-white"
          style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-1 flex-col justify-center gap-2 px-5 py-3"
              style={i > 0 ? { borderLeft: `1px solid ${BRAND.borderSubtle}` } : undefined}
            >
              <div className="h-3 w-20 animate-pulse rounded bg-gray-200" />
              <div className="h-6 w-8 animate-pulse rounded bg-gray-200" />
            </div>
          ))}
        </div>
      ) : (
        <div
          className="flex shrink-0 bg-white"
          style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
        >
          {summaryMetrics.map((m, i) => {
            const inner = (
              <>
                <span
                  className="text-[9px] font-semibold tracking-widest uppercase"
                  style={{ color: BRAND.textMuted }}
                >
                  {m.label}
                </span>
                <span
                  className="text-[20px] leading-tight font-semibold"
                  style={{ color: m.alert ? BRAND.danger : BRAND.textPrimary }}
                >
                  {m.value}
                </span>
              </>
            )
            const sharedStyle = {
              borderLeft: i > 0 ? `1px solid ${BRAND.borderSubtle}` : undefined,
            }
            const sharedClass =
              'flex flex-1 flex-col justify-center px-5 py-3 text-left transition-colors hover:bg-surface-hover'
            return (
              <Link key={m.label} to={m.path as '/'} className={sharedClass} style={sharedStyle}>
                {inner}
              </Link>
            )
          })}
        </div>
      )}

      {/* Body grid */}
      <div className="grid flex-1 grid-cols-3 gap-4 p-4">
        {/* My Work table */}
        <div
          className="col-span-2 overflow-hidden rounded bg-white"
          style={{ border: `1px solid ${BRAND.borderSubtle}` }}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
          >
            <p className="text-[12px] font-semibold" style={{ color: BRAND.textPrimary }}>
              My Work
            </p>
            <span
              className="rounded-sm px-1.5 py-px text-[10px] font-semibold"
              style={{ backgroundColor: BRAND.primaryLighter, color: BRAND.primaryLight }}
            >
              {myItems.length} items
            </span>
          </div>

          {/* Table header */}
          <div
            className="flex h-7 items-center gap-2 px-3 select-none"
            style={{
              backgroundColor: BRAND.surfaceHover,
              borderBottom: `1px solid ${BRAND.borderSubtle}`,
            }}
          >
            {(
              [
                ['w-[60px] shrink-0', 'ID'],
                ['w-14 shrink-0', 'Type'],
                ['flex-1 min-w-0 pr-2', 'Name'],
                ['w-24 shrink-0', 'Project'],
                ['w-24 shrink-0', 'Status'],
                ['w-[80px] shrink-0', 'Priority'],
              ] as [string, string][]
            ).map(([cls, label]) => (
              <div
                key={label}
                className={`${cls} text-[9px] font-semibold tracking-widest uppercase`}
                style={{ color: BRAND.textMuted }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Rows */}
          {myItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Inbox size={28} style={{ color: BRAND.textMuted }} className="mb-2" />
              <p className="text-[12px]" style={{ color: BRAND.textSecondary }}>
                No items assigned to you
              </p>
            </div>
          ) : (
            myItems.map((item) => {
              return (
                <div
                  key={item.id}
                  className="flex h-8 items-center gap-2 px-3 hover:bg-surface-hover"
                  style={{ borderBottom: `1px solid ${BRAND.borderInner}` }}
                >
                  <div
                    className="w-[60px] shrink-0 font-mono text-[10px]"
                    style={{ color: BRAND.textSecondary }}
                  >
                    {item.itemKey}
                  </div>
                  <div className="w-14 shrink-0">
                    <TypeBadge type={toWiType(item.type)} />
                  </div>
                  <div className="min-w-0 flex-1 pr-2">
                    <span
                      className="block truncate text-[12px] font-medium"
                      style={{ color: BRAND.textPrimary }}
                    >
                      {item.title}
                    </span>
                  </div>
                  <div
                    className="w-24 shrink-0 font-mono text-[10px]"
                    style={{ color: BRAND.textSecondary }}
                  >
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

        {/* Activity feed — empty state (audit log integration is out of scope) */}
        <div
          className="overflow-hidden rounded bg-white"
          style={{ border: `1px solid ${BRAND.borderSubtle}` }}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
          >
            <p className="text-[12px] font-semibold" style={{ color: BRAND.textPrimary }}>
              Recent Activity
            </p>
            <Link
              to={'/notifications' as '/'}
              className="flex items-center gap-1 text-[11px]"
              style={{ color: BRAND.primaryLight }}
            >
              All <ArrowUpRight size={11} />
            </Link>
          </div>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock size={28} style={{ color: BRAND.textMuted }} className="mb-2" />
            <p className="text-[12px]" style={{ color: BRAND.textSecondary }}>
              Activity feed coming soon
            </p>
            <p className="mt-1 text-[11px]" style={{ color: BRAND.textMuted }}>
              Work item updates will appear here
            </p>
          </div>
        </div>

        {/* Project Health table */}
        <div
          className="col-span-3 overflow-hidden rounded bg-white"
          style={{ border: `1px solid ${BRAND.borderSubtle}` }}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
          >
            <p className="text-[12px] font-semibold" style={{ color: BRAND.textPrimary }}>
              Project Health
            </p>
            {selectedProject && (
              <span className="text-[10px] font-semibold" style={{ color: BRAND.primaryLight }}>
                {selectedProject.projectKey} selected
              </span>
            )}
          </div>
          {/* Table header */}
          <div
            className="flex h-7 items-center gap-3 px-4 select-none"
            style={{
              backgroundColor: BRAND.surfaceHover,
              borderBottom: `1px solid ${BRAND.borderSubtle}`,
            }}
          >
            {(
              [
                ['w-14 shrink-0', 'Key'],
                ['flex-1 min-w-0', 'Project Name'],
                ['w-32 shrink-0', 'Active Sprint'],
                ['w-36 shrink-0', 'Progress'],
                ['w-24 shrink-0', 'Open Defects'],
                ['w-24 shrink-0', 'Blocked'],
                ['w-32 shrink-0', 'Owner'],
              ] as [string, string][]
            ).map(([cls, label]) => (
              <div
                key={label}
                className={`${cls} text-[9px] font-semibold tracking-widest uppercase`}
                style={{ color: BRAND.textMuted }}
              >
                {label}
              </div>
            ))}
          </div>
          {/* Rows */}
          {activeProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <p className="text-[12px]" style={{ color: BRAND.textSecondary }}>
                No active projects
              </p>
            </div>
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
