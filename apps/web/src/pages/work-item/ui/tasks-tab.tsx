import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Plus, ListChecks } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { toast } from 'sonner'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import {
  useTasks,
  useTaskTotals,
  useUpdateWorkItem,
  useCreateTask,
  useRankAnyWorkItem,
  type WorkItem,
} from '@/features/work-items/api'
import { BRAND } from '@/shared/config/brand'
import { BulkDeleteCopy } from '@/features/work-items/ui/bulk-delete-copy'
import { useProjectMembers, useProjectTeams } from '@/features/teams/api'
import { deriveEstimateHours } from '@/entities/work-item/model/task-time'
import {
  ScheduleState,
  getSimplifiedState,
  SIMPLIFIED_STATE_TO_SCHEDULE_STATE,
} from '@/entities/work-item/model/types'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SIMPLIFIED_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import { OwnerSelectCell } from '@/shared/ui/owner-cell'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { RowGutter } from '@/shared/ui/row-gutter'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'
import { useDataTable, SelectableTable, useRowRerank, type ColumnSpec } from '@/shared/ui/table'
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
  const { t } = useTranslation('work-items')
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

  // ── Bulk actions: Delete + Copy (shared BulkDeleteCopy). `copySelected` is
  //    defined below, after `sortedTasks` it reads. ──
  const createTask = useCreateTask(workItemId)

  // Shared table engine (identical to Projects / Team Status): resize + reorder +
  // show/hide, with the name column flexing to fill and all others width-pinned.
  const table = useDataTable<WorkItem, unknown, TaskColKey>(TASK_COLUMNS, {
    storageKey: STORAGE_KEYS.WORK_ITEM_TASKS_COLUMNS,
    leadingWidth: 48,
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
    id ? (teams.find((team) => team.id === id)?.name ?? '—') : '—'

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
    const value = (wi: WorkItem): string | number => {
      switch (sortCol) {
        case 'rank':
          return wi.rank ?? ''
        case 'id':
          return wi.itemKey
        case 'name':
          return wi.title.toLowerCase()
        case 'state':
          return wi.scheduleState
        case 'owner': {
          const m = members.find((mm) => mm.userId === wi.assigneeId)
          return (m?.displayName ?? m?.email ?? '').toLowerCase()
        }
        case 'teams': {
          const tm = teams.find((x) => x.id === wi.teamId)
          return (tm?.name ?? '').toLowerCase()
        }
        case 'todo':
          return Number(wi.todoHours ?? 0)
        case 'actuals':
          return Number(wi.actualHours ?? 0)
        case 'estimate':
          return Number(wi.estimateHours ?? 0)
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

  // Drag-to-rerank (shared engine). Disabled while a non-rank column sort is
  // active (order detaches from rank) or in read-only mode. Persists via the
  // neighbour-based rank endpoint (works for tasks now that findByIds resolves
  // task rows).
  const rankMutation = useRankAnyWorkItem()
  const rerank = useRowRerank({
    items: sortedTasks,
    disabled: sortCol !== null || readOnly,
    onReorder: ({ id, beforeId, afterId }) =>
      rankMutation.mutate(
        {
          id,
          projectId,
          beforeId: beforeId ?? undefined,
          afterId: afterId ?? undefined,
        },
        { onError: (e) => toast.error(e.message) },
      ),
  })

  // Copy = duplicate the single selected task (defined here, after sortedTasks
  // it reads, so the memo above stays compiler-optimizable).
  async function copySelected() {
    const src = sortedTasks.find((task) => selection.selectedIds.has(task.id))
    if (!src) return
    try {
      await createTask.mutateAsync({
        title: `${src.title} (copy)`,
        ...(src.todoHours != null ? { todoHours: Number(src.todoHours) } : {}),
        ...(src.actualHours != null ? { actualHours: Number(src.actualHours) } : {}),
      })
      selection.clear()
      toast.success('Task copied')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Copy failed')
    }
  }

  function openTask(task: WorkItem) {
    void navigate({ to: '/item/$itemKey', params: { itemKey: task.itemKey } })
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t('tasks.heading')}</h2>
          <p className="mt-1 text-ui-sm text-muted-foreground">{t('tasks.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={13} />
          {t('tasks.add')}
        </Button>
      </div>

      {/* Shared SelectableTable owns selection + header select-all gutter +
          BulkActionBar (Set State) + chrome — identical shell as the other
          complex grids. */}
      <SelectableTable
        className="rounded border border-border-strong"
        rows={rerank.items}
        selection={selection}
        selectAllAriaLabel="Select all tasks"
        headerProps={{
          columns: table.headerColumns,
          colStyles,
          onResize: table.startResize,
          columnDrag: table.columnDrag,
        }}
        sort={{ col: sortCol, dir: sortDir, onSort: toggleSort }}
        dnd={{
          dndContextProps: rerank.dndContextProps,
          sortableContextProps: rerank.sortableContextProps,
        }}
        bulkActions={(sel) =>
          readOnly ? null : (
            <BulkDeleteCopy
              selection={sel}
              projectId={projectId}
              onCopy={copySelected}
              copyPending={createTask.isPending}
            />
          )
        }
        totals={
          totals ? (
            <TableTotalsRow
              columns={TASK_COLUMNS}
              colStyles={colStyles}
              leading={<RowGutter dragDisabled />}
              label={t('tasks.totals')}
              values={{
                todo: `${totals.todoHours ?? 0}h`,
                actuals: `${totals.actualHours ?? 0}h`,
                estimate: `${totals.estimateHours ?? 0}h`,
              }}
            />
          ) : undefined
        }
        loading={isLoading}
        skeleton={{ rows: 4, cols: 10 }}
        empty={
          tasks.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<ListChecks size={28} className="text-foreground-subtle" />}
              title={t('tasks.emptyTitle')}
              description={t('tasks.subtitle')}
              action={
                readOnly ? undefined : (
                  <Button size="sm" onClick={() => setShowAdd(true)}>
                    <Plus size={13} />
                    {t('tasks.add')}
                  </Button>
                )
              }
            />
          ) : undefined
        }
        renderRow={(task, { selected, onToggleSelect }) => (
          <TaskRow
            key={`${task.id}:${task.updatedAt}`}
            task={task}
            rowNum={rerank.items.indexOf(task) + 1}
            canEdit={!readOnly}
            dragDisabled={sortCol !== null || readOnly}
            selected={selected}
            onToggleSelect={onToggleSelect}
            colStyles={colStyles}
            projectLabel={projectLabel}
            teamName={teamName}
            members={members}
            onOpen={openTask}
          />
        )}
      />

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
  rowNum,
  canEdit,
  dragDisabled,
  colStyles,
  projectLabel,
  teamName,
  members,
  onOpen,
  selected,
  onToggleSelect,
}: {
  task: WorkItem
  rowNum: number
  canEdit: boolean
  dragDisabled: boolean
  colStyles: Record<TaskColKey, CSSProperties>
  projectLabel: string
  teamName: (id?: string | null) => string
  members: { userId: string; displayName?: string | null; email?: string | null }[]
  onOpen: (task: WorkItem) => void
  selected: boolean
  onToggleSelect: () => void
}) {
  const update = useUpdateWorkItem(task.id)
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: dragDisabled })

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
    'w-16 rounded border border-input bg-card px-1 py-0.5 text-right font-mono text-ui-md focus:outline-none'

  return (
    <div
      ref={setNodeRef}
      className="group flex min-h-[36px] items-center border-b border-border-inner bg-card px-3 text-ui-md text-foreground transition-colors hover:bg-primary-lighter"
      style={{
        minWidth: 'max-content',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        backgroundColor: isDragging ? BRAND.primaryLighter : undefined,
        zIndex: isDragging ? 1 : undefined,
        position: isDragging ? 'relative' : undefined,
      }}
      {...(dragDisabled ? {} : attributes)}
    >
      <RowGutter
        ref={setActivatorNodeRef}
        dragListeners={dragDisabled ? undefined : listeners}
        dragDisabled={dragDisabled}
        stopPropagation
        checkbox={{
          checked: selected,
          onChange: onToggleSelect,
          ariaLabel: `Select task ${task.itemKey}`,
        }}
      />
      {/* Rank — sequential position in the current order (not the raw LexoRank). */}
      <div
        className="shrink-0 px-2 text-right font-mono text-ui-sm text-muted-foreground tabular-nums"
        style={colStyles.rank}
      >
        {rowNum}
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
          className="block break-words whitespace-normal text-ui-md font-medium text-foreground"
          style={{ cursor: 'text' }}
          inputClassName="w-full rounded border border-accent-border-strong px-1 py-0.5 text-ui-md text-foreground focus:outline-none"
          title={task.title}
          ariaLabel={`Task ${task.itemKey} name`}
        />
      </div>
      {/* State — simplified Task State stepper (shared control; BR-TASK-01) */}
      <div className="flex shrink-0 items-center px-2" style={colStyles.state}>
        <StateStepper
          steps={SIMPLIFIED_STATE_STEPS}
          value={SIMPLIFIED_STATE_TO_SCHEDULE_STATE[getSimplifiedState(task.scheduleState as ScheduleState)]}
          canEdit={canEdit}
          onChange={(next) => update.mutateAsync({ scheduleState: next })}
          ariaLabel={`Task ${task.itemKey} state`}
        />
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
      <div className="shrink-0 truncate px-2 text-muted-foreground" style={colStyles.project}>
        {projectLabel}
      </div>
      {/* Teams */}
      <div className="shrink-0 truncate px-2 text-muted-foreground" style={colStyles.teams}>
        {teamName(task.teamId)}
      </div>
      {/* To Do — inline editable */}
      <div className="shrink-0 px-2 text-right" style={colStyles.todo}>
        <InlineEditableCell
          value={task.todoHours != null ? String(task.todoHours) : ''}
          canEdit={canEdit}
          onCommit={(v) => commitHours('todoHours', v)}
          displayValue={task.todoHours ?? '—'}
          className="font-mono text-muted-foreground tabular-nums hover:underline"
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
          className="font-mono text-muted-foreground tabular-nums hover:underline"
          inputClassName={numInput}
          ariaLabel={`Task ${task.itemKey} actual hours`}
        />
      </div>
      {/* Estimate — read-only derived (To Do + Actuals) */}
      <div
        className="shrink-0 px-2 text-right font-mono text-ui-sm text-muted-foreground"
        style={colStyles.estimate}
        title="Estimate is derived: To Do + Actuals"
      >
        {deriveEstimateHours(task.todoHours, task.actualHours)}h
      </div>
    </div>
  )
}

// ── Revision History tab ──────────────────────────────────────────────────────
