import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowUpRight, Clock, Inbox } from 'lucide-react'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { EMPTY_VALUE, formatWith } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'
import { PageHeader } from '@/shared/ui/page-header'
import { EmptyState } from '@/shared/ui/empty-state'
import { LoadErrorState } from '@/shared/ui/load-error-state'
import { listResource, valueResource } from '@/shared/lib/query/resource'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { KeyChip } from '@/shared/ui/key-chip'
import {
  PanelTable,
  PanelTableCell,
  PanelTableRow,
  type PanelTableColumn,
} from '@/shared/ui/table/panel-table'
import { PriorityBadge } from '@/entities/work-item/ui/badges'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import {
  WorkItemType,
  WorkItemPriority,
  type ScheduleState,
} from '@/entities/work-item/model/types'
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
/**
 * The Project Health columns, declared once and shared by the header and the rows.
 *
 * `projectName` is the flexible one — every other column states a fixed width, so a long project
 * name yields instead of squeezing the rest until their headings wrap. `OPEN DEFECTS` and `ACTIVE
 * SPRINT` are the two that were breaking across two lines; they are also the two whose headings are
 * longer than their content, which is why they now carry a width chosen for the LABEL.
 */
function healthColumns(t: TFunction): PanelTableColumn[] {
  return [
    { key: 'key', label: t('projectHealth.columns.key'), width: 112 },
    { key: 'projectName', label: t('projectHealth.columns.projectName') },
    { key: 'activeSprint', label: t('projectHealth.columns.activeSprint'), width: 148 },
    { key: 'progress', label: t('projectHealth.columns.progress'), width: 144 },
    { key: 'openDefects', label: t('projectHealth.columns.openDefects'), width: 116 },
    { key: 'blocked', label: t('projectHealth.columns.blocked'), width: 96 },
    { key: 'owner', label: t('common:owner'), width: 160 },
  ]
}

