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
import { ChevronDown, ChevronRight, Inbox } from 'lucide-react'
import { EmptyState } from '@/shared/ui/empty-state'
import { WorkItemRefCell } from '@/entities/work-item/ui/work-item-ref-cell'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useIterations } from '@/features/iterations/api'
import {
  useTeamStatus,
  useUpdateCapacity,
  useUpdateTeamTask,
  type TeamStatusMemberGroup,
  type TeamStatusTaskRow,
  type TeamTaskState,
} from '@/features/team-status/api'
import { Avatar } from '@/shared/ui/avatar'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { InlineSelect } from '@/shared/ui/native-select'
import { ListPageHeader } from '@/shared/ui/list-page/list-page-header'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { IterationPicker } from '@/shared/ui/iteration-picker'
import { DataTableFrame, useDataTable, type ColumnSpec } from '@/shared/ui/table'
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
import { TableTotalsRow } from '@/shared/ui/table-totals-row'

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

const TEAM_STATUS_COLUMNS: ColumnSpec<TeamStatusTaskRow, unknown, ColKey>[] = [
  { key: 'rank', label: 'Rank', defaultWidth: 60, minWidth: 56, locked: true },
  { key: 'id', label: 'ID', defaultWidth: 132, minWidth: 120, locked: true },
  { key: 'name', label: 'Task Name', defaultWidth: 240, minWidth: 150, locked: true },
  { key: 'workProduct', label: 'Work Product', defaultWidth: 140 },
  { key: 'release', label: 'Release', defaultWidth: 96 },
  { key: 'state', label: 'State', defaultWidth: 112 },
  { key: 'capacity', label: 'Capacity', defaultWidth: 104, minWidth: 90, align: 'right', sortCol: 'capacity' },
  { key: 'estimate', label: 'Estimate', defaultWidth: 104, minWidth: 90, align: 'right', sortCol: 'estimate' },
  { key: 'todo', label: 'To Do', defaultWidth: 88, minWidth: 74, align: 'right', sortCol: 'todo' },
  { key: 'actuals', label: 'Actuals', defaultWidth: 96, minWidth: 80, align: 'right', sortCol: 'actuals' },
  { key: 'owner', label: 'Owner', defaultWidth: 96 },
]

/**
 * Member progress bar — Rally Team Status style: a percentage label above a
 * green fill bar. The percentage is task completion (actual / estimate hours,
 * capped at 100) per Team_Status SRS §10, shown for each member group row.
 */
