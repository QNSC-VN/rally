/**
 * Reports — a read-only analytics dashboard for the current project scope.
 *
 * Every widget is backed by a REAL read-model (no mock data): the reporting
 * module (`/v1/reports` burndown + velocity), the iteration status read-model
 * (`/v1/iterations/:id/status` — status mix, workload, blocked, sprint KPIs)
 * and the releases read-model (release progress). Charts use recharts, matching
 * the rest of the app. Selection reuses the shared IterationPicker + the same
 * last-viewed persistence as Team Board / Iteration Status.
 */
import { useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { AlertTriangle, Download } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'

import { BRAND } from '@/shared/config/brand'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useProjectMembers } from '@/features/teams/api'
import { useIterations } from '@/features/iterations/api'
import { useIterationStatus } from '@/features/iterations/api'
import { useReleases } from '@/features/releases/api'
import { useSprintBurndown, useProjectVelocity } from '@/features/reporting/api'
import { useDefects } from '@/features/quality/api'
import { useNotifications } from '@/features/notifications/api'
import { relativeTime } from '@/shared/lib/utils'
import { MetricCard } from '@/shared/ui/metric-card'
import { Avatar } from '@/shared/ui/avatar'
import { IterationPicker } from '@/shared/ui/iteration-picker'
import { PageHeader } from '@/shared/ui/page-header'
import { SkeletonList } from '@/shared/ui/skeleton'
import {
  SCHEDULE_STATE_CONFIG,
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  ScheduleState,
  getSimplifiedState,
} from '@/entities/work-item/model/types'

const TOOLTIP_STYLE = {
  fontSize: 11,
  border: `1px solid ${BRAND.border}`,
  borderRadius: 3,
} as const

const EMPTY_ITEMS: NonNullable<ReturnType<typeof useIterationStatus>['data']>['items'] = []

function Widget({
  title,
  span = 1,
  children,
}: {
  title: string
  span?: number
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded p-4"
      style={{
        backgroundColor: BRAND.surface,
        border: `1px solid ${BRAND.border}`,
        gridColumn: `span ${span}`,
      }}
    >
      <p className="mb-3 text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
        {title}
      </p>
      {children}
    </div>
  )
}

