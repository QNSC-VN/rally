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
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { HeaderCell } from '@/shared/ui/draggable-header-cell'
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
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { useProjectMembers, type ProjectMember } from '@/features/teams/api'
import { SIMPLIFIED_STATE_CONFIG, type SimplifiedState } from '@/entities/work-item/model/types'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'

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
  { key: 'id', label: 'ID', defaultWidth: 70, locked: true },
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

function fmtRange(it: Pick<Iteration, 'startDate' | 'endDate'>) {
  const s = it.startDate ?? '—'
  const e = it.endDate ?? '—'
  return `${s} → ${e}`
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

  const { data: iterations = [] } = useIterations(projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)

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
  const groups = status?.groups ?? []

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
          style={{ border: '1px solid #bdd0ef', height: 28 }}
        >
          <button
            disabled={selectedIndex <= 0}
            onClick={() => move(-1)}
            className="flex h-full cursor-pointer items-center px-2 hover:bg-[#f0f4fb] disabled:cursor-not-allowed disabled:opacity-40"
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
              className="flex h-full cursor-pointer items-center gap-3 bg-white px-3 text-left hover:bg-[#f7f9fc]"
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
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#f4f6f9]"
                    style={{
                      backgroundColor: selectedId === it.id ? '#edf2fb' : 'transparent',
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
            className="flex h-full cursor-pointer items-center px-2 hover:bg-[#f0f4fb] disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: BRAND.primaryLight,
              borderLeft: `1px solid ${BRAND.borderSubtle}`,
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="flex-1" />
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
        <div
          className="sticky top-0 z-10 flex h-[34px] items-center px-3 text-[11px] font-bold select-none"
          style={{
            backgroundColor: '#f3f4f6',
            borderBottom: '1px solid #e2e8f0',
            color: '#4b5563',
            minWidth: 'max-content',
          }}
        >
          <div className="w-6 shrink-0" /> {/* Expand/collapse */}
          {TEAM_STATUS_COLUMNS.map((col) => (
            <HeaderCell
              key={col.key}
              colKey={col.key}
              label={col.label}
              style={colStyles[col.key]}
              isRight={RIGHT_ALIGNED.has(col.key)}
              onResize={startResize}
            />
          ))}
        </div>

        {/* Totals row (P3-TS-FR-013) */}
        {totals && (
          <div
            className="flex h-7 items-center px-3 text-[11px] font-semibold"
            style={{
              backgroundColor: '#f4f6f9',
              borderBottom: `1px solid ${BRAND.borderSubtle}`,
              color: BRAND.textSecondary,
              minWidth: 'max-content',
            }}
          >
            <div className="w-6 shrink-0" />
            <div className="shrink-0" style={colStyles.rank} />
            <div className="shrink-0" style={colStyles.id} />
            <div className="min-w-[180px] flex-1" style={colStyles.name}>
              Totals
            </div>
            <div className="shrink-0" style={colStyles.workProduct} />
            <div className="shrink-0" style={colStyles.release} />
            <div className="shrink-0" style={colStyles.state} />
            <div className="shrink-0 text-right font-mono tabular-nums" style={colStyles.capacity}>
              {totals.capacityHours}
            </div>
            <div className="shrink-0 text-right font-mono tabular-nums" style={colStyles.estimate}>
              {totals.estimateHours}
            </div>
            <div className="shrink-0 text-right font-mono tabular-nums" style={colStyles.todo}>
              {totals.todoHours}
            </div>
            <div className="shrink-0 text-right font-mono tabular-nums" style={colStyles.actuals}>
              {totals.actualHours}
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
            style={{ color: '#b91c1c' }}
          >
            Failed to load team status. Please try again.
          </div>
        )}

        {/* Member groups (P3-TS-FR-014) */}
        {!isLoading &&
          !isError &&
          groups.map((group) => (
            <MemberGroup
              key={group.owner.id}
              group={group}
              projectId={projectId!}
              teamId={teamId}
              iterationId={selectedId!}
              canEdit={canEdit}
              colStyles={colStyles}
              members={members}
              onOpenTask={(task) =>
                navigate({ to: '/item/$itemKey', params: { itemKey: task.workProduct.key } })
              }
            />
          ))}

        {/* Empty state (P3-TS-TS-020) */}
        {!isLoading && !isError && groups.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-8 py-16">
            <Inbox size={36} style={{ color: '#c4cad4' }} />
            <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
              No tasks found for this iteration
            </p>
          </div>
        )}
      </div>
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
  onOpenTask,
}: {
  group: TeamStatusMemberGroup
  projectId: string
  teamId: string | undefined
  iterationId: string
  canEdit: boolean
  colStyles: Record<string, React.CSSProperties>
  members: ProjectMember[]
  onOpenTask: (task: TeamStatusTaskRow) => void
}) {
  const [expanded, setExpanded] = useState(true)
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
        className="flex h-9 cursor-pointer items-center px-3 hover:bg-[#f9fafb]"
        style={{
          backgroundColor: '#f7f8fa',
          borderBottom: `1px solid ${BRAND.borderInner}`,
          minWidth: 'max-content',
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Expand/collapse — arrow only, no bordered square (P3-TS-FR-016) */}
        <div className="flex w-6 shrink-0 items-center justify-center">
          {expanded ? (
            <ChevronDown size={12} style={{ color: BRAND.textSecondary }} />
          ) : (
            <ChevronRight size={12} style={{ color: BRAND.textSecondary }} />
          )}
        </div>
        <div className="shrink-0" style={colStyles.rank} /> {/* Rank column spacer */}
        <div className="shrink-0" style={colStyles.id} /> {/* ID column spacer */}
        {/* Owner info */}
        <div className="flex min-w-[180px] flex-1 items-center gap-2" style={colStyles.name}>
          <Avatar name={group.owner.displayName} size={20} />
          <span className="truncate text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
            {group.owner.displayName}
          </span>
          <span className="shrink-0 text-[10px]" style={{ color: BRAND.textMuted }}>
            ({group.taskCount} tasks)
          </span>
          {/* Progress bar */}
          <div
            className="ml-2 h-1.5 w-16 shrink-0 overflow-hidden rounded-full"
            style={{ backgroundColor: '#e4e8ed' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(group.progressPercent, 100)}%`,
                backgroundColor:
                  group.progressPercent > 100
                    ? '#dc2626'
                    : group.progressPercent >= 70
                      ? '#2a8c3f'
                      : BRAND.primaryLight,
              }}
            />
          </div>
          <span
            className="shrink-0 text-[10px] tabular-nums"
            style={{ color: group.progressPercent > 100 ? '#dc2626' : BRAND.textSecondary }}
          >
            {group.progressPercent}%
          </span>
        </div>
        <div className="shrink-0" style={colStyles.workProduct} />
        <div className="shrink-0" style={colStyles.release} />
        <div className="shrink-0" style={colStyles.state} />
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
        group.tasks.map((task, idx) => (
          <TaskRow
            key={task.id}
            task={task}
            idx={idx}
            projectId={projectId}
            teamId={teamId ?? ''}
            iterationId={iterationId}
            canEdit={canEdit}
            colStyles={colStyles}
            members={members}
            onOpen={() => onOpenTask(task)}
          />
        ))}
    </div>
  )
}

// ── Task Row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  idx,
  projectId,
  teamId,
  iterationId,
  canEdit,
  colStyles,
  members,
  onOpen,
}: {
  task: TeamStatusTaskRow
  idx: number
  projectId: string
  teamId: string
  iterationId: string
  canEdit: boolean
  colStyles: Record<string, React.CSSProperties>
  members: ProjectMember[]
  onOpen: () => void
}) {
  const updateTask = useUpdateTeamTask(projectId, teamId, iterationId)
  const [editingOwner, setEditingOwner] = useState(false)

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
        onSuccess: () => {
          setEditingOwner(false)
          toast.success('Owner updated')
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <div
      className="flex h-[34px] items-center bg-white px-3 text-[11px] transition-colors duration-100 hover:bg-[#f1f6fc]"
      style={{ borderBottom: `1px solid ${BRAND.borderInner}`, minWidth: 'max-content' }}
      onClick={onOpen}
    >
      <div className="w-6 shrink-0" /> {/* Spacer for expand arrow */}
      {/* Rank column */}
      {/* ponytail: use index + 1 as rank rather than a complex drag-and-drop ordering system since reordering is out of scope for Phase 3.1 */}
      <div
        className="shrink-0 px-2 font-mono text-[10px]"
        style={{ ...colStyles.rank, color: BRAND.textSecondary }}
      >
        {idx + 1}
      </div>
      {/* ID (P3-TS-FR-023) */}
      <button
        className="shrink-0 cursor-pointer truncate px-2 text-left font-mono hover:underline"
        style={{ ...colStyles.id, color: BRAND.primaryLight }}
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
      >
        {task.taskKey}
      </button>
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
        className="flex shrink-0 items-center gap-1 truncate px-2"
        style={{ ...colStyles.workProduct, color: BRAND.textSecondary }}
      >
        <TypeBadge type={(task.workProduct.type || 'story').toLowerCase()} />
        <span className="font-mono text-[10px]">{task.workProduct.key}: </span>
        <span className="truncate" title={task.workProduct.title}>
          {task.workProduct.title}
        </span>
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
        {canEdit ? (
          <div
            className="flex overflow-hidden rounded border"
            style={{ borderColor: BRAND.borderSubtle, height: 20 }}
          >
            {TEAM_TASK_STATES.map((s) => {
              const isSel = task.state === s
              const cfg = SIMPLIFIED_STATE_CONFIG[TEAM_TASK_STATE_TO_SIMPLIFIED[s] ?? 'define']
              return (
                <button
                  key={s}
                  title={s}
                  onClick={() => {
                    if (!isSel) handleStateChange(s)
                  }}
                  style={{
                    border: 'none',
                    padding: '0 4px',
                    fontSize: '9px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    backgroundColor: isSel ? cfg.activeBg : '#fff',
                    color: isSel ? '#fff' : cfg.color,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s === 'Defined' ? 'D' : s === 'In-Progress' ? 'I' : 'C'}
                </button>
              )
            })}
          </div>
        ) : (
          <StateBadge state={task.state} />
        )}
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
        {editingOwner && canEdit ? (
          <select
            autoFocus
            value={task.owner.id ?? ''}
            onChange={(e) => handleOwnerChange(e.target.value || null)}
            onBlur={() => setEditingOwner(false)}
            className="w-full rounded text-[11px] focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="truncate"
            style={{ color: BRAND.textSecondary, cursor: canEdit ? 'pointer' : 'default' }}
            onClick={canEdit ? () => setEditingOwner(true) : undefined}
          >
            {task.owner.displayName}
          </span>
        )}
      </div>
    </div>
  )
}

// ── State badge ─────────────────────────────────────────────────────────────
// Colors sourced from the shared SIMPLIFIED_STATE_CONFIG (same 3-bucket model
// Iteration Status uses for its task rows), keyed off our own TeamTaskState.

const TEAM_TASK_STATE_TO_SIMPLIFIED: Record<TeamTaskState, SimplifiedState> = {
  Defined: 'define',
  'In-Progress': 'in_progress',
  Completed: 'complete',
}

function StateBadge({ state }: { state: TeamTaskState }) {
  const cfg = SIMPLIFIED_STATE_CONFIG[TEAM_TASK_STATE_TO_SIMPLIFIED[state] ?? 'define']
  return (
    <span
      className="rounded px-1.5 py-px text-[10px] font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}20` }}
    >
      {state}
    </span>
  )
}
