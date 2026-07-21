import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus, ListChecks } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useTasks,
  useTaskTotals,
  useUpdateWorkItem,
  type WorkItem,
} from '@/features/work-items/api'
import { useProjectMembers, useProjectTeams } from '@/features/teams/api'
import { deriveEstimateHours } from '@/entities/work-item/model/task-time'
import {
  ScheduleState,
  SCHEDULE_STATE_LABEL,
  TASK_STATE_VALUES,
} from '@/entities/work-item/model/types'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { OwnerSelectCell } from '@/shared/ui/owner-cell'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { SkeletonList } from '@/shared/ui/skeleton'
import { InlineCellSelect } from '@/shared/ui/native-select'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { SelectionCheckbox } from '@/shared/ui/selection-checkbox'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'
import { useDataTable, type ColumnSpec } from '@/shared/ui/table'
import { DataTableHeader } from '@/shared/ui/data-table-header'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { AddTaskModal } from '@/features/work-items/ui/add-task-modal'

// TASK-FR-003: columns Rank, ID, Name, State, Owner, Project, Teams, To Do, Actuals, Estimate.
type TaskColKey =
  'rank' | 'id' | 'name' | 'state' | 'owner' | 'project' | 'teams' | 'todo' | 'actuals' | 'estimate'

// Single per-column source of truth for the Tasks tab, driven by the shared
// useDataTable engine (identical to Projects / Team Status / Quality) so the grid
// gets resize + reorder + show/hide and a fluid name column for free — replacing
// the old fixed 1216px hand-rolled layout that overflowed the detail column.
const TASK_COLUMNS: ColumnSpec<WorkItem, unknown, TaskColKey>[] = [
  { key: 'rank', label: 'Rank', defaultWidth: 60, minWidth: 52, locked: true, sortCol: 'rank' },
  { key: 'id', label: 'ID', defaultWidth: 108, minWidth: 90, locked: true, sortCol: 'id' },
  { key: 'name', label: 'Name', defaultWidth: 240, minWidth: 150, locked: true, sortCol: 'name' },
  { key: 'state', label: 'State', defaultWidth: 132, minWidth: 110, sortCol: 'state' },
  { key: 'owner', label: 'Owner', defaultWidth: 150, minWidth: 120, sortCol: 'owner' },
  { key: 'project', label: 'Project', defaultWidth: 110 },
  { key: 'teams', label: 'Teams', defaultWidth: 120, sortCol: 'teams' },
  { key: 'todo', label: 'To Do', defaultWidth: 72, align: 'right', sortCol: 'todo' },
  { key: 'actuals', label: 'Actuals', defaultWidth: 72, align: 'right', sortCol: 'actuals' },
  { key: 'estimate', label: 'Estimate', defaultWidth: 80, align: 'right', sortCol: 'estimate' },
]

