import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowUpRight, Clock, Inbox } from 'lucide-react'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { BRAND } from '@/shared/config/brand'
import { PageHeader } from '@/shared/ui/page-header'
import { EmptyState } from '@/shared/ui/empty-state'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { KeyChip } from '@/shared/ui/key-chip'
import { PriorityBadge } from '@/entities/work-item/ui/badges'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import { WorkItemType, WorkItemPriority, type ScheduleState } from '@/entities/work-item/model/types'
import {
  useWorkspaceSummary,
  useMyWork,
  useProjectHealth,
  type ProjectHealth,
} from '@/features/home/api'
import { useNotifications } from '@/features/notifications/api'
import { NotificationItem } from '@/features/notifications/ui/notification-item'
import { useOpenNotification } from '@/features/notifications/use-open-notification'

// Home widgets are bounded (server-side top-N); "View all" deep-links to the
// full paginated list page for depth.
const MY_WORK_LIMIT = 10
// Recent Activity is a compact side widget (each item is multi-line) — keep it a
// short glance; the full feed lives behind "View all".
const ACTIVITY_LIMIT = 5
const PROJECT_HEALTH_LIMIT = 10

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
// Pure presentational — the rollup is computed server-side (one bounded query),
// so this row fires NO per-project requests.
function ProjectHealthRow({ row, isSelected }: { row: ProjectHealth; isSelected: boolean }) {
  const { t } = useTranslation('home')
  const progressColor =
    row.progressPercent >= 70
      ? BRAND.success
      : row.progressPercent >= 40
        ? BRAND.primaryLight
        : BRAND.warning

  return (
    <div
      className="flex h-9 items-center gap-3 border-b border-border-inner px-4 transition-colors hover:bg-surface-hover"
      style={{ backgroundColor: isSelected ? BRAND.primaryLighter : undefined }}
    >
      <div className="w-28 shrink-0">
        <KeyChip>{row.key}</KeyChip>
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-ui-md font-medium text-foreground">{row.name}</span>
      </div>
      <div className="w-32 shrink-0 text-ui-sm text-muted-foreground">
        {row.activeSprintName ?? (
          <span className="text-foreground-subtle">{t('projectHealth.noActiveSprint')}</span>
        )}
      </div>
      <div className="flex w-36 shrink-0 items-center gap-2">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border-subtle">
          <div
            className="h-full rounded-full"
            style={{ width: `${row.progressPercent}%`, backgroundColor: progressColor }}
          />
        </div>
        <span className="text-ui-xs font-semibold text-muted-foreground tabular-nums">
          {row.progressPercent}%
        </span>
      </div>
      <div className="w-24 shrink-0">
        <span
          className="text-ui-md font-semibold tabular-nums"
          style={{ color: row.openDefects > 0 ? BRAND.danger : BRAND.success }}
        >
          {row.openDefects}
        </span>
        <span className="ml-1 text-ui-xs text-foreground-subtle">
          {t('projectHealth.defect', { count: row.openDefects })}
        </span>
      </div>
      <div className="w-24 shrink-0">
        {row.blockedCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-ui-xs font-semibold text-destructive">
            <AlertTriangle size={11} />
            {t('projectHealth.blockedCount', { count: row.blockedCount })}
          </span>
        ) : (
          <span className="text-ui-xs text-success">{t('projectHealth.none')}</span>
        )}
      </div>
      <div className="flex w-32 shrink-0 items-center">
        <OwnerCell name={row.leadName} />
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function HomePage() {
  const { t } = useTranslation('home')
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { workspace, project: selectedProject } = useAppContext()
  const enabled = !!workspace?.workspaceId

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

  // ── Data fetching — one bounded/aggregate request per widget (no fan-out) ────
  const { data: summary, isLoading: loadingSummary } = useWorkspaceSummary(enabled)
  const { data: myItems = [] } = useMyWork(MY_WORK_LIMIT, enabled)
  const { data: activity = [] } = useNotifications({ limit: ACTIVITY_LIMIT })
  const { data: health = [], isLoading: loadingHealth } = useProjectHealth(
    PROJECT_HEALTH_LIMIT,
    enabled,
  )
  const openNotification = useOpenNotification()

  const summaryMetrics = [
    { label: t('metrics.activeProjects'), value: summary?.activeProjects ?? 0, path: '/projects' },
    { label: t('metrics.openWorkItems'), value: summary?.openWorkItems ?? 0, path: '/backlog' },
    { label: t('metrics.activeSprints'), value: summary?.activeSprints ?? 0, path: '/timeboxes' },
    {
      label: t('metrics.blockedItems'),
      value: summary?.blockedItems ?? 0,
      path: '/backlog',
      alert: true,
    },
    { label: t('metrics.openDefects'), value: summary?.openDefects ?? 0, path: '/quality', alert: true },
    { label: t('metrics.assignedToMe'), value: summary?.assignedToMe ?? 0, path: '/backlog' },
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
      {loadingSummary ? (
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
          {summaryMetrics.map((m, i) => (
            <Link
              key={m.label}
              to={m.path as '/'}
              className={`flex flex-1 flex-col justify-center px-5 py-3 text-left transition-colors hover:bg-surface-hover ${i > 0 ? 'border-l border-border-subtle' : ''}`}
            >
              <span className="text-ui-2xs font-semibold tracking-widest text-foreground-subtle uppercase">
                {m.label}
              </span>
              <span
                className="text-xl leading-tight font-semibold"
                style={{ color: m.alert ? BRAND.danger : BRAND.textPrimary }}
              >
                {m.value}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Body grid */}
      <div className="grid flex-1 grid-cols-3 gap-4 p-4">
        {/* My Work table */}
        <div className="col-span-2 overflow-hidden rounded border border-border-subtle bg-card">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <p className="text-ui-md font-semibold text-foreground">{t('myWork.title')}</p>
            <Link
              to={'/backlog' as '/'}
              className="flex items-center gap-1 text-ui-sm text-primary-light"
            >
              {t('activity.all')} <ArrowUpRight size={11} />
            </Link>
          </div>

          {/* Table header */}
          <div className="flex h-7 items-center gap-2 border-b border-border-subtle bg-surface-hover px-3 select-none">
            {(
              [
                ['w-[120px] shrink-0', t('myWork.columns.id')],
                ['flex-1 min-w-0 pr-2', t('common:name')],
                ['w-24 shrink-0', t('myWork.columns.project')],
                ['w-32 shrink-0', t('common:status')],
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
            myItems.map((item) => (
              <div
                key={item.id}
                className="flex h-8 items-center gap-2 border-b border-border-inner px-3 hover:bg-surface-hover"
              >
                <div className="w-[120px] shrink-0">
                  <IdCell
                    type={toWiType(item.type)}
                    itemKey={item.itemKey}
                    onOpen={() =>
                      navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
                    }
                  />
                </div>
                <div className="min-w-0 flex-1 pr-2">
                  <span className="block truncate text-ui-md font-medium text-foreground">
                    {item.title}
                  </span>
                </div>
                <div className="w-24 shrink-0 font-mono text-ui-xs text-muted-foreground">
                  {item.projectKey}
                </div>
                <div className="w-32 shrink-0">
                  <StateStepper
                    steps={SCHEDULE_STATE_STEPS}
                    value={item.scheduleState as ScheduleState}
                    canEdit={false}
                    ariaLabel="Schedule state"
                  />
                </div>
                <div className="w-[80px] shrink-0">
                  <PriorityBadge priority={toPriority(item.priority)} />
                </div>
              </div>
            ))
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
              {activity.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  dense
                  onActivate={() => openNotification(n)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Project Health table */}
        <div className="col-span-3 overflow-hidden rounded border border-border-subtle bg-card">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
            <p className="text-ui-md font-semibold text-foreground">{t('projectHealth.title')}</p>
            <Link
              to={'/projects' as '/'}
              className="flex items-center gap-1 text-ui-sm text-primary-light"
            >
              {t('activity.all')} <ArrowUpRight size={11} />
            </Link>
          </div>
          {/* Table header */}
          <div className="flex h-7 items-center gap-3 border-b border-border-subtle bg-surface-hover px-4 select-none">
            {(
              [
                ['w-28 shrink-0', t('projectHealth.columns.key')],
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
          {!loadingHealth && health.length === 0 ? (
            <EmptyState size="sm" title={t('projectHealth.empty')} />
          ) : (
            health.map((row) => (
              <ProjectHealthRow
                key={row.id}
                row={row}
                isSelected={selectedProject?.projectId === row.id}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