export function ReportsPage() {
  const navigate = useNavigate()
  const { project, team } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canExport = can('work_item:edit')

  const { data: iterations = [] } = useIterations(projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const memberMap = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])

  const [chosenId, setChosenId] = useState<string | null>(null)
  const persistedId = projectId
    ? localStorage.getItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`)
    : null
  const selectedId =
    chosenId && iterations.some((i) => i.id === chosenId)
      ? chosenId
      : persistedId && iterations.some((i) => i.id === persistedId)
        ? persistedId
        : (iterations[0]?.id ?? null)

  function setSelectedId(id: string) {
    setChosenId(id)
    if (projectId) localStorage.setItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`, id)
  }

  const selected = iterations.find((i) => i.id === selectedId)
  const { data: status, isLoading: statusLoading } = useIterationStatus(selectedId ?? undefined)
  const { data: burndown, isLoading: burndownLoading } = useSprintBurndown(selectedId ?? undefined)
  const { data: velocity, isLoading: velocityLoading } = useProjectVelocity(projectId, 6)
  const { data: releases = [] } = useReleases(projectId)
  const { data: defects } = useDefects(projectId)
  const { data: notifications = [] } = useNotifications({})

  const items = status?.items ?? EMPTY_ITEMS
  const metrics = status?.metrics

  // ── Burndown: actual remaining + a deterministic ideal reference line ──────
  const burndownData = useMemo(() => {
    const points = burndown?.points ?? []
    if (points.length === 0) return []
    const start = points[0]?.remainingPoints ?? 0
    const last = points.length - 1
    return points.map((p, i) => ({
      date: (p.date ?? '').slice(5),
      remaining: p.remainingPoints ?? 0,
      ideal: last > 0 ? Math.max(0, Math.round(start * (1 - i / last))) : start,
    }))
  }, [burndown])

  // ── Velocity: completed per sprint, with planned overlaid from the iteration
  //    plan (matched by sprint id). Also feeds Planned vs Completed. ──────────
  const velocityData = useMemo(() => {
    const iterById = new Map(iterations.map((it) => [it.id, it]))
    return (velocity?.sprints ?? []).map((s) => ({
      sprint: s.sprintName ?? '—',
      accepted: s.completedPoints ?? 0,
      planned: (s.sprintId && iterById.get(s.sprintId)?.plannedVelocity) || 0,
    }))
  }, [velocity, iterations])

  // ── Status distribution across the selected iteration ─────────────────────
  const statusPie = useMemo(() => {
    const counts = new Map<ScheduleState, number>()
    for (const it of items) {
      const s = it.scheduleState as ScheduleState
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    return SCHEDULE_STATE_VALUES.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
      name: SCHEDULE_STATE_LABEL[s],
      value: counts.get(s) ?? 0,
      color: SCHEDULE_STATE_CONFIG[s].color,
    }))
  }, [items])

  // ── Workload by owner (points, split by simplified state) ─────────────────
  const workloadData = useMemo(() => {
    const byOwner = new Map<
      string,
      { owner: string; define: number; in_progress: number; complete: number }
    >()
    for (const it of items) {
      const name = it.assigneeId
        ? (memberMap.get(it.assigneeId)?.displayName ??
          memberMap.get(it.assigneeId)?.email ??
          'Unknown')
        : 'Unassigned'
      const row = byOwner.get(name) ?? { owner: name, define: 0, in_progress: 0, complete: 0 }
      row[getSimplifiedState(it.scheduleState as ScheduleState)] += it.planEstimate ?? 0
      byOwner.set(name, row)
    }
    return [...byOwner.values()].sort(
      (a, b) => b.define + b.in_progress + b.complete - (a.define + a.in_progress + a.complete),
    )
  }, [items, memberMap])

  const blockedItems = useMemo(() => items.filter((i) => i.isBlocked), [items])

  // ── Defect summary (real defect read-model for this project) ──────────────
  const defectRows = useMemo(() => {
    const m = defects?.metrics
    return [
      { label: 'Open', value: m?.openDefects ?? 0, color: BRAND.warning },
      { label: 'Critical', value: m?.critical ?? 0, color: BRAND.danger },
      { label: 'In Progress', value: m?.inProgress ?? 0, color: BRAND.primaryLight },
      { label: 'Resolved', value: m?.verifiedAccepted ?? 0, color: BRAND.success },
      { label: 'Blockers', value: m?.blockers ?? 0, color: BRAND.danger },
    ]
  }, [defects])

  function exportCsv() {
    const lines: string[] = []
    lines.push('Section,Key,Value1,Value2')
    for (const p of burndown?.points ?? []) {
      lines.push(`Burndown,${p.date ?? ''},${p.remainingPoints ?? 0},${p.completedPoints ?? 0}`)
    }
    for (const s of velocity?.sprints ?? []) {
      lines.push(
        `Velocity,${s.sprintName ?? ''},${s.completedPoints ?? 0},${s.completedItems ?? 0}`,
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${selected?.name ?? 'project'}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Report exported')
  }

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: BRAND.textMuted }}>
        <p className="text-sm">Select a project to view its reports.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto" style={{ backgroundColor: BRAND.pageBg }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title="Reports"
        subtitle={`${project.projectName}${team ? ` · ${team.teamName}` : ''} · Last 6 iterations`}
        actions={
          <>
            <IterationPicker
              iterations={iterations}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            {canExport && (
              <button
                type="button"
                onClick={exportCsv}
                className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: BRAND.primary }}
              >
                <Download size={12} /> Export
              </button>
            )}
          </>
        }
      />

      {statusLoading ? (
        <div className="p-4">
          <SkeletonList rows={6} cols={3} />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 p-4">
          {/* Sprint progress strip */}
          <Widget
            title={`Current Iteration Progress${selected ? ` — ${selected.name}` : ''}`}
            span={3}
          >
            <div className="flex gap-6">
              <MetricCard
                label="Committed"
                value={metrics?.totalPlanEstimate ?? 0}
                caption="pts"
                minWidth={100}
              />
              <MetricCard
                label="Accepted"
                value={metrics?.acceptedPoints ?? 0}
                valueColor={BRAND.success}
                caption="pts"
                minWidth={100}
              />
              <MetricCard
                label="Remaining"
                value={Math.max(
                  0,
                  (metrics?.totalPlanEstimate ?? 0) - (metrics?.acceptedPoints ?? 0),
                )}
                valueColor={BRAND.warning}
                caption="pts"
                minWidth={100}
              />
              <MetricCard
                label="Days Left"
                value={metrics?.daysLeft ?? '—'}
                valueColor={
                  metrics?.daysLeft != null && metrics.daysLeft <= 2 ? BRAND.danger : undefined
                }
                minWidth={90}
              />
              <MetricCard
                label="Completion"
                value={`${metrics?.acceptedPercent ?? 0}%`}
                valueColor={BRAND.primaryLight}
                progressPct={metrics?.acceptedPercent ?? 0}
                minWidth={120}
              />
            </div>
          </Widget>

          {/* Burndown */}
          <Widget title="Iteration Burndown" span={2}>
            {burndownLoading ? (
              <ChartSkeleton />
            ) : burndownData.length === 0 ? (
              <EmptyChart label="No burndown data for this iteration." />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={burndownData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BRAND.pageBg} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: BRAND.textMuted }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: BRAND.textMuted }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="ideal"
                    stroke={BRAND.textFaint}
                    fill="none"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    dot={false}
                    name="Ideal"
                  />
                  <Area
                    type="monotone"
                    dataKey="remaining"
                    stroke={BRAND.primary}
                    fill="rgba(29,63,115,0.08)"
                    strokeWidth={2}
                    dot={{ r: 2, fill: BRAND.primary }}
                    name="Remaining"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Widget>

          {/* Velocity */}
          <Widget title="Velocity">
            {velocityLoading ? (
              <ChartSkeleton />
            ) : velocityData.length === 0 ? (
              <EmptyChart label="No completed iterations yet." />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={velocityData} barGap={3}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BRAND.pageBg} vertical={false} />
                  <XAxis
                    dataKey="sprint"
                    tick={{ fontSize: 9, fill: BRAND.textMuted }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: BRAND.textMuted }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar
                    dataKey="planned"
                    fill={BRAND.borderSubtle}
                    radius={[2, 2, 0, 0]}
                    name="Planned"
                  />
                  <Bar
                    dataKey="accepted"
                    fill={BRAND.primary}
                    radius={[2, 2, 0, 0]}
                    name="Accepted"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Widget>

          {/* Status distribution */}
          <Widget title="Status Distribution">
            {statusPie.length === 0 ? (
              <EmptyChart label="No items in this iteration." />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={statusPie}
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={66}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {statusPie.map((e) => (
                        <Cell key={e.name} fill={e.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  {statusPie.map((s) => (
                    <span
                      key={s.name}
                      className="flex items-center gap-1 text-[10px]"
                      style={{ color: BRAND.textSecondary }}
                    >
                      <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                      {s.name}{' '}
                      <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
                        {s.value}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </Widget>

          {/* Defect summary */}
          <Widget title="Defect Summary">
            <div className="space-y-2.5 pt-1">
              {defectRows.map((d) => (
                <div key={d.label} className="flex items-center justify-between">
                  <span
                    className="flex items-center gap-2 text-[12px]"
                    style={{ color: BRAND.textSecondary }}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: d.color }}
                    />
                    {d.label}
                  </span>
                  <span
                    className="text-[13px] font-semibold tabular-nums"
                    style={{ color: d.color }}
                  >
                    {d.value}
                  </span>
                </div>
              ))}
            </div>
          </Widget>

          {/* Workload by owner */}
          <Widget title="Workload by Owner">
            {workloadData.length === 0 ? (
              <EmptyChart label="No assigned work." />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={workloadData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={BRAND.pageBg} vertical={false} />
                    <XAxis
                      dataKey="owner"
                      tick={{ fontSize: 9, fill: BRAND.textMuted }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: BRAND.textMuted }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="define" stackId="w" fill={BRAND.accentBorder} name="Define" />
                    <Bar
                      dataKey="in_progress"
                      stackId="w"
                      fill={BRAND.warning}
                      name="In Progress"
                    />
                    <Bar
                      dataKey="complete"
                      stackId="w"
                      fill={BRAND.primary}
                      radius={[2, 2, 0, 0]}
                      name="Complete"
                    />
                  </BarChart>
                </ResponsiveContainer>
                <div
                  className="mt-1 flex items-center justify-center gap-4 text-[10px]"
                  style={{ color: BRAND.textSecondary }}
                >
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2.5 rounded-sm"
                      style={{ backgroundColor: BRAND.accentBorder }}
                    />{' '}
                    Define
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2.5 rounded-sm"
                      style={{ backgroundColor: BRAND.warning }}
                    />{' '}
                    In Progress
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2.5 rounded-sm"
                      style={{ backgroundColor: BRAND.primary }}
                    />{' '}
                    Complete
                  </span>
                </div>
              </>
            )}
          </Widget>

          {/* Planned vs Completed */}
          <Widget title="Planned vs Completed" span={2}>
            {velocityData.length === 0 ? (
              <EmptyChart label="No iteration history yet." />
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={velocityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BRAND.pageBg} />
                  <XAxis
                    dataKey="sprint"
                    tick={{ fontSize: 9, fill: BRAND.textMuted }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: BRAND.textMuted }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="planned"
                    stroke={BRAND.textFaint}
                    fill="rgba(176,184,200,0.15)"
                    strokeWidth={1.5}
                    dot={false}
                    name="Planned"
                  />
                  <Area
                    type="monotone"
                    dataKey="accepted"
                    stroke={BRAND.primary}
                    fill="rgba(29,63,115,0.12)"
                    strokeWidth={2}
                    dot={false}
                    name="Completed"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Widget>

          {/* Release progress */}
          <Widget title="Release Progress">
            <div className="space-y-3 pt-1">
              {releases.length === 0 ? (
                <p className="text-[11px]" style={{ color: BRAND.textMuted }}>
                  No releases in this project.
                </p>
              ) : (
                releases.slice(0, 4).map((r) => {
                  const pct = r.taskRollup?.progressPercent ?? 0
                  const barColor =
                    pct >= 100 ? BRAND.success : pct > 50 ? BRAND.primaryLight : BRAND.warning
                  return (
                    <div key={r.id}>
                      <div className="mb-1 flex items-center justify-between">
                        <span
                          className="truncate pr-2 text-[10px]"
                          style={{ color: BRAND.textSecondary }}
                        >
                          {r.name}
                        </span>
                        <span
                          className="text-[10px] font-semibold tabular-nums"
                          style={{ color: BRAND.textSecondary }}
                        >
                          {pct}%
                        </span>
                      </div>
                      <div
                        className="h-1.5 overflow-hidden rounded-full"
                        style={{ backgroundColor: BRAND.borderSubtle }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: barColor }}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Widget>

          {/* Blocked items */}
          <Widget title="Blocked Items">
            <div className="space-y-2 pt-1">
              {blockedItems.length === 0 ? (
                <p className="text-[11px]" style={{ color: BRAND.textMuted }}>
                  No blocked items.
                </p>
              ) : (
                blockedItems.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() =>
                      void navigate({ to: '/item/$itemKey', params: { itemKey: i.itemKey } })
                    }
                    className="flex w-full items-start gap-2 text-left"
                  >
                    <AlertTriangle
                      size={12}
                      style={{ color: BRAND.danger, marginTop: 1 }}
                      className="shrink-0"
                    />
                    <p
                      className="min-w-0 truncate text-[11px]"
                      style={{ color: BRAND.textPrimary }}
                    >
                      <span className="font-mono" style={{ color: BRAND.textMuted }}>
                        {i.itemKey}
                      </span>{' '}
                      {i.title}
                    </p>
                  </button>
                ))
              )}
            </div>
          </Widget>

          {/* Recent activity */}
          <Widget title="Recent Activity">
            <div className="space-y-2.5 pt-1">
              {notifications.length === 0 ? (
                <p className="text-[11px]" style={{ color: BRAND.textMuted }}>
                  No recent activity.
                </p>
              ) : (
                notifications.slice(0, 6).map((n) => {
                  const actor = n.actorId ? memberMap.get(n.actorId) : undefined
                  const actorName = actor?.displayName ?? actor?.email ?? 'System'
                  return (
                    <div key={n.id} className="flex items-start gap-2">
                      <Avatar name={actorName} size={20} />
                      <div className="min-w-0">
                        <p
                          className="truncate text-[11px] leading-snug"
                          style={{ color: BRAND.textSecondary }}
                        >
                          {n.body ?? n.title}
                        </p>
                        <p className="mt-0.5 text-[10px]" style={{ color: BRAND.textMuted }}>
                          {relativeTime(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Widget>
        </div>
      )}
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="h-[180px] animate-pulse rounded" style={{ backgroundColor: BRAND.pageBg }} />
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      className="flex h-[160px] items-center justify-center text-[11px]"
      style={{ color: BRAND.textMuted }}
    >
      {label}
    </div>
  )
}