function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(Math.max(percent, 0), 100)
  return (
    <div className="flex w-full flex-col gap-[3px]">
      <span className="text-ui-xs leading-none font-semibold text-success tabular-nums">
        {percent}%
      </span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-subtle">
        <div className="h-full rounded-full bg-success" style={{ width: `${clamped}%` }} />
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

  // ── Shared table engine (identical to projects/releases): resize + reorder + show/hide ──
  // Must be declared before any early returns to satisfy Rules of Hooks.
  const table = useDataTable<TeamStatusTaskRow, unknown, ColKey>(TEAM_STATUS_COLUMNS, {
    storageKey: STORAGE_KEYS.TEAM_STATUS_COLUMNS,
  })

  // The name column grows to fill; all others are width-pinned by the engine.
  const colStyles = useMemo(
    () =>
      Object.fromEntries(
        TEAM_STATUS_COLUMNS.map((c) => [
          c.key,
          table.styleFor(c.key, c.key === 'name' ? { flex: 1, minWidth: 150 } : { flexShrink: 0 }),
        ]),
      ) as Record<ColKey, React.CSSProperties>,
    [table],
  )

  const { data: iterations = [] } = useIterations(projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<TeamTaskState | 'all'>('all')
  // Column sort — orders the member groups by an aggregate (Capacity / Estimate
  // / To Do / Actuals). Same click-to-sort header wiring as Iteration Status.
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const toggleSort = useCallback(
    (col: string) => {
      if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      else {
        setSortCol(col)
        setSortDir('asc')
      }
    },
    [sortCol],
  )

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
      <div className="flex flex-1 items-center justify-center text-ui-lg text-foreground-subtle">
        Select a project to view Team Status.
      </div>
    )
  }

  if (!iterations.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-ui-lg text-foreground-subtle">
        <span>No iterations in this project/team yet.</span>
        <button
          onClick={() => navigate({ to: '/timeboxes' })}
          className="cursor-pointer text-ui-md font-semibold text-primary-light hover:underline"
        >
          Go to Timeboxes →
        </button>
      </div>
    )
  }

  const totals = status?.totals
  const allGroups = status?.groups ?? []
  const q = search.trim().toLowerCase()
  const hasFilter = q !== '' || stateFilter !== 'all'
  const groups = hasFilter
    ? allGroups
        .map((g) => ({
          ...g,
          tasks: g.tasks.filter(
            (t) =>
              (stateFilter === 'all' || t.state === stateFilter) &&
              (!q ||
                t.title.toLowerCase().includes(q) ||
                t.taskKey.toLowerCase().includes(q) ||
                t.workProduct.title.toLowerCase().includes(q) ||
                t.workProduct.key.toLowerCase().includes(q)),
          ),
        }))
        .filter((g) => g.tasks.length > 0)
    : allGroups

  // Order the member groups by the active aggregate sort (Capacity / Estimate /
  // To Do / Actuals), then paginate. Plain const (runs after early returns).
  const sortAggregate = (g: (typeof groups)[number]): number =>
    sortCol === 'capacity'
      ? g.capacityHours
      : sortCol === 'estimate'
        ? g.estimateHours
        : sortCol === 'todo'
          ? g.todoHours
          : sortCol === 'actuals'
            ? g.actualHours
            : 0
  const sortedGroups = sortCol
    ? [...groups].sort((a, b) => (sortAggregate(a) - sortAggregate(b)) * (sortDir === 'desc' ? -1 : 1))
    : groups

  // Paginate the visible member groups (see hook block above).
  const pageCount = Math.max(1, Math.ceil(sortedGroups.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pagedGroups = sortedGroups.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Title + iteration selector (no view toggle, no KPI strip) — matches the
          Iteration Status layout via the shared ListPageHeader + IterationPicker. */}
      <ListPageHeader
        title="Team Status"
        accessory={
          <IterationPicker
            iterations={iterations}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        }
      />
      {/* Shared toolbar — search + Show Fields (same PageToolbar as Iteration Status). */}
      <PageToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search Tasks',
          ariaLabel: 'Search tasks',
          width: 220,
        }}
        activeFilterCount={stateFilter !== 'all' ? 1 : 0}
        defaultFiltersOpen={stateFilter !== 'all'}
        filters={
          <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
            State
            <InlineSelect
              value={stateFilter}
              aria-label="Filter by task state"
              onChange={(e) => setStateFilter(e.target.value as TeamTaskState | 'all')}
              className="w-auto"
            >
              <option value="all">All States</option>
              {TEAM_TASK_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </InlineSelect>
          </label>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* Table — shared DataTableFrame owns the scroll region, header, totals,
          loading/error/empty states and footer so every grid's chrome is
          identical. Team Status is a read-only report kind: sortable header +
          totals, no selection/drag gutter (just a w-6 spacer that its member
          rows also render). */}
      <DataTableFrame
        header={{
          ...table.headerProps,
          colStyles,
          sort: { col: sortCol, dir: sortDir, onSort: toggleSort },
        }}
        leading={<div className="w-6 shrink-0" />}
        totals={
          totals ? (
            <TableTotalsRow
              columns={TEAM_STATUS_COLUMNS}
              colStyles={colStyles}
              leading={<div className="w-6 shrink-0" />}
              label="Totals"
              values={{
                capacity: `${totals.capacityHours}h`,
                estimate: `${totals.estimateHours}h`,
                todo: `${totals.todoHours}h`,
                actuals: `${totals.actualHours}h`,
              }}
            />
          ) : undefined
        }
        loading={isLoading}
        skeleton={{ rows: 10, cols: 10 }}
        error={
          isError ? (
            <div className="flex h-40 items-center justify-center text-ui-md text-destructive">
              Failed to load team status. Please try again.
            </div>
          ) : undefined
        }
        empty={
          groups.length === 0 ? (
            <EmptyState
              icon={<Inbox size={36} className="text-foreground-faint" />}
              title="No tasks found for this iteration"
            />
          ) : undefined
        }
        footer={
          status ? (
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
          ) : undefined
        }
      >
        {/* Member groups (P3-TS-FR-014) */}
        {pagedGroups.map((group) => (
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
      </DataTableFrame>
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

  // The member label spans the fixed ID + Task Name columns. Match their exact
  // combined width (not flex-1) so the Capacity/Estimate/To Do/Actuals values
  // line up with the header and totals row instead of being pushed to the far
  // right by a growing flex column.
  const idNameWidth = (Number(colStyles.id?.width) || 0) + (Number(colStyles.name?.width) || 0)

  return (
    <div>
      {/* Group header row (P3-TS-FR-015) */}
      <div
        className="flex h-9 cursor-pointer items-center border-b border-border-inner bg-surface-hover px-3 hover:bg-surface-hover"
        style={{ minWidth: 'max-content' }}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Leading gutter (aligns with task-row drag/checkbox area) */}
        <div className="w-6 shrink-0" />
        <div className="shrink-0" style={colStyles.rank} /> {/* Rank column spacer */}
        {/* Member label — caret + avatar + name clustered at the ID column,
            matching Rally. Spans the ID + Task Name columns at their fixed
            combined width so downstream columns stay aligned with the header
            and totals row. Caret only renders for expandable members
            (P3-TS-FR-016). */}
        <div
          className="flex min-w-0 items-center gap-2 pl-2"
          style={{
            order: colStyles.id.order,
            width: idNameWidth,
            minWidth: idNameWidth,
            maxWidth: idNameWidth,
            flexShrink: 0,
            flexGrow: 0,
          }}
        >
          <span className="flex w-3 shrink-0 items-center justify-center">
            {group.taskCount > 0 &&
              (expanded ? (
                <ChevronDown size={12} className="text-muted-foreground" />
              ) : (
                <ChevronRight size={12} className="text-muted-foreground" />
              ))}
          </span>
          <Avatar name={group.owner.displayName} size={20} />
          <span className="truncate text-ui-sm font-semibold text-foreground">
            {group.owner.displayName}
          </span>
          <span className="shrink-0 text-ui-xs text-foreground-subtle">
            ({group.taskCount} Tasks)
          </span>
        </div>
        <div className="shrink-0" style={colStyles.workProduct} />
        <div className="shrink-0" style={colStyles.release} />
        {/* State column shows the member task-completion progress bar. */}
        <div className="flex shrink-0 flex-col justify-center px-2" style={colStyles.state}>
          <ProgressBar percent={group.progressPercent} />
        </div>
        {/* Capacity (editable on group row — P3-TS-FR-017) */}
        <div
          className="shrink-0 px-2 text-right"
          style={colStyles.capacity}
          onClick={(e) => e.stopPropagation()}
        >
          <InlineEditableCell
            value={String(group.capacityHours)}
            canEdit={canEdit}
            onCommit={commitCapacity}
            trigger="dblclick"
            className="font-mono text-ui-sm text-muted-foreground tabular-nums hover:underline"
            inputClassName="w-12 rounded border border-input bg-card px-1 py-0.5 text-right font-mono text-ui-sm text-foreground focus:outline-none"
            ariaLabel="Capacity"
          />
        </div>
        <div
          className="shrink-0 px-2 text-right font-mono text-ui-sm text-muted-foreground tabular-nums"
          style={colStyles.estimate}
        >
          {group.estimateHours}
        </div>
        <div
          className="shrink-0 px-2 text-right font-mono text-ui-sm text-muted-foreground tabular-nums"
          style={colStyles.todo}
        >
          {group.todoHours}
        </div>
        <div
          className="shrink-0 px-2 text-right font-mono text-ui-sm text-muted-foreground tabular-nums"
          style={colStyles.actuals}
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
  canEdit,
  colStyles,
  members,
  onOpenItem,
}: {
  task: TeamStatusTaskRow
  canEdit: boolean
  colStyles: Record<string, React.CSSProperties>
  members: ProjectMember[]
  onOpenItem: (itemKey: string) => void
}) {
  const updateTask = useUpdateTeamTask()

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
      className="flex min-h-[34px] items-center border-b border-border-inner bg-card px-3 text-ui-sm transition-colors duration-100 hover:bg-primary-lighter"
      style={{ minWidth: 'max-content' }}
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
          className="block break-words whitespace-normal text-foreground hover:underline"
          inputClassName="w-full rounded border border-input bg-card px-1 py-0.5 text-ui-sm text-foreground focus:outline-none"
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
          <span className="text-ui-xs text-foreground-faint">—</span>
        )}
      </div>
      {/* Release (P3-TS-FR-025) */}
      <div className="shrink-0 truncate px-2 text-muted-foreground" style={colStyles.release}>
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
          className="font-mono text-muted-foreground tabular-nums"
          inputClassName="w-full rounded border border-input bg-card px-1 py-0.5 text-right font-mono text-ui-sm text-foreground focus:outline-none"
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
          className="font-mono text-muted-foreground tabular-nums"
          inputClassName="w-full rounded border border-input bg-card px-1 py-0.5 text-right font-mono text-ui-sm text-foreground focus:outline-none"
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
          className="font-mono text-muted-foreground tabular-nums"
          inputClassName="w-full rounded border border-input bg-card px-1 py-0.5 text-right font-mono text-ui-sm text-foreground focus:outline-none"
          ariaLabel="Actual hours"
        />
      </div>
      {/* Owner + Dev Owner (UI-only alias — both write assigneeId) */}
      <div
        className="shrink-0 truncate px-2 text-ui-sm"
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
