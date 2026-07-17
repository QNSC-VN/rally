/**
 * Release Detail Page — P3.2 Release Management
 *
 * Visual layout matching SRS §5 and §6.1 with rich text editing areas (Theme, Notes) on the left
 * and a right sidebar panel for metadata fields, status validation, and task roll-up/acceptance metrics.
 * P3.3: Added Artifacts tab showing linked US/DE work items.
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
/* eslint-disable react-hooks/set-state-in-effect */
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Layers, Loader2, Save, TrendingDown } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { InlineSelect } from '@/shared/ui/native-select'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { SkeletonList } from '@/shared/ui/skeleton'
import { SearchInput } from '@/shared/ui/search-input'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { RELEASE_STATUS_STYLE } from '@/features/releases/status-colors'
import { useProjectPermissions } from '@/features/access/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useRelease,
  useUpdateRelease,
  useReleaseBurndown,
  useReleaseArtifacts,
  type ReleaseStatus,
  type ReleaseArtifactItem,
} from '@/features/releases/api'
import { TypeBadge, ScheduleStateBadge, PriorityBadge } from '@/entities/work-item/ui/badges'

const RELEASE_STATES: ReleaseStatus[] = ['planning', 'active', 'accepted']

const STATUS_STYLE = RELEASE_STATUS_STYLE

type TabKey = 'details' | 'artifacts'

// ── Release artifact row ──────────────────────────────────────────────────────

function ReleaseArtifactRow({
  item,
  index,
  onOpen,
}: {
  item: ReleaseArtifactItem
  index: number
  onOpen: () => void
}) {
  return (
    <tr
      className="cursor-pointer transition-colors duration-75"
      style={{ borderBottom: `1px solid ${BRAND.borderInner}` }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = BRAND.primaryLighter)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      onClick={onOpen}
    >
      <td
        className="h-8 px-3 text-center font-mono text-[10px] tabular-nums"
        style={{ color: BRAND.textMuted }}
      >
        {index + 1}
      </td>
      <td
        className="h-8 px-3 font-mono text-[10px] underline-offset-2 hover:underline"
        style={{ color: BRAND.primaryLight }}
      >
        {item.itemKey}
      </td>
      <td className="h-8 px-3">
        <span
          className="block max-w-[300px] truncate text-xs font-medium"
          style={{ color: BRAND.textPrimary }}
        >
          {item.title}
        </span>
      </td>
      <td className="h-8 px-3">
        <TypeBadge type={item.type} />
      </td>
      <td className="h-8 px-3">
        <ScheduleStateBadge state={item.scheduleState} />
      </td>
      <td className="h-8 px-3">
        <PriorityBadge priority={item.priority} />
      </td>
      <td className="h-8 px-3">
        <OwnerCell name={item.assigneeName} />
      </td>
      <td
        className="h-8 px-3 text-center font-mono text-[10px]"
        style={{ color: BRAND.textSecondary }}
      >
        {item.storyPoints ?? '—'}
      </td>
    </tr>
  )
}

// ── Release Artifacts tab ─────────────────────────────────────────────────────