export function TasksTab({
  workItemId,
  projectId,
  readOnly,
}: {
  workItemId: string
  projectId: string
  readOnly: boolean
}) {
  const { data: tasks = [], isLoading } = useTasks(workItemId)
  const { data: totals } = useTaskTotals(workItemId)
  // Row selection (shared pattern with Backlog / Iteration Status): the header
  // checkbox selects every task, each row toggles itself.
  const selection = useRowSelection(tasks)
  // Tasks inherit their parent's project; team/owner names are resolved for display.
  const { data: teams = [] } = useProjectTeams(projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const { project } = useAppContext()
  const projectLabel = project?.projectKey ?? project?.projectName ?? '—'
  const [showAdd, setShowAdd] = useState(false)
  const navigate = useNavigate()

  // Shared table engine (identical to Projects / Team Status): resize + reorder +
  // show/hide, with the name column flexing to fill and all others width-pinned.
  const table = useDataTable<WorkItem, unknown, TaskColKey>(TASK_COLUMNS, {
    storageKey: STORAGE_KEYS.WORK_ITEM_TASKS_COLUMNS,
    leadingWidth: 24,
  })
  const colStyles = useMemo(
    () =>
      Object.fromEntries(
        TASK_COLUMNS.map((c) => [
          c.key,
          table.styleFor(c.key, c.key === 'name' ? { flex: 1, minWidth: 150 } : { flexShrink: 0 }),
        ]),
      ) as Record<TaskColKey, CSSProperties>,
    [table],
  )

  const teamName = (id?: string | null) =>
    id ? (teams.find((t) => t.id === id)?.name ?? '—') : '—'

  // Client-side column sort — mirrors the shared header UX used by every other
  // grid (Backlog / Team Status / Projects). `null` = the default rank order.
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const toggleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortCol(col)
        setSortDir('asc')
      }
    },
    [sortCol],
  )

  const sortedTasks = useMemo(() => {
    if (!sortCol) return tasks
    const factor = sortDir === 'asc' ? 1 : -1
    const numeric = sortCol === 'todo' || sortCol === 'actuals' || sortCol === 'estimate'
    const value = (t: WorkItem): string | number => {
      switch (sortCol) {
        case 'rank':
          return t.rank ?? ''
        case 'id':
          return t.itemKey
        case 'name':
          return t.title.toLowerCase()
        case 'state':
          return t.scheduleState
        case 'owner': {
          const m = members.find((mm) => mm.userId === t.assigneeId)
          return (m?.displayName ?? m?.email ?? '').toLowerCase()
        }
        case 'teams': {
          const tm = teams.find((x) => x.id === t.teamId)
          return (tm?.name ?? '').toLowerCase()
        }
        case 'todo':
          return Number(t.todoHours ?? 0)
        case 'actuals':
          return Number(t.actualHours ?? 0)
        case 'estimate':
          return Number(t.estimateHours ?? 0)
        default:
          return ''
      }
    }
    return [...tasks].sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      if (numeric) return ((av as number) - (bv as number)) * factor
      return String(av).localeCompare(String(bv)) * factor
    })
  }, [tasks, sortCol, sortDir, members, teams])

  function openTask(task: WorkItem) {
    void navigate({ to: '/item/$itemKey', params: { itemKey: task.itemKey } })
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[20px] font-semibold" style={{ color: BRAND.textPrimary }}>
            Tasks
          </h2>
          <p className="mt-1 text-[11px]" style={{ color: BRAND.textSecondary }}>
            Break this work item into trackable delivery tasks.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} />
          Add Task
        </Button>
      </div>

      <div
        className="overflow-x-auto rounded bg-white"
        style={{ border: `1px solid ${BRAND.border}` }}
      >
        {/* Header row (shared engine: resize + reorder + show/hide) */}
        <DataTableHeader
          columns={table.headerColumns}
          colStyles={colStyles}
          onResize={table.startResize}
          columnDrag={table.columnDrag}
          sort={{ col: sortCol, dir: sortDir, onSort: toggleSort }}
          leading={
            <div className="flex w-6 shrink-0 items-center justify-center">
              <SelectionCheckbox
                checked={selection.allSelected}
                indeterminate={selection.someSelected}
                onChange={selection.toggleAll}
                ariaLabel="Select all tasks"
              />
            </div>
          }
          className="px-3"
        />

        {/* Totals row (shared component — single source of truth for layout) */}
        {totals && (
          <TableTotalsRow
            columns={TASK_COLUMNS}
            colStyles={colStyles}
            leading={<div className="w-6 shrink-0" />}
            label="Totals"
            values={{
              todo: `${totals.todoHours ?? 0}h`,
              actuals: `${totals.actualHours ?? 0}h`,
              estimate: `${totals.estimateHours ?? 0}h`,
            }}
          />
        )}

        {/* Body */}
        {isLoading ? (
          <SkeletonList rows={4} cols={10} />
        ) : tasks.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<ListChecks size={28} className="text-foreground-subtle" />}
            title="No tasks yet"
            description="Break this work item into trackable delivery tasks."
            action={
              readOnly ? undefined : (
                <Button size="sm" onClick={() => setShowAdd(true)}>
                  <Plus size={13} />
                  Add Task
                </Button>
              )
            }
          />
        ) : (
          sortedTasks.map((task) => (
            <TaskRow
              key={`${task.id}:${task.updatedAt}`}
              task={task}
              canEdit={!readOnly}
              selected={selection.isSelected(task.id)}
              onToggleSelect={() => selection.toggle(task.id)}
              colStyles={colStyles}
              projectLabel={projectLabel}
              teamName={teamName}
              members={members}
              onOpen={openTask}
            />
          ))
        )}
      </div>

      {showAdd && <AddTaskModal workItemId={workItemId} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// Inline-editable Tasks-tab row (DEV-014): Name / State / Owner / To Do / Actuals
// are edited in place with the shared cell primitives (InlineEditableCell /
// InlineCellSelect / OwnerSelectCell — identical to the Team Status task grid);
// Estimate is read-only derived (To Do + Actuals). Each edit invalidates the
// ['work-items'] root, so the totals row and parent roll-up recompute immediately.
// The row key includes `updatedAt` so committed values re-sync after a refresh.
function TaskRow({
  task,
  canEdit,
  colStyles,
  projectLabel,
  teamName,
  members,
  onOpen,
  selected,
  onToggleSelect,
}: {
  task: WorkItem
  canEdit: boolean
  colStyles: Record<TaskColKey, CSSProperties>
  projectLabel: string
  teamName: (id?: string | null) => string
  members: { userId: string; displayName?: string | null; email?: string | null }[]
  onOpen: (task: WorkItem) => void
  selected: boolean
  onToggleSelect: () => void
}) {
  const update = useUpdateWorkItem(task.id)

  const commitTitle = (raw: string) => {
    const next = raw.trim()
    if (next && next !== task.title) void update.mutateAsync({ title: next })
  }
  const commitHours = (field: 'todoHours' | 'actualHours', raw: string) => {
    const next = raw.trim() === '' ? null : Number(raw)
    if (next != null && (Number.isNaN(next) || next < 0)) return
    const current = task[field] != null ? Number(task[field]) : null
    if (next !== current) void update.mutateAsync({ [field]: next })
  }

  const owner = members.find((m) => m.userId === task.assigneeId)
  const ownerName = owner ? (owner.displayName ?? owner.email ?? null) : null

  const numInput =
    'w-16 rounded border border-input bg-white px-1 py-0.5 text-right font-mono text-[12px] focus:outline-none'

  return (
    <div
      className="flex min-h-[36px] items-center bg-white px-3 text-[12px] transition-colors hover:bg-primary-lighter"
      style={{
        borderBottom: `1px solid ${BRAND.borderInner}`,
        color: BRAND.textPrimary,
        minWidth: 'max-content',
      }}
    >
      <div className="flex w-6 shrink-0 items-center justify-center">
        <SelectionCheckbox
          checked={selected}
          onChange={onToggleSelect}
          ariaLabel={`Select task ${task.itemKey}`}
        />
      </div>
      {/* Rank */}
      <div
        className="shrink-0 px-2 font-mono text-[11px]"
        style={{ ...colStyles.rank, color: BRAND.textSecondary }}
      >
        {task.rank ?? '—'}
      </div>
      {/* ID */}
      <div className="flex shrink-0 items-center overflow-hidden px-2" style={colStyles.id}>
        <IdCell type={task.type} itemKey={task.itemKey} onOpen={() => onOpen(task)} />
      </div>
      {/* Name — inline editable */}
      <div className="min-w-[150px] flex-1 px-2" style={colStyles.name}>
        <InlineEditableCell
          value={task.title}
          canEdit={canEdit}
          onCommit={commitTitle}
          className="block truncate text-[12px] font-medium"
          style={{ color: BRAND.textPrimary, cursor: 'text' }}
          inputClassName="w-full rounded px-1 py-0.5 text-[12px] focus:outline-none"
          inputStyle={{
            border: `1px solid ${BRAND.accentBorderStrong}`,
            color: BRAND.textPrimary,
          }}
          title={task.title}
          ariaLabel={`Task ${task.itemKey} name`}
        />
      </div>
      {/* State — single Task State (BR-TASK-01) */}
      <div className="shrink-0 px-2" style={colStyles.state}>
        <InlineCellSelect
          value={task.scheduleState}
          displayValue={
            SCHEDULE_STATE_LABEL[task.scheduleState as ScheduleState] ?? task.scheduleState
          }
          disabled={!canEdit}
          aria-label={`Task ${task.itemKey} state`}
          onChange={(e) => update.mutateAsync({ scheduleState: e.target.value as ScheduleState })}
        >
          {TASK_STATE_VALUES.map((s) => (
            <option key={s} value={s}>
              {SCHEDULE_STATE_LABEL[s]}
            </option>
          ))}
        </InlineCellSelect>
      </div>
      {/* Owner */}
      <div className="flex shrink-0 items-center overflow-hidden px-2" style={colStyles.owner}>
        <OwnerSelectCell
          ownerName={ownerName}
          assigneeId={task.assigneeId}
          members={members}
          canEdit={canEdit}
          onChange={(userId) => update.mutateAsync({ assigneeId: userId })}
          ariaLabel={`Task ${task.itemKey} owner`}
        />
      </div>
      {/* Project */}
      <div
        className="shrink-0 truncate px-2"
        style={{ ...colStyles.project, color: BRAND.textSecondary }}
      >
        {projectLabel}
      </div>
      {/* Teams */}
      <div
        className="shrink-0 truncate px-2"
        style={{ ...colStyles.teams, color: BRAND.textSecondary }}
      >
        {teamName(task.teamId)}
      </div>
      {/* To Do — inline editable */}
      <div className="shrink-0 px-2 text-right" style={colStyles.todo}>
        <InlineEditableCell
          value={task.todoHours != null ? String(task.todoHours) : ''}
          canEdit={canEdit}
          onCommit={(v) => commitHours('todoHours', v)}
          displayValue={task.todoHours ?? '—'}
          className="font-mono tabular-nums hover:underline"
          style={{ color: BRAND.textSecondary }}
          inputClassName={numInput}
          ariaLabel={`Task ${task.itemKey} to do hours`}
        />
      </div>
      {/* Actuals — inline editable */}
      <div className="shrink-0 px-2 text-right" style={colStyles.actuals}>
        <InlineEditableCell
          value={task.actualHours != null ? String(task.actualHours) : ''}
          canEdit={canEdit}
          onCommit={(v) => commitHours('actualHours', v)}
          displayValue={task.actualHours ?? '—'}
          className="font-mono tabular-nums hover:underline"
          style={{ color: BRAND.textSecondary }}
          inputClassName={numInput}
          ariaLabel={`Task ${task.itemKey} actual hours`}
        />
      </div>
      {/* Estimate — read-only derived (To Do + Actuals) */}
      <div
        className="shrink-0 px-2 text-right font-mono text-[11px]"
        style={{ ...colStyles.estimate, color: BRAND.textSecondary }}
        title="Estimate is derived: To Do + Actuals"
      >
        {deriveEstimateHours(task.todoHours, task.actualHours)}h
      </div>
    </div>
  )
}

// ── Revision History tab ──────────────────────────────────────────────────────
