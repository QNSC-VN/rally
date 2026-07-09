/**
 * Track › Team Status — P3.1
 *
 * Dense grouped table of task-level rows per iteration, grouped by
 * owner/member. Features inline editing for Capacity, Task Name, and Task State.
 * Iteration selector reuses the same pattern as Iteration Status.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronDown as ArrowDown,
  ChevronRight as ArrowRight,
  Loader2,
} from 'lucide-react'
import { SkeletonList } from '@/shared/ui/skeleton'
import { InlineSelect } from '@/shared/ui/native-select'
import { BRAND } from '@/shared/config/brand'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
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

const TEAM_TASK_STATES: TeamTaskState[] = ['Defined', 'In-Progress', 'Completed']

function fmtRange(it: Pick<Iteration, 'startDate' | 'endDate'>) {
  const s = it.startDate ?? '—'
  const e = it.endDate ?? '—'
  return `${s} → ${e}`
}

export function TeamStatusPage() {
  const navigate = useNavigate()
  const { project, team } = useAppContext()
  const projectId = project?.projectId
  const teamId = team
  const canEdit = useAuthStore((s) => s.hasPermission('team_status:edit'))

  const { data: iterations = [] } = useIterations(projectId)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)

  const selectedId =
    chosenId && iterations.some((i) => i.id === chosenId)
      ? chosenId
      : (iterations[0]?.id ?? null)
  const setSelectedId = setChosenId

  const {
    data: status,
    isLoading,
    isError,
  } = useTeamStatus(projectId, teamId, selectedId ?? undefined)

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

  if (!projectId || !teamId) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px]" style={{ color: BRAND.textMuted }}>
        Select a project and team to view Team Status.
      </div>
    )
  }

  if (!iterations.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[13px]" style={{ color: BRAND.textMuted }}>
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
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Selector bar — reuses Iteration Status pattern (P3-TS-FR-003) */}
      <div
        className="flex items-center gap-3 px-4 py-2 shrink-0"
        style={{
          backgroundColor: BRAND.surface,
          borderBottom: `1px solid ${BRAND.borderSubtle}`,
        }}
      >
        <span className="text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Iteration
        </span>
        <div
          className="flex items-center rounded overflow-visible"
          style={{ border: '1px solid #bdd0ef', height: 28 }}
        >
          <button
            disabled={selectedIndex <= 0}
            onClick={() => move(-1)}
            className="h-full px-2 flex items-center cursor-pointer hover:bg-[#f0f4fb] disabled:cursor-not-allowed disabled:opacity-40"
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
              className="h-full flex cursor-pointer items-center gap-3 px-3 text-left bg-white hover:bg-[#f7f9fc]"
              style={{ minWidth: 280, color: BRAND.textPrimary }}
            >
              <span className="text-[12px] font-semibold whitespace-nowrap">
                {selected?.name}
              </span>
              <span className="text-[11px] whitespace-nowrap" style={{ color: BRAND.textSecondary }}>
                {selected && fmtRange(selected)}
              </span>
              <ChevronDown size={12} className="ml-auto" style={{ color: BRAND.textSecondary }} />
            </button>
            {selectorOpen && (
              <div
                className="absolute left-0 top-full mt-1 w-full bg-white rounded shadow-lg z-50 py-1 max-h-72 overflow-auto"
                style={{ border: `1px solid ${BRAND.border}` }}
              >
                {iterations.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => {
                      setSelectedId(it.id)
                      setSelectorOpen(false)
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f4f6f9]"
                    style={{
                      backgroundColor:
                        selectedId === it.id ? '#edf2fb' : 'transparent',
                    }}
                  >
                    <span
                      className="text-[12px] font-semibold flex-1"
                      style={{
                        color:
                          selectedId === it.id ? BRAND.primary : BRAND.textPrimary,
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
            className="h-full px-2 flex cursor-pointer items-center hover:bg-[#f0f4fb] disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: BRAND.primaryLight,
              borderLeft: `1px solid ${BRAND.borderSubtle}`,
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="flex-1" />
      </div>

      {/* Table */}
      <div className="flex flex-col flex-1 overflow-auto" style={{ backgroundColor: BRAND.surface }}>
        {/* Header row (P3-TS-FR-010) */}
        <div
          className="sticky top-0 z-10 flex items-center h-8 px-3 select-none text-[11px] font-semibold"
          style={{
            backgroundColor: BRAND.surfaceHover,
            borderBottom: `1px solid ${BRAND.borderSubtle}`,
            color: BRAND.textMuted,
          }}
        >
          <div className="w-6 shrink-0" /> {/* Expand/collapse */}
          <div className="w-20 shrink-0">ID</div>
          <div className="flex-1 min-w-[180px]">Task Name</div>
          <div className="w-36 shrink-0">Work Product</div>
          <div className="w-24 shrink-0">Release</div>
          <div className="w-28 shrink-0">State</div>
          <div className="w-16 shrink-0 text-right">Capacity</div>
          <div className="w-16 shrink-0 text-right">Estimate</div>
          <div className="w-14 shrink-0 text-right">To Do</div>
          <div className="w-14 shrink-0 text-right">Actuals</div>
          <div className="w-24 shrink-0">Owner</div>
        </div>

        {/* Totals row (P3-TS-FR-013) */}
        {totals && (
          <div
            className="flex items-center h-7 px-3 text-[11px] font-semibold"
            style={{
              backgroundColor: '#f4f6f9',
              borderBottom: `1px solid ${BRAND.borderSubtle}`,
              color: BRAND.textSecondary,
            }}
          >
            <div className="w-6 shrink-0" />
            <div className="w-20 shrink-0" />
            <div className="flex-1 min-w-[180px]">Totals</div>
            <div className="w-36 shrink-0" />
            <div className="w-24 shrink-0" />
            <div className="w-28 shrink-0" />
            <div className="w-16 shrink-0 text-right font-mono tabular-nums">
              {totals.capacityHours}
            </div>
            <div className="w-16 shrink-0 text-right font-mono tabular-nums">
              {totals.estimateHours}
            </div>
            <div className="w-14 shrink-0 text-right font-mono tabular-nums">
              {totals.todoHours}
            </div>
            <div className="w-14 shrink-0 text-right font-mono tabular-nums">
              {totals.actualHours}
            </div>
            <div className="w-24 shrink-0" />
          </div>
        )}

        {/* Loading */}
        {isLoading && <SkeletonList rows={10} cols={10} />}

        {/* Error */}
        {!isLoading && isError && (
          <div className="h-40 flex items-center justify-center text-[12px]" style={{ color: '#b91c1c' }}>
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
              teamId={teamId!}
              iterationId={selectedId!}
              canEdit={canEdit}
              onOpenTask={(task) =>
                navigate({ to: '/item/$itemKey', params: { itemKey: task.taskKey } })
              }
            />
          ))}

        {/* Empty state (P3-TS-TS-020) */}
        {!isLoading && !isError && groups.length === 0 && (
          <div className="h-40 flex items-center justify-center text-[12px]" style={{ color: BRAND.textMuted }}>
            No tasks assigned to this iteration
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
  onOpenTask,
}: {
  group: TeamStatusMemberGroup
  projectId: string
  teamId: string
  iterationId: string
  canEdit: boolean
  onOpenTask: (task: TeamStatusTaskRow) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const updateCapacity = useUpdateCapacity(projectId, teamId, iterationId)
  const [editingCapacity, setEditingCapacity] = useState(false)
  const [capacityVal, setCapacityVal] = useState(String(group.capacityHours))

  function saveCapacity() {
    const val = Number(capacityVal)
    if (isNaN(val) || val < 0) {
      toast.error('Capacity must be a number >= 0')
      setCapacityVal(String(group.capacityHours))
      setEditingCapacity(false)
      return
    }
    updateCapacity.mutate(
      { userId: group.owner.id, capacityHours: val },
      {
        onSuccess: () => {
          setEditingCapacity(false)
          toast.success(`Capacity updated for ${group.owner.displayName}`)
        },
        onError: (e) => {
          toast.error(e.message)
          setCapacityVal(String(group.capacityHours))
        },
      },
    )
  }

  return (
    <div>
      {/* Group header row (P3-TS-FR-015) */}
      <div
        className="flex items-center h-9 px-3 cursor-pointer hover:bg-[#f9fafb]"
        style={{
          backgroundColor: '#f7f8fa',
          borderBottom: `1px solid ${BRAND.borderInner}`,
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Expand/collapse — arrow only, no bordered square (P3-TS-FR-016) */}
        <div className="w-6 shrink-0 flex items-center justify-center">
          {expanded ? (
            <ArrowDown size={12} style={{ color: BRAND.textSecondary }} />
          ) : (
            <ArrowRight size={12} style={{ color: BRAND.textSecondary }} />
          )}
        </div>
        <div className="w-20 shrink-0" /> {/* ID column spacer */}
        {/* Owner info */}
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Avatar name={group.owner.displayName} src={group.owner.avatarUrl} size={20} />
          <span className="text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
            {group.owner.displayName}
          </span>
          <span className="text-[10px]" style={{ color: BRAND.textMuted }}>
            ({group.taskCount} tasks)
          </span>
          {/* Progress bar */}
          <div
            className="w-16 h-1.5 rounded-full overflow-hidden ml-2"
            style={{ backgroundColor: '#e4e8ed' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${group.progressPercent}%`,
                backgroundColor:
                  group.progressPercent >= 70 ? '#2a8c3f' : BRAND.primaryLight,
              }}
            />
          </div>
          <span className="text-[10px] tabular-nums" style={{ color: BRAND.textSecondary }}>
            {group.progressPercent}%
          </span>
        </div>
        <div className="w-36 shrink-0" />
        <div className="w-24 shrink-0" />
        <div className="w-28 shrink-0" />
        {/* Capacity (editable on group row — P3-TS-FR-017) */}
        <div className="w-16 shrink-0 text-right" onClick={(e) => e.stopPropagation()}>
          {editingCapacity && canEdit ? (
            <input
              autoFocus
              value={capacityVal}
              onChange={(e) => setCapacityVal(e.target.value)}
              onBlur={saveCapacity}
              onKeyDown={(e) => e.key === 'Enter' && saveCapacity()}
              className="w-14 text-[11px] text-right font-mono px-1 py-0.5 rounded focus:outline-none"
              style={{
                border: `1px solid ${BRAND.borderInput}`,
                backgroundColor: 'white',
                color: BRAND.textPrimary,
              }}
            />
          ) : (
            <span
              className="text-[11px] font-mono tabular-nums cursor-pointer hover:underline"
              style={{ color: BRAND.textSecondary }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (canEdit) {
                  setCapacityVal(String(group.capacityHours))
                  setEditingCapacity(true)
                }
              }}
            >
              {group.capacityHours}
            </span>
          )}
        </div>
        <div className="w-16 shrink-0 text-right text-[11px] font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
          {group.estimateHours}
        </div>
        <div className="w-14 shrink-0 text-right text-[11px] font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
          {group.todoHours}
        </div>
        <div className="w-14 shrink-0 text-right text-[11px] font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
          {group.actualHours}
        </div>
        <div className="w-24 shrink-0" />
      </div>

      {/* Task rows */}
      {expanded &&
        group.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            projectId={projectId}
            teamId={teamId}
            iterationId={iterationId}
            canEdit={canEdit}
            onOpen={() => onOpenTask(task)}
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
  onOpen,
}: {
  task: TeamStatusTaskRow
  projectId: string
  teamId: string
  iterationId: string
  canEdit: boolean
  onOpen: () => void
}) {
  const updateTask = useUpdateTeamTask(projectId, teamId, iterationId)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleVal, setTitleVal] = useState(task.title)

  function saveTitle() {
    const trimmed = titleVal.trim()
    if (!trimmed) {
      toast.error('Task name must not be empty')
      setTitleVal(task.title)
      setEditingTitle(false)
      return
    }
    if (trimmed === task.title) {
      setEditingTitle(false)
      return
    }
    updateTask.mutate(
      { taskId: task.id, title: trimmed },
      {
        onSuccess: () => {
          setEditingTitle(false)
          toast.success('Task name updated')
        },
        onError: (e) => {
          toast.error(e.message)
          setTitleVal(task.title)
        },
      },
    )
  }

  function handleStateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const state = e.target.value as TeamTaskState
    updateTask.mutate(
      { taskId: task.id, state },
      {
        onSuccess: () => toast.success(`Task state updated to ${state}`),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const wpPrefix = task.workProduct.type === 'Defect' ? 'DE' : 'US'

  return (
    <div
      className="flex items-center h-8 px-3 text-[11px]"
      style={{ borderBottom: `1px solid ${BRAND.borderInner}` }}
      onClick={onOpen}
    >
      <div className="w-6 shrink-0" /> {/* Spacer for expand arrow */}
      {/* ID (P3-TS-FR-023) */}
      <button
        className="w-20 shrink-0 cursor-pointer text-left font-mono truncate hover:underline"
        style={{ color: BRAND.primaryLight }}
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
      >
        {task.taskKey}
      </button>
      {/* Task Name (P3-TS-FR-019 — inline editable) */}
      <div className="flex-1 min-w-[180px] pr-2" onClick={(e) => e.stopPropagation()}>
        {editingTitle && canEdit ? (
          <input
            autoFocus
            value={titleVal}
            onChange={(e) => setTitleVal(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
            className="w-full text-[11px] px-1 py-0.5 rounded focus:outline-none"
            style={{
              border: `1px solid ${BRAND.borderInput}`,
              backgroundColor: 'white',
              color: BRAND.textPrimary,
            }}
          />
        ) : (
          <span
            className="cursor-pointer truncate block hover:underline"
            style={{ color: BRAND.textPrimary }}
            onDoubleClick={() => {
              if (canEdit) {
                setTitleVal(task.title)
                setEditingTitle(true)
              }
            }}
            title={task.title}
          >
            {task.title}
          </span>
        )}
      </div>
      {/* Work Product (P3-TS-FR-024) */}
      <div className="w-36 shrink-0 truncate" style={{ color: BRAND.textSecondary }}>
        <span className="font-mono text-[10px]">{wpPrefix}{task.workProduct.key.replace(/\D/g, '')}: </span>
        <span className="truncate" title={task.workProduct.title}>
          {task.workProduct.title}
        </span>
      </div>
      {/* Release (P3-TS-FR-025) */}
      <div className="w-24 shrink-0 truncate" style={{ color: BRAND.textSecondary }}>
        {task.release?.name ?? ''}
      </div>
      {/* State (P3-TS-FR-021 — inline editable) */}
      <div className="w-28 shrink-0" onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <InlineSelect
            value={task.state}
            onChange={handleStateChange}
            className="text-[11px] px-1 py-0.5 rounded bg-white focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
          >
            {TEAM_TASK_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </InlineSelect>
        ) : (
          <StateBadge state={task.state} />
        )}
      </div>
      {/* Capacity (empty on task row — P3-TS-FR-024) */}
      <div className="w-16 shrink-0 text-right" />
      {/* Estimate / ToDo / Actuals (P3-TS-FR-026) */}
      <div className="w-16 shrink-0 text-right font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
        {task.estimateHours || ''}
      </div>
      <div className="w-14 shrink-0 text-right font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
        {task.todoHours || ''}
      </div>
      <div className="w-14 shrink-0 text-right font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
        {task.actualHours || ''}
      </div>
      {/* Owner */}
      <div className="w-24 shrink-0 truncate text-[11px]" style={{ color: BRAND.textSecondary }}>
        {task.owner.displayName}
      </div>
    </div>
  )
}

// ── State badge ─────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: TeamTaskState }) {
  const colors: Record<TeamTaskState, { bg: string; text: string }> = {
    'Defined': { bg: '#f0f4fb', text: BRAND.primary },
    'In-Progress': { bg: '#fff7ed', text: '#92400e' },
    'Completed': { bg: '#eaf5ed', text: '#1e6930' },
  }
  const c = colors[state] ?? colors['Defined']
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-px rounded"
      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.text}20` }}
    >
      {state}
    </span>
  )
}