function ReleaseArtifactsTab({ releaseId }: { releaseId: string }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const currentPage = cursorHistory.length + 1

  const { data, isLoading } = useReleaseArtifacts(releaseId, {
    pageSize,
    search: search || undefined,
  })

  const items = useMemo(() => data?.data ?? [], [data])
  const pageInfo = data?.pageInfo

  useEffect(() => {
    const id = setTimeout(() => {
      setCursor(undefined)
      setCursorHistory([])
    }, 0)
    return () => clearTimeout(id)
  }, [search, pageSize])

  function onPrevPage() {
    const prev = cursorHistory[cursorHistory.length - 2]
    setCursorHistory((h) => h.slice(0, -1))
    setCursor(prev)
  }

  function onNextPage() {
    if (!pageInfo?.hasNextPage || !pageInfo.nextCursor) return
    setCursorHistory((h) => [...h, cursor ?? ''])
    setCursor(pageInfo.nextCursor)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search toolbar */}
      <div
        className="flex shrink-0 items-center gap-3 px-4 py-2"
        style={{ borderBottom: `1px solid ${BRAND.borderSubtle}`, backgroundColor: BRAND.surface }}
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search artifacts..."
          ariaLabel="Search artifacts"
          width={220}
          iconSize={13}
          className="rounded-md py-1.5 pl-8 text-xs"
        />
        <div className="flex-1" />
        <span className="text-[11px]" style={{ color: BRAND.textMuted }}>
          {pageInfo?.total != null ? `${pageInfo.total} items` : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" style={{ backgroundColor: BRAND.surface }}>
        {isLoading ? (
          <SkeletonList rows={8} />
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8">
            <Layers size={32} style={{ color: BRAND.textFaint }} />
            <p className="text-xs" style={{ color: BRAND.textMuted }}>
              {search ? 'No artifacts match your search' : 'No artifacts linked to this release'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr
                className="text-[9px] font-semibold tracking-wider uppercase select-none"
                style={{
                  backgroundColor: BRAND.surfaceHover,
                  borderBottom: `1px solid ${BRAND.border}`,
                }}
              >
                <th
                  className="h-7 w-12 px-3 text-center font-medium"
                  style={{ color: BRAND.textMuted }}
                >
                  #
                </th>
                <th className="h-7 w-20 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  ID
                </th>
                <th className="h-7 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Name
                </th>
                <th className="h-7 w-14 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Type
                </th>
                <th className="h-7 w-24 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Schedule State
                </th>
                <th className="h-7 w-16 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Priority
                </th>
                <th className="h-7 w-28 px-3 font-medium" style={{ color: BRAND.textMuted }}>
                  Owner
                </th>
                <th
                  className="h-7 w-14 px-3 text-center font-medium"
                  style={{ color: BRAND.textMuted }}
                >
                  Est.
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <ReleaseArtifactRow
                  key={item.id}
                  item={item}
                  index={cursorHistory.length * pageSize + idx}
                  onOpen={() =>
                    navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {items.length > 0 && (
        <div
          className="flex h-9 shrink-0 items-center justify-between bg-white px-3"
          style={{ borderTop: `1px solid ${BRAND.borderSubtle}` }}
        >
          <div
            className="flex items-center gap-2 text-[11px]"
            style={{ color: BRAND.textSecondary }}
          >
            <span>Rows per page</span>
            <InlineSelect
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-auto"
            >
              {[10, 25, 50, 100].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </InlineSelect>
            <span style={{ color: BRAND.textMuted }}>
              {pageInfo
                ? `${(currentPage - 1) * pageSize + 1}–${(currentPage - 1) * pageSize + items.length}${pageInfo.total ? ` of ${pageInfo.total}` : ''}`
                : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums" style={{ color: BRAND.textSecondary }}>
              Page {currentPage}
            </span>
            <button
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={onPrevPage}
              className="rounded p-1.5 disabled:opacity-35"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              aria-label="Next page"
              disabled={!pageInfo?.hasNextPage}
              onClick={onNextPage}
              className="rounded p-1.5 disabled:opacity-35"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ReleaseDetailPage() {
  const { releaseId } = useParams({ from: '/auth/releases/$releaseId' })
  const { project } = useAppContext()
  const projectId = project?.projectId ?? ''
  const { can } = useProjectPermissions(projectId || undefined)
  const canManage = can('release:manage')

  const { data: release, isLoading, isError } = useRelease(releaseId)
  const update = useUpdateRelease(releaseId, projectId)
  const { data: burndown, isLoading: burndownLoading } = useReleaseBurndown(releaseId)

  // Local fields state
  const [name, setName] = useState('')
  const [theme, setTheme] = useState('')
  const [notes, setNotes] = useState('')
  const [startDate, setStartDate] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [plannedVelocity, setPlannedVelocity] = useState('')
  const [planEstimate, setPlanEstimate] = useState('')
  const [version, setVersion] = useState('')
  const [state, setState] = useState<ReleaseStatus>('planning')
  const [activeTab, setActiveTab] = useState<TabKey>('details')

  useEffect(() => {
    if (release) {
      setName(release.name)
      setTheme(release.theme ?? '')
      setNotes(release.notes ?? '')
      setStartDate(release.startDate ?? '')
      setReleaseDate(release.releaseDate ?? '')
      setPlannedVelocity(release.plannedVelocity == null ? '' : String(release.plannedVelocity))
      setPlanEstimate(release.planEstimate == null ? '' : String(release.planEstimate))
      setVersion(release.version ?? '')
      setState(release.status)
    }
  }, [release])

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Release name is required')
      return
    }
    if (startDate && releaseDate && releaseDate < startDate) {
      toast.error('Release date must be >= start date')
      return
    }

    try {
      await update.mutateAsync({
        name: name.trim(),
        theme: theme.trim() || null,
        notes: notes.trim() || null,
        startDate: startDate || null,
        releaseDate: releaseDate || null,
        plannedVelocity: plannedVelocity ? Number(plannedVelocity) : null,
        planEstimate: planEstimate ? Number(planEstimate) : null,
        version: version.trim() || null,
        state,
      })
      toast.success('Release details saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update release')
    }
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ backgroundColor: BRAND.pageBg }}
      >
        <Loader2 className="animate-spin" size={24} style={{ color: BRAND.primary }} />
      </div>
    )
  }

  if (isError || !release) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3"
        style={{ backgroundColor: BRAND.pageBg }}
      >
        <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
          Release details could not be loaded.
        </p>
        <Link
          to="/releases"
          className="text-[12px] font-semibold hover:underline"
          style={{ color: BRAND.primary }}
        >
          ← Back to Releases
        </Link>
      </div>
    )
  }

  const s = STATUS_STYLE[release.status] ?? STATUS_STYLE.planning
  const rollup = release.taskRollup

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'artifacts', label: 'Artifacts' },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: BRAND.pageBg }}>
      {/* Header bar */}
      <div
        className="flex h-12 shrink-0 items-center justify-between gap-4 px-4"
        style={{ borderBottom: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
      >
        <div className="flex items-center gap-2">
          <Link
            to="/releases"
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-gray-100"
            style={{ color: BRAND.textSecondary }}
          >
            <ChevronLeft size={16} />
          </Link>
          <div className="flex items-center gap-3">
            {canManage ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleSave}
                className="rounded border-0 bg-transparent px-1 py-0.5 text-[14px] font-semibold focus:bg-white focus:ring-1 focus:outline-none"
                style={{ color: BRAND.textPrimary, width: 240 }}
              />
            ) : (
              <h1 className="text-[14px] font-semibold" style={{ color: BRAND.textPrimary }}>
                {release.name}
              </h1>
            )}
            <span
              className="inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-medium"
              style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
            >
              {s.label}
            </span>
          </div>
        </div>

        {canManage && (
          <button
            onClick={handleSave}
            disabled={update.isPending}
            className="flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND.primary }}
          >
            {update.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save Changes
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div
        className="flex shrink-0 items-center gap-0 px-4"
        style={{ borderBottom: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="relative px-4 py-2.5 text-[12px] font-medium transition-colors"
            style={{
              color: activeTab === tab.key ? BRAND.primary : BRAND.textSecondary,
            }}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span
                className="absolute right-0 bottom-0 left-0 h-0.5"
                style={{ backgroundColor: BRAND.primary }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Content area */}
      {activeTab === 'artifacts' ? (
        <ReleaseArtifactsTab releaseId={releaseId} />
      ) : (
        /* Main Grid split — Details tab */
        <div className="flex flex-1 overflow-hidden">
          {/* Left Side: Theme & Notes rich editors */}
          <div className="flex-1 space-y-6 overflow-y-auto p-6">
            <div className="space-y-2">
              <h2
                className="text-[12px] font-semibold tracking-wider uppercase"
                style={{ color: BRAND.textSecondary }}
              >
                Release Theme
              </h2>
              <Textarea
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                onBlur={handleSave}
                disabled={!canManage}
                placeholder="Enter release themes and high level objectives..."
                rows={4}
                className="w-full rounded-md border p-3 text-[12px] focus:ring-1 focus:outline-none"
                style={{
                  borderColor: BRAND.border,
                  backgroundColor: BRAND.surface,
                  color: BRAND.textPrimary,
                }}
              />
            </div>

            <div className="space-y-2">
              <h2
                className="text-[12px] font-semibold tracking-wider uppercase"
                style={{ color: BRAND.textSecondary }}
              >
                Notes & Scope Deliverables
              </h2>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={handleSave}
                disabled={!canManage}
                placeholder="Add release notes, acceptance criteria, scope list, or deployment criteria..."
                rows={12}
                className="w-full rounded-md border p-3 text-[12px] focus:ring-1 focus:outline-none"
                style={{
                  borderColor: BRAND.border,
                  backgroundColor: BRAND.surface,
                  color: BRAND.textPrimary,
                }}
              />
            </div>
          </div>

          {/* Right Side Panel */}
          <div
            className="w-72 shrink-0 space-y-5 overflow-y-auto border-l p-5"
            style={{ backgroundColor: BRAND.surface, borderColor: BRAND.border }}
          >
            <div className="space-y-4">
              <h2
                className="text-[11px] font-semibold tracking-wider uppercase"
                style={{ color: BRAND.textMuted }}
              >
                Metadata Details
              </h2>

              <div className="space-y-1">
                <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                  Project Scope
                </label>
                <div
                  className="py-1 text-[12px] font-semibold"
                  style={{ color: BRAND.textPrimary }}
                >
                  {project?.projectName ?? '—'}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                  Lifecycle State
                </label>
                {canManage ? (
                  <InlineSelect
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value as ReleaseStatus)
                      // Auto-trigger save on change
                      void update.mutateAsync({ state: e.target.value as ReleaseStatus })
                    }}
                    className="w-full rounded bg-white px-2 py-1 text-[11px] focus:outline-none"
                    style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
                  >
                    {RELEASE_STATES.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_STYLE[st].label}
                      </option>
                    ))}
                  </InlineSelect>
                ) : (
                  <div
                    className="py-1 text-[12px] font-semibold"
                    style={{ color: BRAND.textPrimary }}
                  >
                    {s.label}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                    Start Date
                  </label>
                  {canManage ? (
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      onBlur={handleSave}
                      className="px-2 py-1 text-[11px]"
                    />
                  ) : (
                    <div className="font-mono text-[12px]" style={{ color: BRAND.textPrimary }}>
                      {startDate || '—'}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                    Release Date
                  </label>
                  {canManage ? (
                    <Input
                      type="date"
                      value={releaseDate}
                      onChange={(e) => setReleaseDate(e.target.value)}
                      onBlur={handleSave}
                      className="px-2 py-1 text-[11px]"
                    />
                  ) : (
                    <div className="font-mono text-[12px]" style={{ color: BRAND.textPrimary }}>
                      {releaseDate || '—'}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                    Planned Velocity
                  </label>
                  {canManage ? (
                    <Input
                      type="number"
                      min={0}
                      value={plannedVelocity}
                      onChange={(e) => setPlannedVelocity(e.target.value)}
                      onBlur={handleSave}
                      placeholder="0"
                      className="px-2 py-1 text-[11px]"
                    />
                  ) : (
                    <div className="font-mono text-[12px]" style={{ color: BRAND.textPrimary }}>
                      {plannedVelocity || '—'}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                    Plan Estimate
                  </label>
                  {canManage ? (
                    <Input
                      type="number"
                      min={0}
                      value={planEstimate}
                      onChange={(e) => setPlanEstimate(e.target.value)}
                      onBlur={handleSave}
                      placeholder="0"
                      className="px-2 py-1 text-[11px]"
                    />
                  ) : (
                    <div className="font-mono text-[12px]" style={{ color: BRAND.textPrimary }}>
                      {planEstimate || '—'}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium" style={{ color: BRAND.textSecondary }}>
                  Version Release Tag
                </label>
                {canManage ? (
                  <Input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    onBlur={handleSave}
                    placeholder="e.g. v2.4.0"
                    className="px-2 py-1 text-[11px]"
                  />
                ) : (
                  <div className="text-[12px] font-semibold" style={{ color: BRAND.textPrimary }}>
                    {version || '—'}
                  </div>
                )}
              </div>
            </div>

            {/* Task Roll-up metrics panel (read-only: Estimate / To Do / Actual) */}
            {rollup && (
              <div
                className="space-y-3 rounded-md p-3"
                style={{
                  backgroundColor: BRAND.surfaceHover,
                  border: `1px solid ${BRAND.borderSubtle}`,
                }}
              >
                <h3
                  className="text-[10px] font-bold tracking-wider uppercase"
                  style={{ color: BRAND.textSecondary }}
                >
                  Task Roll-up
                </h3>

                <div className="space-y-1">
                  <div
                    className="flex justify-between text-[11px] font-semibold"
                    style={{ color: BRAND.textPrimary }}
                  >
                    <span>Completion</span>
                    <span>{rollup.progressPercent}%</span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full"
                    style={{ backgroundColor: BRAND.avatarBg }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${rollup.progressPercent}%`,
                        backgroundColor: rollup.progressPercent === 100 ? '#16a34a' : '#2563eb',
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  {/* Estimate / To Do / Actual — points */}
                  <div className="grid grid-cols-3 gap-1 text-center">
                    <div
                      className="rounded-sm py-1.5"
                      style={{ backgroundColor: BRAND.primaryLighter }}
                    >
                      <div
                        className="text-[9px] font-semibold tracking-wider uppercase"
                        style={{ color: BRAND.primary }}
                      >
                        Estimate
                      </div>
                      <div
                        className="font-mono text-[14px] font-bold"
                        style={{ color: BRAND.textPrimary }}
                      >
                        {rollup.totalPoints}
                      </div>
                    </div>
                    <div className="rounded-sm py-1.5" style={{ backgroundColor: '#fff7ed' }}>
                      <div
                        className="text-[9px] font-semibold tracking-wider uppercase"
                        style={{ color: '#92400e' }}
                      >
                        To Do
                      </div>
                      <div
                        className="font-mono text-[14px] font-bold"
                        style={{ color: BRAND.textPrimary }}
                      >
                        {rollup.toDoPoints}
                      </div>
                    </div>
                    <div className="rounded-sm py-1.5" style={{ backgroundColor: BRAND.successBg }}>
                      <div
                        className="text-[9px] font-semibold tracking-wider uppercase"
                        style={{ color: BRAND.success }}
                      >
                        Actual
                      </div>
                      <div
                        className="font-mono text-[14px] font-bold"
                        style={{ color: BRAND.textPrimary }}
                      >
                        {rollup.completedPoints}
                      </div>
                    </div>
                  </div>

                  {/* Item counts */}
                  <div
                    className="grid grid-cols-3 gap-1 pt-1 text-center font-mono text-[10px]"
                    style={{ color: BRAND.textMuted }}
                  >
                    <div>
                      Items:{' '}
                      <span className="font-semibold text-gray-700">{rollup.totalItems}</span>
                    </div>
                    <div>
                      To Do: <span className="font-semibold text-gray-700">{rollup.toDoItems}</span>
                    </div>
                    <div>
                      Done:{' '}
                      <span className="font-semibold text-gray-700">{rollup.completedItems}</span>
                    </div>
                  </div>
                </div>

                {/* Accepted count (read-only) */}
                <div
                  className="mt-1 flex items-center justify-between rounded-sm px-3 py-2"
                  style={{ backgroundColor: BRAND.successBg, border: '1px solid #b9dec2' }}
                >
                  <span
                    className="text-[10px] font-semibold tracking-wider uppercase"
                    style={{ color: BRAND.success }}
                  >
                    Accepted
                  </span>
                  <span
                    className="font-mono text-[14px] font-bold"
                    style={{ color: BRAND.success }}
                  >
                    {rollup.acceptedItems}
                  </span>
                </div>
              </div>
            )}

            {/* Burndown Section */}
            <div
              className="space-y-3 rounded-md p-4"
              style={{
                backgroundColor: BRAND.surfaceHover,
                border: `1px solid ${BRAND.borderSubtle}`,
              }}
            >
              <h3
                className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase"
                style={{ color: BRAND.textSecondary }}
              >
                <TrendingDown size={13} />
                Burndown
              </h3>
              {burndownLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="animate-spin" size={16} style={{ color: BRAND.textMuted }} />
                </div>
              ) : burndown && burndown.length > 0 ? (
                <div className="max-h-56 overflow-auto">
                  <table className="w-full text-left text-[10px]">
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}>
                        <th
                          className="py-1 pr-2 font-semibold"
                          style={{ color: BRAND.textSecondary }}
                        >
                          Date
                        </th>
                        <th
                          className="py-1 pr-2 text-right font-semibold"
                          style={{ color: BRAND.textSecondary }}
                        >
                          Total
                        </th>
                        <th
                          className="py-1 pr-2 text-right font-semibold"
                          style={{ color: BRAND.textSecondary }}
                        >
                          Done
                        </th>
                        <th
                          className="py-1 text-right font-semibold"
                          style={{ color: BRAND.textSecondary }}
                        >
                          Remaining
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {burndown.map((pt) => (
                        <tr
                          key={pt.date}
                          style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
                        >
                          <td className="py-1 pr-2 font-mono" style={{ color: BRAND.textPrimary }}>
                            {pt.date}
                          </td>
                          <td
                            className="py-1 pr-2 text-right font-mono"
                            style={{ color: BRAND.textPrimary }}
                          >
                            {pt.totalPoints}
                          </td>
                          <td
                            className="py-1 pr-2 text-right font-mono"
                            style={{ color: BRAND.success }}
                          >
                            {pt.completedPoints}
                          </td>
                          <td
                            className="py-1 text-right font-mono"
                            style={{ color: BRAND.textPrimary }}
                          >
                            {pt.remainingPoints}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[11px]" style={{ color: BRAND.textMuted }}>
                  No burndown data available yet.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
