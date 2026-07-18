/**
 * Track › Team Status — P3.1
 *
 * Dense grouped table of task-level rows per iteration, grouped by
 * owner/member. Features inline editing for Capacity, Task Name, and Task State.
 * Iteration selector reuses the same pattern as Iteration Status.
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useMemo, useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState } from '@/shared/ui/empty-state'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { DataTableHeader, type DataTableHeaderColumn } from '@/shared/ui/data-table-header'
import { BRAND } from '@/shared/config/brand'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useIterations, type Iteration } from '@/features/iterations/api'
import {
  useTeamStatus,
  useUpdateCapacity,
  useUpdateTeamTask,
  type TeamStatusMemberGroup,
  type TeamStatusTaskRow,
  type TeamTaskState,
} from '@/features/team-status/api'
import { Avatar } from '@/shared/ui/avatar'
import { useColumnLayout, type ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { useColumnDrag } from '@/shared/lib/hooks/use-column-drag'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { NESTED_ROW_INDENT } from '@/shared/config/layout'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { useProjectMembers, type ProjectMember } from '@/features/teams/api'
import {
  SIMPLIFIED_STATE_CONFIG,
  WorkItemType,
  type SimplifiedState,
} from '@/entities/work-item/model/types'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { type StateStep } from '@/entities/work-item/ui/state-steps'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { OwnerSelectCell } from '@/shared/ui/owner-cell'

const TEAM_TASK_STATES: TeamTaskState[] = ['Defined', 'In-Progress', 'Completed']

type ColKey =
  | 'rank'
  | 'id'
  | 'name'
  | 'workProduct'
  | 'release'
  | 'state'
  | 'capacity'
  | 'estimate'
  | 'todo'
  | 'actuals'
  | 'owner'

const TEAM_STATUS_COLUMNS: ColumnDef<ColKey>[] = [
  { key: 'rank', label: 'Rank', defaultWidth: 45, locked: true },
  { key: 'id', label: 'ID', defaultWidth: 132, minWidth: 120, locked: true },
  { key: 'name', label: 'Task Name', defaultWidth: 240, minWidth: 150, locked: true },
  { key: 'workProduct', label: 'Work Product', defaultWidth: 140 },
  { key: 'release', label: 'Release', defaultWidth: 96 },
  { key: 'state', label: 'State', defaultWidth: 112 },
  { key: 'capacity', label: 'Capacity', defaultWidth: 64 },
  { key: 'estimate', label: 'Estimate', defaultWidth: 64 },
  { key: 'todo', label: 'To Do', defaultWidth: 56 },
  { key: 'actuals', label: 'Actuals', defaultWidth: 56 },
  { key: 'owner', label: 'Owner', defaultWidth: 96 },
]

const RIGHT_ALIGNED = new Set<ColKey>(['capacity', 'estimate', 'todo', 'actuals'])

/** Header descriptors for the shared <DataTableHeader> (no sort on this grid). */
const TEAM_HEADER_COLUMNS: DataTableHeaderColumn<ColKey>[] = TEAM_STATUS_COLUMNS.map((c) => ({
  key: c.key,
  label: c.label,
  align: RIGHT_ALIGNED.has(c.key) ? ('right' as const) : undefined,
}))

function fmtRange(it: Pick<Iteration, 'startDate' | 'endDate'>) {
  const s = it.startDate ?? '—'
  const e = it.endDate ?? '—'
  return `${s} → ${e}`
}

/**
 * Member capacity load bar — Rally Team Status style: a percentage label above
 * a fill bar that is green when at/under capacity (≤100%) and red when over
 * (>100%). Rendered in the State column of each member group row.
 */