function ProjectHealthRow({
  row,
  isSelected,
  columns,
}: {
  row: ProjectHealth
  isSelected: boolean
  columns: PanelTableColumn[]
}) {
  const { t } = useTranslation('home')
  const progressColor =
    row.progressPercent >= 70
      ? BRAND.success
      : row.progressPercent >= 40
        ? BRAND.primaryLight
        : BRAND.warning
  const [key, name, sprint, progress, defects, blocked, owner] = columns

  return (
    <PanelTableRow style={{ backgroundColor: isSelected ? BRAND.primaryLighter : undefined }}>
      <PanelTableCell column={key}>
        <KeyChip>{row.key}</KeyChip>
      </PanelTableCell>
      <PanelTableCell column={name}>
        <span className="block truncate text-ui-md font-medium text-foreground">{row.name}</span>
      </PanelTableCell>
      <PanelTableCell column={sprint} className="text-ui-sm text-muted-foreground">
        {row.activeSprintName ?? (
          <span className="text-foreground-subtle">{t('projectHealth.noActiveSprint')}</span>
        )}
      </PanelTableCell>
      <PanelTableCell column={progress} className="gap-2">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border-subtle">
          <div
            className="h-full rounded-full"
            style={{ width: `${row.progressPercent}%`, backgroundColor: progressColor }}
          />
        </div>
        <span className="text-ui-xs font-semibold text-muted-foreground tabular-nums">
          {row.progressPercent}%
        </span>
      </PanelTableCell>
      <PanelTableCell column={defects}>
        <span
          className="text-ui-md font-semibold tabular-nums"
          style={{ color: row.openDefects > 0 ? BRAND.danger : BRAND.success }}
        >
          {row.openDefects}
        </span>
        <span className="ml-1 text-ui-xs text-foreground-subtle">
          {t('projectHealth.defect', { count: row.openDefects })}
        </span>
      </PanelTableCell>
      <PanelTableCell column={blocked}>
        {row.blockedCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-ui-xs font-semibold text-destructive">
            <AlertTriangle size={11} />
            {t('projectHealth.blockedCount', { count: row.blockedCount })}
          </span>
        ) : (
          <span className="text-ui-xs text-success">{t('projectHealth.none')}</span>
        )}
      </PanelTableCell>
      <PanelTableCell column={owner}>
        <OwnerCell name={row.leadName} />
      </PanelTableCell>
    </PanelTableRow>
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
      formatWith(new Date().toISOString(), {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    [],
  )

  // ── Data fetching — one bounded/aggregate request per widget (no fan-out) ────
  /**
   * Every widget on this page is a resource, because every one of them was a verdict drawn from
   * `?? 0` / `?? []`.
   *
   * The summary strip is the worst of them: six large numbers, and `summary?.activeProjects ?? 0`
   * reads as *"this workspace has no active projects"* for a request that failed. It is also the
   * first screen after login, so a cold-start failure was reported as an empty workspace. `--` is
   * this app's own placeholder for an absent number (`EMPTY_VALUE`); `0` is a measurement.
   */
  const summaryQuery = useWorkspaceSummary(enabled)
  const summaryResource = valueResource(summaryQuery)
  const summary = summaryResource.value
  const loadingSummary = summaryResource.isLoading
  const myWorkQuery = useMyWork(MY_WORK_LIMIT, enabled)
  const myWorkFeed = listResource(myWorkQuery)
  const activityQuery = useNotifications({ limit: ACTIVITY_LIMIT })
  const activityFeed = listResource(activityQuery)
  const healthQuery = useProjectHealth(PROJECT_HEALTH_LIMIT, enabled)
  const healthFeed = listResource(healthQuery)
  const myItems = myWorkFeed.rows
  const activity = activityFeed.rows
  const health = healthFeed.rows
  const openNotification = useOpenNotification()

  /**
   * Column widths for the two panel tables, stated ONCE each and shared by the header and the rows.
   *
   * Both tables previously wrote their widths twice — once as Tailwind classes in a header array and
   * again on every body cell — so a header and its column could disagree, and did. `useMemo` only
   * because these are arrays passed as props; the labels are translated, so they follow `t`.
   */
  const myWorkCols = useMemo<PanelTableColumn[]>(
    () => [
      { key: 'id', label: t('myWork.columns.id'), width: 120 },
      { key: 'name', label: t('common:name') },
      { key: 'project', label: t('myWork.columns.project'), width: 96 },
      { key: 'status', label: t('common:status'), width: 128 },
      { key: 'priority', label: t('myWork.columns.priority'), width: 80 },
    ],
    [t],
  )
  const healthCols = useMemo(() => healthColumns(t), [t])

  /** `--` for an absent number, never `0` — the app-wide rule, and here it is load-bearing. */
  const metric = (value: number | undefined) => (value === undefined ? EMPTY_VALUE : value)
  const summaryMetrics = [
    {
      label: t('metrics.activeProjects'),
      value: metric(summary?.activeProjects),
      path: '/projects',
    },
    { label: t('metrics.openWorkItems'), value: metric(summary?.openWorkItems), path: '/backlog' },
    {
      label: t('metrics.activeSprints'),
      value: metric(summary?.activeSprints),
      path: '/timeboxes',
    },
    {
      label: t('metrics.blockedItems'),
      value: metric(summary?.blockedItems),
      path: '/backlog',
      alert: true,
    },
    {
      label: t('metrics.openDefects'),
      value: metric(summary?.openDefects),
      path: '/quality',
      alert: true,
    },
    { label: t('metrics.assignedToMe'), value: metric(summary?.assignedToMe), path: '/backlog' },
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
      {/*
        The strip stays MOUNTED in every phase — the BA's structure-preserving rule, and the reason
        the six values cannot be coerced: `?? 0` here would read as "this workspace has no active
        projects" for a request that never answered. `metric()` renders `--` instead. On a FAILURE the
        strip and a stated error go together (the `ReportSurface` rule in CLAUDE.md), because six
        silent `--` is indistinguishable from a workspace that genuinely holds nothing.

        What the numbers COUNT is now the caller's readable scope, not the workspace:
        `GET /v1/work-items/summary` is scoped by `AccessService.listReadableProjectIds`. It was not,
        which is the "Unassigned metadata leak" half of GAP-P4-RBAC-003 (AC4) — a user whose access to
        a project had been removed still read that project's aggregate counts here.
      */}
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
              <span className="text-ui-xs font-semibold tracking-widest text-foreground-subtle uppercase">
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
      {summaryResource.isError ? (
        <p
          role="alert"
          className="shrink-0 border-b border-border-subtle bg-card px-5 py-1.5 text-ui-xs text-destructive"
        >
          {t('common:loadFailed')}
        </p>
      ) : null}

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

          <PanelTable columns={myWorkCols} gapClassName="gap-2" padClassName="px-3">
            {myWorkFeed.phase === 'error' ? (
              <LoadErrorState error={myWorkFeed.error} size="sm" />
            ) : myWorkFeed.phase === 'empty' ? (
              <EmptyState
                size="sm"
                icon={<Inbox size={28} className="text-foreground-subtle" />}
                title={t('myWork.empty')}
              />
            ) : (
              myItems.map((item) => (
                <PanelTableRow key={item.id} gapClassName="gap-2" padClassName="px-3">
                  <PanelTableCell column={myWorkCols[0]}>
                    <IdCell
                      type={toWiType(item.type)}
                      itemKey={item.itemKey}
                      onOpen={() =>
                        navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
                      }
                    />
                  </PanelTableCell>
                  <PanelTableCell column={myWorkCols[1]} className="pr-2">
                    <span className="block text-ui-md font-medium break-words whitespace-normal text-foreground">
                      {item.title}
                    </span>
                  </PanelTableCell>
                  <PanelTableCell
                    column={myWorkCols[2]}
                    className="font-mono text-ui-xs text-muted-foreground"
                  >
                    {item.projectKey}
                  </PanelTableCell>
                  <PanelTableCell column={myWorkCols[3]}>
                    <StateStepper
                      steps={SCHEDULE_STATE_STEPS}
                      value={item.scheduleState as ScheduleState}
                      canEdit={false}
                      ariaLabel="Schedule state"
                    />
                  </PanelTableCell>
                  <PanelTableCell column={myWorkCols[4]}>
                    <PriorityBadge priority={toPriority(item.priority)} />
                  </PanelTableCell>
                </PanelTableRow>
              ))
            )}
          </PanelTable>
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
          {activityFeed.phase === 'error' ? (
            <LoadErrorState error={activityFeed.error} size="sm" />
          ) : activityFeed.phase === 'empty' ? (
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
          <PanelTable columns={healthCols}>
            {healthFeed.phase === 'error' ? (
              <LoadErrorState error={healthFeed.error} size="sm" />
            ) : healthFeed.phase === 'empty' ? (
              <EmptyState size="sm" title={t('projectHealth.empty')} />
            ) : (
              health.map((row) => (
                <ProjectHealthRow
                  key={row.id}
                  row={row}
                  columns={healthCols}
                  isSelected={selectedProject?.projectId === row.id}
                />
              ))
            )}
          </PanelTable>
        </div>
      </div>
    </div>
  )
}