function LoadBar({ percent }: { percent: number }) {
  const over = percent > 100
  const color = over ? BRAND.danger : BRAND.success
  return (
    <div className="flex w-full flex-col gap-[3px]">
      <span className="text-[10px] leading-none font-semibold tabular-nums" style={{ color }}>
        {percent}%
      </span>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: BRAND.borderSubtle }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

export function TeamStatusPage() {
  const navigate = useNavigate()
  const { project, team } = useAppContext()
  const projectId = project?.projectId
  const teamId = team?.teamId
  const { can } = useProjectPermissions(projectId)
  const canEdit = can('team_status:edit')

  // ── Column layout state (P3-TS-FR-011: resize + reorder + show/hide) ──
  // Must be declared before any early returns to satisfy Rules of Hooks.
  const { startResize, order, hidden, toggleVisible, reorder, styleFor } = useColumnLayout(
    TEAM_STATUS_COLUMNS,
    STORAGE_KEYS.TEAM_STATUS_COLUMNS,
  )

  // Build per-column style (width + order + visibility) via useColumnLayout.
  const colStyles = useMemo(
    () =>
      Object.fromEntries(
        TEAM_STATUS_COLUMNS.map((c) => [
          c.key,
          styleFor(c.key, c.key === 'name' ? { flex: 1, minWidth: 150 } : { flexShrink: 0 }),
        ]),
      ) as Record<ColKey, React.CSSProperties>,
    [styleFor],
  )

  // Header column drag-to-reorder (persists via useColumnLayout.reorder).
  const {
    activeDragKey,
    dropIndicator,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  } = useColumnDrag<ColKey>({ onReorder: reorder })

  const { data: iterations = [] } = useIterations(projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (projectId) {
      const persisted = localStorage.getItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`)
      setChosenId(persisted)
    } else {
      setChosenId(null)
    }
  }, [projectId])

  const selectedId =
    chosenId && iterations.some((i) => i.id === chosenId) ? chosenId : (iterations[0]?.id ?? null)

  const setSelectedId = useCallback(
    (id: string | null) => {
      setChosenId(id)
      if (projectId) {
        if (id) {
          localStorage.setItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`, id)
        } else {
          localStorage.removeItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`)
        }
      }
    },
    [projectId],
  )

  const {
    data: status,
    isLoading,
    isError,
  } = useTeamStatus(projectId ?? undefined, teamId ?? undefined, selectedId ?? undefined)

  const selectedIndex = useMemo(
    () => iterations.findIndex((i) => i.id === selectedId),
    [iterations, selectedId],
  )
  const selected = iterations[selectedIndex]

  function move(dir: -1 | 1) {
    const next = selectedIndex + dir
    if (next >= 0 && next < iterations.length) setSelectedId(iterations[next].id)
  }

  // ── Client-side pagination over member groups (Rally parity, 10/page) ──
  // The team-status response is a bounded per-iteration dataset, so we paginate
  // the loaded/filtered member groups client-side. Totals remain across the
  // whole roster (computed server-side), independent of the visible page.
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  // Snap back to the first page whenever the view identity changes.
  const pageResetKey = `${selectedId ?? ''}|${search}|${pageSize}`
  const [syncedPageKey, setSyncedPageKey] = useState(pageResetKey)
  if (syncedPageKey !== pageResetKey) {
    setSyncedPageKey(pageResetKey)
    setPage(1)
  }
  const goPrevPage = useCallback(() => setPage((p) => Math.max(1, p - 1)), [])
  const goNextPage = useCallback(() => setPage((p) => p + 1), [])

  // ── Empty / guard states ─────────────────────────────────────────────

  if (!projectId) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-[13px]"
        style={{ color: BRAND.textMuted }}
      >
        Select a project to view Team Status.
      </div>
    )
  }

  if (!iterations.length) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 text-[13px]"
        style={{ color: BRAND.textMuted }}
      >
        <span>No iterations in this project/team yet.</span>
        <button
          onClick={() => navigate({ to: '/timeboxes' })}
          className="cursor-pointer text-[12px] font-semibold hover:underline"
          style={{ color: BRAND.primaryLight }}
        >
          Go to Timeboxes →
        </button>
      </div>
    )
  }

  const totals = status?.totals
  const allGroups = status?.groups ?? []
  const totalWorkItems = allGroups.reduce((sum, g) => sum + g.taskCount, 0)
  const q = search.trim().toLowerCase()
  const groups = q
    ? allGroups
        .map((g) => ({
          ...g,
          tasks: g.tasks.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              t.taskKey.toLowerCase().includes(q) ||
              t.workProduct.title.toLowerCase().includes(q) ||
              t.workProduct.key.toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.tasks.length > 0)
    : allGroups

  // Paginate the visible member groups (see hook block above).
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pagedGroups = groups.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Selector bar — reuses Iteration Status pattern (P3-TS-FR-003) */}
      <div
        className="flex shrink-0 items-center gap-3 px-4 py-2"
        style={{
          backgroundColor: BRAND.surface,
          borderBottom: `1px solid ${BRAND.borderSubtle}`,
        }}
      >
        <span className="text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Iteration
        </span>
        <div
          className="flex items-center overflow-visible rounded"
          style={{ border: `1px solid ${BRAND.accentBorder}`, height: 28 }}
        >
          <button
            disabled={selectedIndex <= 0}
            onClick={() => move(-1)}
            className="flex h-full cursor-pointer items-center px-2 hover:bg-primary-lighter disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: BRAND.primaryLight,
              borderRight: `1px solid ${BRAND.borderSubtle}`,
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <div className="relative h-full">
            <button
              onClick={() => setSelectorOpen((o) => !o)}
              className="flex h-full cursor-pointer items-center gap-3 bg-white px-3 text-left hover:bg-surface-hover"
              style={{ minWidth: 280, color: BRAND.textPrimary }}
            >
              <span className="text-[12px] font-semibold whitespace-nowrap">{selected?.name}</span>
              <span
                className="text-[11px] whitespace-nowrap"
                style={{ color: BRAND.textSecondary }}
              >
                {selected && fmtRange(selected)}
              </span>
              <ChevronDown size={12} className="ml-auto" style={{ color: BRAND.textSecondary }} />
            </button>
            {selectorOpen && (
              <div
                className="absolute top-full left-0 z-50 mt-1 max-h-72 w-full overflow-auto rounded bg-white py-1 shadow-lg"
                style={{ border: `1px solid ${BRAND.border}` }}
              >
                {iterations.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => {
                      setSelectedId(it.id)
                      setSelectorOpen(false)
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-subtle"
                    style={{
                      backgroundColor: selectedId === it.id ? BRAND.primaryLighter : 'transparent',
                    }}
                  >
                    <span
                      className="flex-1 text-[12px] font-semibold"
                      style={{
                        color: selectedId === it.id ? BRAND.primary : BRAND.textPrimary,
                      }}
                    >
                      {it.name}
                    </span>
                    <span className="text-[11px]" style={{ color: BRAND.textSecondary }}>
                      {fmtRange(it)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            disabled={selectedIndex >= iterations.length - 1}
            onClick={() => move(1)}
            className="flex h-full cursor-pointer items-center px-2 hover:bg-primary-lighter disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: BRAND.primaryLight,
              borderLeft: `1px solid ${BRAND.borderSubtle}`,
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Tasks"
          aria-label="Search Tasks"
          className="h-7 w-56 rounded px-2 text-[12px] focus:outline-none"
          style={{ border: `1px solid ${BRAND.accentBorder}`, color: BRAND.textPrimary }}
        />
        <div className="flex-1" />
        <span className="text-[11px] whitespace-nowrap" style={{ color: BRAND.textSecondary }}>
          Total Work Items:{' '}
          <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
            {totalWorkItems}
          </span>
        </span>
        <ColumnFieldsMenu
          columns={TEAM_STATUS_COLUMNS}
          order={order}
          hidden={hidden}
          onToggle={toggleVisible}
          onReorder={reorder}
        />
      </div>

      {/* Table */}
      <div
        className="flex flex-1 flex-col overflow-auto"
        style={{ backgroundColor: BRAND.surface }}
      >
        {/* Header row (P3-TS-FR-010) */}
        <DataTableHeader
          columns={TEAM_HEADER_COLUMNS}
          colStyles={colStyles}
          onResize={startResize}
          className="px-3"
          leading={<div className="w-6 shrink-0" />}
          columnDrag={{
            activeDragKey,
            dropIndicator,
            onDragStart: handleDragStart,
            onDragOver: handleDragOver,
            onDragLeave: handleDragLeave,
            onDrop: handleDrop,
            onDragEnd: handleDragEnd,
          }}
        />

        {/* Totals row (P3-TS-FR-013) */}
        {totals && (
          <div
            className="flex h-7 items-center px-3 text-[11px] font-semibold"
            style={{
              backgroundColor: BRAND.surfaceSubtle,
              borderBottom: `1px solid ${BRAND.borderSubtle}`,
              color: BRAND.textSecondary,
              minWidth: 'max-content',
            }}
          >
            <div className="w-6 shrink-0" />
            <div className="shrink-0" style={colStyles.rank} />
            <div className="shrink-0" style={colStyles.id} />
            <div className="min-w-[180px] flex-1" style={colStyles.name} />
            <div className="shrink-0" style={colStyles.workProduct} />
            <div className="shrink-0" style={colStyles.release} />
            <div className="shrink-0" style={colStyles.state} />
            <div className="shrink-0 text-right font-mono tabular-nums" style={colStyles.capacity}>
              {totals.capacityHours} Hours
            </div>
            <div className="shrink-0 text-right font-mono tabular-nums" style={colStyles.estimate}>
              {totals.estimateHours} Hours
            </div>
            <div className="shrink-0 text-right font-mono tabular-nums" style={colStyles.todo}>
              {totals.todoHours} Hours
            </div>
            <div className="shrink-0 text-right font-mono tabular-nums" style={colStyles.actuals}>
              {totals.actualHours} Hours
            </div>
            <div className="shrink-0" style={colStyles.owner} />
          </div>
        )}

        {/* Loading */}
        {isLoading && <SkeletonList rows={10} cols={10} />}

        {/* Error */}
        {!isLoading && isError && (
          <div
            className="flex h-40 items-center justify-center text-[12px]"
            style={{ color: BRAND.danger }}
          >
            Failed to load team status. Please try again.
          </div>
        )}

        {/* Member groups (P3-TS-FR-014) */}
        {!isLoading &&
          !isError &&
          pagedGroups.map((group) => (
            <MemberGroup
              key={group.owner.id}
              group={group}
              projectId={projectId!}
              teamId={teamId}
              iterationId={selectedId!}
              canEdit={canEdit}
              colStyles={colStyles}
              members={members}
              onOpenItem={(itemKey) => {
                if (itemKey) navigate({ to: '/item/$itemKey', params: { itemKey } })
              }}
            />
          ))}

        {/* Empty state (P3-TS-TS-020) */}
        {!isLoading && !isError && groups.length === 0 && (
          <EmptyState
            icon={<Inbox size={36} className="text-foreground-faint" />}
            title="No tasks found for this iteration"
          />
        )}
      </div>

      {/* Pagination footer (P3-TS-FR-014, Rally parity) — paginates member groups */}
      {!isLoading && !isError && status && (
        <PaginationFooter
          pageSize={pageSize}
          setPageSize={setPageSize}
          currentPage={currentPage}
          rangeStart={groups.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
          rangeEnd={(currentPage - 1) * pageSize + pagedGroups.length}
          total={groups.length}
          pageCount={pageCount}
          hasPrevPage={currentPage > 1}
          hasNextPage={currentPage < pageCount}
          onPrevPage={goPrevPage}
          onNextPage={goNextPage}
        />
      )}
    </div>
  )
}

// ── Member Group ────────────────────────────────────────────────────────────

function MemberGroup({
  group,
  projectId,
  teamId,
  iterationId,
  canEdit,
  colStyles,
  members,
  onOpenItem,
}: {
  group: TeamStatusMemberGroup
  projectId: string
  teamId: string | undefined
  iterationId: string
  canEdit: boolean
  colStyles: Record<string, React.CSSProperties>
  members: ProjectMember[]
  onOpenItem: (itemKey: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const updateCapacity = useUpdateCapacity(projectId, teamId, iterationId)

  function commitCapacity(raw: string) {
    const val = Number(raw)
    if (isNaN(val) || val < 0) {
      toast.error('Capacity must be a number >= 0')
      return
    }
    updateCapacity.mutate(
      { userId: group.owner.id, capacityHours: val },
      {
        onSuccess: () => toast.success(`Capacity updated for ${group.owner.displayName}`),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <div>
      {/* Group header row (P3-TS-FR-015) */}
      <div
        className="flex h-9 cursor-pointer items-center px-3 hover:bg-surface-hover"
        style={{
          backgroundColor: BRAND.surfaceHover,
          borderBottom: `1px solid ${BRAND.borderInner}`,
          minWidth: 'max-content',
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Leading gutter (aligns with task-row drag/checkbox area) */}
        <div className="w-6 shrink-0" />
        <div className="shrink-0" style={colStyles.rank} /> {/* Rank column spacer */}
        {/* Member label — caret + avatar + name clustered at the ID column,
            matching Rally. Spans the ID + Task Name width (order 1, after rank).
            Caret only renders for expandable members (P3-TS-FR-016). */}
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-2" style={{ order: 1 }}>
          <span className="flex w-3 shrink-0 items-center justify-center">
            {group.taskCount > 0 &&
              (expanded ? (
                <ChevronDown size={12} style={{ color: BRAND.textSecondary }} />
              ) : (
                <ChevronRight size={12} style={{ color: BRAND.textSecondary }} />
              ))}
          </span>
          <Avatar name={group.owner.displayName} size={20} />
          <span className="truncate text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
            {group.owner.displayName}
          </span>
          <span className="shrink-0 text-[10px]" style={{ color: BRAND.textMuted }}>
            ({group.taskCount} Tasks)
          </span>
        </div>
        <div className="shrink-0" style={colStyles.workProduct} />
        <div className="shrink-0" style={colStyles.release} />
        {/* State column shows the member capacity load bar (Rally-style). */}
        <div className="flex shrink-0 flex-col justify-center px-2" style={colStyles.state}>
          <LoadBar percent={group.progressPercent} />
        </div>
        {/* Capacity (editable on group row — P3-TS-FR-017) */}
        <div
          className="shrink-0 text-right"
          style={colStyles.capacity}
          onClick={(e) => e.stopPropagation()}
        >
          <InlineEditableCell
            value={String(group.capacityHours)}
            canEdit={canEdit}
            onCommit={commitCapacity}
            trigger="dblclick"
            className="font-mono text-[11px] tabular-nums hover:underline"
            style={{ color: BRAND.textSecondary }}
            inputClassName="w-12 text-[11px] text-right font-mono px-1 py-0.5 rounded focus:outline-none"
            inputStyle={{
              border: `1px solid ${BRAND.borderInput}`,
              backgroundColor: 'white',
              color: BRAND.textPrimary,
            }}
            ariaLabel="Capacity"
          />
        </div>
        <div
          className="shrink-0 text-right font-mono text-[11px] tabular-nums"
          style={{ ...colStyles.estimate, color: BRAND.textSecondary }}
        >
          {group.estimateHours}
        </div>
        <div
          className="shrink-0 text-right font-mono text-[11px] tabular-nums"
          style={{ ...colStyles.todo, color: BRAND.textSecondary }}
        >
          {group.todoHours}
        </div>
        <div
          className="shrink-0 text-right font-mono text-[11px] tabular-nums"
          style={{ ...colStyles.actuals, color: BRAND.textSecondary }}
        >
          {group.actualHours}
        </div>
        <div className="shrink-0" style={colStyles.owner} />
      </div>

      {/* Task rows */}
      {expanded &&
        group.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            projectId={projectId}
            teamId={teamId ?? ''}
            iterationId={iterationId}
            canEdit={canEdit}
            colStyles={colStyles}
            members={members}
            onOpenItem={onOpenItem}
          />
        ))}
    </div>
  )
}

// ── Task Row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  projectId,
  teamId,
  iterationId,
  canEdit,
  colStyles,
  members,
  onOpenItem,
}: {
  task: TeamStatusTaskRow
  projectId: string
  teamId: string
  iterationId: string
  canEdit: boolean
  colStyles: Record<string, React.CSSProperties>
  members: ProjectMember[]
  onOpenItem: (itemKey: string) => void
}) {
  const updateTask = useUpdateTeamTask(projectId, teamId, iterationId)

  function commitTitle(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) {
      toast.error('Task name must not be empty')
      return
    }
    if (trimmed === task.title) return
    updateTask.mutate(
      { taskId: task.id, title: trimmed },
      {
        onSuccess: () => toast.success('Task name updated'),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  function handleStateChange(state: TeamTaskState) {
    updateTask.mutate(
      { taskId: task.id, state },
      {
        onSuccess: () => toast.success(`Task state updated to ${state}`),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  function commitEstimate(raw: string) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('Estimate must be a positive number')
      return
    }
    // Auto-sync: editing estimate also sets To Do (client-side mirror of backend auto-sync).
    updateTask.mutate(
      { taskId: task.id, estimateHours: num, todoHours: num },
      {
        onSuccess: () => toast.success('Estimate updated'),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  function commitTodo(raw: string) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('To Do hours must be a positive number')
      return
    }
    updateTask.mutate(
      { taskId: task.id, todoHours: num },
      {
        onSuccess: () => toast.success('To Do hours updated'),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  function commitActual(raw: string) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('Actual hours must be a positive number')
      return
    }
    updateTask.mutate(
      { taskId: task.id, actualHours: num },
      {
        onSuccess: () => toast.success('Actual hours updated'),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  function handleOwnerChange(userId: string | null) {
    updateTask.mutate(
      { taskId: task.id, assigneeId: userId },
      {
        onSuccess: () => toast.success('Owner updated'),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <div
      className="flex h-[34px] items-center bg-white px-3 text-[11px] transition-colors duration-100 hover:bg-primary-lighter"
      style={{ borderBottom: `1px solid ${BRAND.borderInner}`, minWidth: 'max-content' }}
      onClick={() => onOpenItem(task.taskKey)}
    >
      <div className="w-6 shrink-0" /> {/* Spacer for expand arrow */}
      {/* Rank column — empty on task rows; tasks nest under the member (Rally-style). */}
      <div className="shrink-0" style={colStyles.rank} />
      {/* ID (P3-TS-FR-023) — nested under the member via the shared indent token. */}
      <div
        className={`flex shrink-0 items-center overflow-hidden pr-2 ${NESTED_ROW_INDENT}`}
        style={colStyles.id}
      >
        <IdCell
          type={WorkItemType.Task}
          itemKey={task.taskKey}
          onOpen={() => onOpenItem(task.taskKey)}
        />
      </div>
      {/* Task Name (P3-TS-FR-019 — inline editable) */}
      <div
        className="min-w-[180px] flex-1 px-2"
        style={colStyles.name}
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          value={task.title}
          canEdit={canEdit}
          onCommit={commitTitle}
          trigger="dblclick"
          displayValue={task.displayName || task.title}
          className="block truncate hover:underline"
          style={{ color: BRAND.textPrimary }}
          inputClassName="w-full text-[11px] px-1 py-0.5 rounded focus:outline-none"
          inputStyle={{
            border: `1px solid ${BRAND.borderInput}`,
            backgroundColor: 'white',
            color: BRAND.textPrimary,
          }}
          title={task.displayName || task.title}
          ariaLabel="Task name"
        />
      </div>
      {/* Work Product (P3-TS-FR-024) */}
      <div
        className="flex shrink-0 items-center overflow-hidden px-2"
        style={colStyles.workProduct}
      >
        {task.workProduct.key ? (
          <WorkItemRefCell
            type={(task.workProduct.type || 'story').toLowerCase() as WorkItemType}
            itemKey={task.workProduct.key}
            title={task.workProduct.title}
            onOpen={() => onOpenItem(task.workProduct.key)}
          />
        ) : (
          <span className="text-[10px]" style={{ color: BRAND.textFaint }}>
            —
          </span>
        )}
      </div>
      {/* Release (P3-TS-FR-025) */}
      <div
        className="shrink-0 truncate px-2"
        style={{ ...colStyles.release, color: BRAND.textSecondary }}
      >
        {task.release?.name ?? ''}
      </div>
      {/* State (P3-TS-FR-021 — inline editable) */}
      <div className="shrink-0 px-2" style={colStyles.state} onClick={(e) => e.stopPropagation()}>
        <StateStepper
          steps={TEAM_TASK_STATE_STEPS}
          value={task.state}
          canEdit={canEdit}
          onChange={handleStateChange}
          ariaLabel="Task state"
        />
      </div>
      {/* Capacity (empty on task row — P3-TS-FR-024) */}
      <div className="shrink-0 px-2" style={colStyles.capacity} />
      {/* Estimate / ToDo / Actuals (P3-TS-FR-026 — inline editable) */}
      <div
        className="shrink-0 px-2 text-right"
        style={colStyles.estimate}
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          value={String(task.estimateHours ?? '')}
          canEdit={canEdit}
          onCommit={commitEstimate}
          displayValue={task.estimateHours || '—'}
          className="font-mono tabular-nums"
          style={{ color: BRAND.textSecondary }}
          inputClassName="w-full text-[11px] text-right font-mono px-1 py-0.5 rounded focus:outline-none"
          inputStyle={{
            border: `1px solid ${BRAND.borderInput}`,
            backgroundColor: 'white',
            color: BRAND.textPrimary,
          }}
          ariaLabel="Estimate hours"
        />
      </div>
      <div
        className="shrink-0 px-2 text-right"
        style={colStyles.todo}
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          value={String(task.todoHours ?? '')}
          canEdit={canEdit}
          onCommit={commitTodo}
          displayValue={task.todoHours || '—'}
          className="font-mono tabular-nums"
          style={{ color: BRAND.textSecondary }}
          inputClassName="w-full text-[11px] text-right font-mono px-1 py-0.5 rounded focus:outline-none"
          inputStyle={{
            border: `1px solid ${BRAND.borderInput}`,
            backgroundColor: 'white',
            color: BRAND.textPrimary,
          }}
          ariaLabel="To Do hours"
        />
      </div>
      <div
        className="shrink-0 px-2 text-right"
        style={colStyles.actuals}
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          value={String(task.actualHours ?? '')}
          canEdit={canEdit}
          onCommit={commitActual}
          displayValue={task.actualHours || '—'}
          className="font-mono tabular-nums"
          style={{ color: BRAND.textSecondary }}
          inputClassName="w-full text-[11px] text-right font-mono px-1 py-0.5 rounded focus:outline-none"
          inputStyle={{
            border: `1px solid ${BRAND.borderInput}`,
            backgroundColor: 'white',
            color: BRAND.textPrimary,
          }}
          ariaLabel="Actual hours"
        />
      </div>
      {/* Owner + Dev Owner (UI-only alias — both write assigneeId) */}
      <div
        className="shrink-0 truncate px-2 text-[11px]"
        style={colStyles.owner}
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerSelectCell
          ownerName={task.owner.id ? task.owner.displayName : null}
          assigneeId={task.owner.id}
          members={members}
          canEdit={canEdit}
          onChange={handleOwnerChange}
        />
      </div>
    </div>
  )
}

// ── State stepper steps ─────────────────────────────────────────────────────
// Colors sourced from the shared SIMPLIFIED_STATE_CONFIG (same 3-bucket model
// Iteration Status uses for its task rows), keyed off our own TeamTaskState.
// The segmented control itself is the shared StateStepper so every grid in the
// app renders the state column identically.

const TEAM_TASK_STATE_TO_SIMPLIFIED: Record<TeamTaskState, SimplifiedState> = {
  Defined: 'define',
  'In-Progress': 'in_progress',
  Completed: 'complete',
}

const TEAM_TASK_STATE_STEPS: StateStep<TeamTaskState>[] = TEAM_TASK_STATES.map((s) => ({
  value: s,
  label: s,
  letter: s.charAt(0),
  activeBg: SIMPLIFIED_STATE_CONFIG[TEAM_TASK_STATE_TO_SIMPLIFIED[s]].activeBg,
}))
