/**
 * Track › Iteration Status — Azure DevOps-style layout
 *
 * Tracking view over the work items assigned to one selected iteration:
 * a single page header (title + iteration selector prev/next + dropdown + view
 * toggle), a metric strip (from the backend read-model), and an editable
 * work-item list. Sourced from /v1/iterations/:id/status.
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useMemo, useState, useCallback, useEffect } from 'react'
import { useColumnLayout, type ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { useColumnDrag } from '@/shared/lib/hooks/use-column-drag'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { DataTableHeader, type DataTableHeaderColumn } from '@/shared/ui/data-table-header'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { OwnerCell, OwnerSelectCell } from '@/shared/ui/owner-cell'
import { DragHandle } from '@/shared/ui/drag-handle'
import { MetricCard } from '@/shared/ui/metric-card'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  Bug,
  ListChecks,
  BarChart3,
  Trash2,
} from 'lucide-react'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { SkeletonList } from '@/shared/ui/skeleton'
import { BRAND } from '@/shared/config/brand'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { InlineSelect } from '@/shared/ui/native-select'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { BulkActionBar } from '@/shared/ui/bulk-action-bar'
import { SelectionCheckbox } from '@/shared/ui/selection-checkbox'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import {
  useIterations,
  useIterationStatus,
  useCreateIterationItem,
  type Iteration,
  type IterationStatusItem,
} from '@/features/iterations/api'
import {
  useUpdateWorkItem,
  useUpdateAnyWorkItem,
  useDeleteWorkItem,
  useBulkAssignIteration,
  useTasks,
  useRankAnyWorkItem,
  type WorkItem,
} from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import {
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  ScheduleState,
  getSimplifiedState,
  SIMPLIFIED_STATE_TO_SCHEDULE_STATE,
} from '@/entities/work-item/model/types'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS, SIMPLIFIED_STATE_STEPS } from '@/entities/work-item/ui/state-steps'

// ── Accent palette (Rally navy brand; neutral Azure-style layout kept) ──────
const AZ = {
  primary: '#1d3f73',
  primaryHover: '#162d56',
  primaryLight: '#edf2fb',
  textPrimary: '#1a1a1a',
  textSecondary: '#666666',
  textMuted: '#999999',
  bg: '#ffffff',
  bgHeader: '#f4f4f4',
  bgAlt: '#f8f8f8',
  border: '#e8e8e8',
  borderLight: '#eeeeee',
  font: "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Roboto', sans-serif",
}

// Single-letter badge for each schedule state (read-only view)
// ── Helpers ────────────────────────────────────────────────────────────────

type ColKey =
  | 'rank'
  | 'id'
  | 'name'
  | 'feature'
  | 'state'
  | 'block'
  | 'blockedReason'
  | 'planEstimate'
  | 'taskEstimate'
  | 'toDo'
  | 'tasksPct'
  | 'actual'
  | 'owner'
  | 'defects'
  | 'defectStatus'
  | 'milestones'
  | 'devOwner'

const ITERATION_STATUS_COLUMNS: ColumnDef<ColKey>[] = [
  { key: 'rank', label: 'Rank', defaultWidth: 45 },
  { key: 'id', label: 'ID', defaultWidth: 112, minWidth: 100 },
  { key: 'name', label: 'Name', defaultWidth: 240, minWidth: 150 },
  { key: 'feature', label: 'Feature', defaultWidth: 130, minWidth: 90 },
  { key: 'state', label: 'State', defaultWidth: 112 },
  { key: 'block', label: 'Block', defaultWidth: 42 },
  { key: 'blockedReason', label: 'Blocked Reason', defaultWidth: 160, minWidth: 100 },
  { key: 'planEstimate', label: 'Plan Estimate', defaultWidth: 80 },
  { key: 'taskEstimate', label: 'Task Estimate', defaultWidth: 80 },
  { key: 'toDo', label: 'To Do', defaultWidth: 70 },
  { key: 'tasksPct', label: 'Tasks', defaultWidth: 110, minWidth: 80 },
  { key: 'actual', label: 'Actual', defaultWidth: 70 },
  { key: 'owner', label: 'Owner', defaultWidth: 130 },
  { key: 'defects', label: 'Defects', defaultWidth: 60 },
  { key: 'defectStatus', label: 'Defect Status', defaultWidth: 100, minWidth: 80 },
  { key: 'milestones', label: 'Milestones', defaultWidth: 140, minWidth: 90 },
  { key: 'devOwner', label: 'Dev Owner', defaultWidth: 130 },
]

// Stable empty-array reference — `status?.items ?? []` would otherwise mint a
// new array every render while status is loading, which defeats the
// `syncedItems !== sortedItems` reference-equality check below and causes an
// infinite render loop ("Too many re-renders").
const EMPTY_ITEMS: IterationStatusItem[] = []

// Sentinel for the Owner filter's "Unassigned" option (empty string collides
// with the native <select> placeholder, so use an explicit token).
const OWNER_UNASSIGNED = '__unassigned__'

function fmtRange(it: Pick<Iteration, 'startDate' | 'endDate'>) {
  const s = it.startDate ?? '—'
  const e = it.endDate ?? '—'
  return `${s} - ${e}`
}

function computeTotalDays(it: Iteration | undefined): number {
  if (!it?.startDate || !it?.endDate) return 10
  const start = new Date(it.startDate)
  const end = new Date(it.endDate)
  const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  return Math.max(1, diff)
}

// ── Cell primitives (Rally-style chips / pills / progress) ──────────────────

/** Compact chip used by the Feature and Milestones columns. */
function Chip({
  label,
  title,
  onClick,
  tone = 'neutral',
}: {
  label: string
  title?: string
  onClick?: () => void
  tone?: 'neutral' | 'accent'
}) {
  const accent = tone === 'accent'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      disabled={!onClick}
      style={{
        maxWidth: '100%',
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 6px',
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '18px',
        border: `1px solid ${accent ? '#c7d6ee' : AZ.border}`,
        backgroundColor: accent ? AZ.primaryLight : AZ.bgAlt,
        color: accent ? AZ.primary : AZ.textSecondary,
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: AZ.font,
      }}
    >
      <span className="truncate">{label}</span>
    </button>
  )
}

/** Rally "Defect Status" summary pill derived from child-defect counts. */
function DefectStatusPill({ total, open }: { total: number; open: number }) {
  if (total === 0) {
    return <span style={{ fontSize: 12, color: AZ.textMuted }}>None</span>
  }
  const closed = open === 0
  const bg = closed ? '#eaf7ee' : '#fdf3e7'
  const fg = closed ? '#1c7a3f' : '#9a6410'
  const bd = closed ? '#bfe6cd' : '#f0d9b5'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 8px',
        borderRadius: 9,
        fontSize: 11,
        fontWeight: 600,
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${bd}`,
        fontFamily: AZ.font,
      }}
    >
      {closed ? 'Closed' : `${open} Open`}
    </span>
  )
}

/** Thin task-completion bar computed from task estimate vs. remaining to-do. */
function TasksProgress({ estimate, toDo }: { estimate: number; toDo: number }) {
  if (!estimate || estimate <= 0) {
    return <span style={{ fontSize: 12, color: AZ.textMuted }}>&mdash;</span>
  }
  const pct = Math.max(0, Math.min(100, Math.round(((estimate - toDo) / estimate) * 100)))
  return (
    <div className="flex w-full items-center gap-1.5" title={`${pct}% complete`}>
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          backgroundColor: AZ.border,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: pct >= 100 ? '#1c7a3f' : AZ.primary,
          }}
        />
      </div>
      <span style={{ fontSize: 11, color: AZ.textSecondary, minWidth: 30, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export function IterationStatusPage() {
  const navigate = useNavigate()
  const { project } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canEdit = can('work_item:edit')
  const canCreate = can('work_item:create')

  const { data: iterations = [] } = useIterations(projectId)
  const { data: members = [] } = useProjectMembers(projectId)

  const memberMap = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])

  const [chosenId, setChosenId] = useState<string | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'board' | 'compact'>('list')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [stateFilter, setStateFilter] = useState<ScheduleState | 'all'>('all')
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState<number>(1)

  const { startResize, order, hidden, toggleVisible, reorder, styleFor } = useColumnLayout(
    ITERATION_STATUS_COLUMNS,
    STORAGE_KEYS.ITERATION_STATUS_COLUMNS,
  )

  // Drag-to-reorder columns directly from their header cells (mirrors the
  // Show Fields menu, but in-place). Delegates to `reorder` from useColumnLayout.
  const {
    activeDragKey,
    dropIndicator,
    handleDragStart: handleColDragStart,
    handleDragOver: handleColDragOver,
    handleDragLeave: handleColDragLeave,
    handleDrop: handleColDrop,
    handleDragEnd: handleColDragEnd,
  } = useColumnDrag<ColKey>({ onReorder: reorder })

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
  } = useIterationStatus(selectedId ?? undefined, {
    q: search.trim() || undefined,
  })

  const selectedIndex = useMemo(
    () => iterations.findIndex((i) => i.id === selectedId),
    [iterations, selectedId],
  )
  const selected = iterations[selectedIndex]

  const items = status?.items ?? EMPTY_ITEMS

  function move(dir: -1 | 1) {
    const next = selectedIndex + dir
    if (next >= 0 && next < iterations.length) setSelectedId(iterations[next].id)
  }

  const toggleSort = useCallback(
    (col: string) => {
      // NOTE: never nest a state setter inside another setter's updater —
      // StrictMode double-invokes updaters, which would fire the toggle twice
      // and cancel it out (symptom: "sort only works on the first click").
      if (sortCol === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortCol(col)
        setSortDir('asc')
      }
    },
    [sortCol],
  )

  // Client-side refinement on top of the server-side `q` search: Schedule
  // State / Owner / Blocked filters applied to the loaded iteration items.
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (stateFilter !== 'all' && it.scheduleState !== stateFilter) return false
      if (ownerFilter === OWNER_UNASSIGNED && it.assigneeId != null) return false
      if (
        ownerFilter !== 'all' &&
        ownerFilter !== OWNER_UNASSIGNED &&
        it.assigneeId !== ownerFilter
      )
        return false
      if (blockedOnly && !it.isBlocked) return false
      return true
    })
  }, [items, stateFilter, ownerFilter, blockedOnly])

  const sortedItems = useMemo(() => {
    if (!sortCol) return filteredItems
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filteredItems].sort((a, b) => {
      let va: string | number
      let vb: string | number
      switch (sortCol) {
        case 'rank':
          va = a.rank
          vb = b.rank
          break
        case 'id':
          va = a.itemKey
          vb = b.itemKey
          break
        case 'name':
          va = a.title.toLowerCase()
          vb = b.title.toLowerCase()
          break
        case 'scheduleState':
          va = a.scheduleState
          vb = b.scheduleState
          break
        case 'block':
          va = a.isBlocked ? 1 : 0
          vb = b.isBlocked ? 1 : 0
          break
        case 'planEstimate':
          va = a.planEstimate ?? 0
          vb = b.planEstimate ?? 0
          break
        case 'taskEstimate':
          va = a.taskEstimate ?? 0
          vb = b.taskEstimate ?? 0
          break
        case 'toDo':
          va = a.toDo ?? 0
          vb = b.toDo ?? 0
          break
        case 'owner':
          va = a.assigneeId ?? ''
          vb = b.assigneeId ?? ''
          break
        default:
          return 0
      }
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
  }, [filteredItems, sortCol, sortDir])

  // ── Client-side pagination ──────────────────────────────────────────────
  // An iteration is a bounded dataset (the fetch loads the full sprint), so we
  // paginate the already-loaded/sorted/filtered rows in the client. This keeps
  // multi-column sort and rank drag working across the whole set while still
  // giving an offset-style footer (Page N of M, total count).
  const pageCount = Math.max(1, Math.ceil(sortedItems.length / pageSize))
  // Snap back to the first page whenever the underlying view identity changes
  // (project/iteration, search, filters, sort, or page size).
  const pageResetKey = `${selectedId ?? ''}|${search}|${stateFilter}|${ownerFilter}|${blockedOnly}|${sortCol ?? ''}|${sortDir}|${pageSize}`
  const [syncedPageKey, setSyncedPageKey] = useState(pageResetKey)
  if (syncedPageKey !== pageResetKey) {
    setSyncedPageKey(pageResetKey)
    setPage(1)
  }
  const currentPage = Math.min(page, pageCount)
  const pagedItems = useMemo(
    () => sortedItems.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedItems, currentPage, pageSize],
  )
  const goPrevPage = useCallback(() => setPage((p) => Math.max(1, p - 1)), [])
  const goNextPage = useCallback(() => setPage((p) => p + 1), [])

  // ── Rank drag-and-drop (only meaningful in default rank order) ──────────
  const rankMutation = useRankAnyWorkItem()
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [localItems, setLocalItems] = useState<IterationStatusItem[]>(pagedItems)
  const [syncedItems, setSyncedItems] = useState(pagedItems)
  if (syncedItems !== pagedItems) {
    setSyncedItems(pagedItems)
    setLocalItems(pagedItems)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || sortCol) return
    const oldIndex = localItems.findIndex((it) => it.id === active.id)
    const newIndex = localItems.findIndex((it) => it.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(localItems, oldIndex, newIndex)
    setLocalItems(reordered)
    const beforeId = newIndex > 0 ? reordered[newIndex - 1].id : null
    const afterId = newIndex < reordered.length - 1 ? reordered[newIndex + 1].id : null
    if (!projectId) return
    rankMutation.mutate(
      {
        id: active.id as string,
        projectId,
        beforeId: beforeId ?? undefined,
        afterId: afterId ?? undefined,
      },
      { onError: (err) => toast.error(err.message) },
    )
  }

  // ── Bulk selection ──────────────────────────────────────────────
  const selection = useRowSelection(localItems)
  const bulkIteration = useBulkAssignIteration()
  const bulkUpdate = useUpdateAnyWorkItem()
  const deleteItem = useDeleteWorkItem()
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function removeSelectedFromIteration() {
    if (!projectId || selection.count === 0) return
    setBulkError(null)
    try {
      await bulkIteration.mutateAsync({
        projectId,
        itemIds: [...selection.selectedIds],
        iterationId: null,
      })
      selection.clear()
      toast.success('Removed from iteration')
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Failed to remove items from iteration')
    }
  }

  async function setStateForSelected(next: ScheduleState) {
    if (!projectId || selection.count === 0) return
    setBulkError(null)
    const ids = [...selection.selectedIds]
    const results = await Promise.allSettled(
      ids.map((id) => bulkUpdate.mutateAsync({ id, input: { scheduleState: next } })),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) {
      setBulkError(`${failed} of ${ids.length} updates failed`)
    } else {
      selection.clear()
      toast.success(`Updated ${ids.length} item${ids.length === 1 ? '' : 's'}`)
    }
  }

  async function deleteSelected() {
    if (!projectId || selection.count === 0) return
    setBulkError(null)
    const ids = [...selection.selectedIds]
    const results = await Promise.allSettled(
      ids.map((id) => deleteItem.mutateAsync({ id, projectId })),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    setConfirmDelete(false)
    if (failed > 0) {
      setBulkError(`${failed} of ${ids.length} deletions failed`)
    } else {
      selection.clear()
      toast.success(`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`)
    }
  }

  // ── Totals ─────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let planEst = 0
    let taskEst = 0
    let toDoSum = 0
    for (const item of items) {
      planEst += item.planEstimate ?? 0
      taskEst += item.taskEstimate ?? 0
      toDoSum += item.toDo ?? 0
    }
    return { planEst, taskEst, toDoSum, count: items.length }
  }, [items])

  // ── Metrics ────────────────────────────────────────────────────────────
  const metrics = status?.metrics
  const velocityPct = metrics?.plannedVelocityPercent ?? 0
  const acceptedPct = metrics?.acceptedPercent ?? 0
  const daysLeft = metrics?.daysLeft ?? 0
  const tDays = computeTotalDays(selected)
  // An iteration is finished once it's been accepted or explicitly completed —
  // regardless of the raw end-date arithmetic (which reads 0/negative when past
  // due and otherwise misleadingly shows "0 days left" on a done sprint).
  const iterationDone = selected?.state === 'accepted' || selected?.completedAt != null
  // Elapsed / total, capped at 100%; a finished iteration always shows full.
  const iterationProgressPct = iterationDone
    ? 100
    : tDays > 0
      ? Math.min(((tDays - Math.max(daysLeft, 0)) / tDays) * 100, 100)
      : 0
  // Single source of truth for the "Iteration End" widget value/label/colour so
  // Done and Overdue states never degrade to a misleading "0 days left".
  const iterationEnd: { value: string; label: string; color: string } = iterationDone
    ? { value: 'Done', label: 'Completed', color: '#15803d' }
    : metrics?.daysLeft == null
      ? { value: '—', label: 'no end date', color: '#8a5808' }
      : metrics.daysLeft < 0
        ? {
            value: String(Math.abs(metrics.daysLeft)),
            label: metrics.daysLeft === -1 ? 'day overdue' : 'days overdue',
            color: '#b91c1c',
          }
        : { value: String(metrics.daysLeft), label: `of ${tDays} days left`, color: '#8a5808' }

  const colStyles = useMemo(
    () => ({
      rank: styleFor('rank', { flexShrink: 0 }),
      id: styleFor('id', { flexShrink: 0 }),
      name: styleFor('name', { flex: 1, minWidth: 150 }),
      feature: styleFor('feature', { flexShrink: 0 }),
      state: styleFor('state', { flexShrink: 0 }),
      block: styleFor('block', { flexShrink: 0 }),
      blockedReason: styleFor('blockedReason', { flexShrink: 0 }),
      planEstimate: styleFor('planEstimate', { flexShrink: 0 }),
      taskEstimate: styleFor('taskEstimate', { flexShrink: 0 }),
      toDo: styleFor('toDo', { flexShrink: 0 }),
      tasksPct: styleFor('tasksPct', { flexShrink: 0 }),
      actual: styleFor('actual', { flexShrink: 0 }),
      owner: styleFor('owner', { flexShrink: 0 }),
      defects: styleFor('defects', { flexShrink: 0 }),
      defectStatus: styleFor('defectStatus', { flexShrink: 0 }),
      milestones: styleFor('milestones', { flexShrink: 0 }),
      devOwner: styleFor('devOwner', { flexShrink: 0 }),
    }),
    [styleFor],
  )

  // ── Empty / guard states ──────────────────────────────────────────────
  if (!projectId) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: AZ.textMuted, fontSize: 13, fontFamily: AZ.font }}
      >
        Select a project to view Iteration Status.
      </div>
    )
  }

  if (!iterations.length) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2"
        style={{ color: AZ.textMuted, fontSize: 13, fontFamily: AZ.font }}
      >
        <span>No iterations in this project/team yet.</span>
        <button
          onClick={() => navigate({ to: '/timeboxes' })}
          style={{
            color: AZ.primary,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            textDecoration: 'none',
          }}
          onMouseOver={(e) => {
            ;(e.target as HTMLElement).style.textDecoration = 'underline'
          }}
          onMouseOut={(e) => {
            ;(e.target as HTMLElement).style.textDecoration = 'none'
          }}
        >
          Go to Timeboxes →
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{ fontFamily: AZ.font, backgroundColor: AZ.bg, color: AZ.textPrimary, fontSize: 12 }}
    >
      {/* ── Single page header: title + iteration picker + view toggle ────── */}
      <IterationHeader
        iterations={iterations}
        selected={selected}
        selectedId={selectedId}
        selectedIndex={selectedIndex}
        setSelectedId={setSelectedId}
        move={move}
        selectorOpen={selectorOpen}
        setSelectorOpen={setSelectorOpen}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />

      <MetricsStrip
        metrics={metrics}
        velocityPct={velocityPct}
        acceptedPct={acceptedPct}
        iterationEnd={iterationEnd}
        iterationProgressPct={iterationProgressPct}
      />

      <Toolbar
        search={search}
        setSearch={setSearch}
        canCreate={canCreate}
        onAddNew={() => setShowAdd(true)}
        columns={ITERATION_STATUS_COLUMNS}
        order={order}
        hidden={hidden}
        toggleVisible={toggleVisible}
        reorder={reorder}
        stateFilter={stateFilter}
        setStateFilter={setStateFilter}
        ownerFilter={ownerFilter}
        setOwnerFilter={setOwnerFilter}
        blockedOnly={blockedOnly}
        setBlockedOnly={setBlockedOnly}
        members={members}
      />

      {/* Bulk action bar (appears when rows are selected) */}
      {selection.count > 0 && (
        <BulkActionBar
          selectedCount={selection.count}
          error={bulkError}
          onClear={() => {
            selection.clear()
            setBulkError(null)
          }}
        >
          {canEdit && (
            <>
              <InlineSelect
                value=""
                disabled={bulkUpdate.isPending}
                onChange={(e) => {
                  if (!e.target.value) return
                  void setStateForSelected(e.target.value as ScheduleState)
                }}
                className="w-auto"
                aria-label="Set state for selected"
              >
                <option value="">Set State…</option>
                {SCHEDULE_STATE_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {SCHEDULE_STATE_LABEL[s as ScheduleState] ?? s}
                  </option>
                ))}
              </InlineSelect>

              <button
                type="button"
                onClick={() => void removeSelectedFromIteration()}
                disabled={bulkIteration.isPending}
                className="rounded px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white disabled:opacity-50"
                style={{ color: BRAND.primaryLight }}
              >
                Remove from Iteration
              </button>

              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleteItem.isPending}
                className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white disabled:opacity-50"
                style={{ color: BRAND.danger }}
              >
                <Trash2 size={12} />
                Delete
              </button>
            </>
          )}
        </BulkActionBar>
      )}

      {/* ── 6. Table ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-auto" style={{ backgroundColor: AZ.bg }}>
        <DataTableHeader
          columns={HEADER_META}
          colStyles={colStyles}
          onResize={startResize}
          className="pr-3 pl-1"
          leading={
            <>
              <div className="w-5 shrink-0 px-2">
                <SelectionCheckbox
                  checked={selection.allSelected}
                  indeterminate={selection.someSelected}
                  onChange={selection.toggleAll}
                  ariaLabel="Select all"
                />
              </div>
              <div className="w-4 shrink-0 px-2" />
            </>
          }
          sort={{ col: sortCol, dir: sortDir, onSort: toggleSort }}
          columnDrag={{
            activeDragKey,
            dropIndicator,
            onDragStart: handleColDragStart,
            onDragOver: handleColDragOver,
            onDragLeave: handleColDragLeave,
            onDrop: handleColDrop,
            onDragEnd: handleColDragEnd,
          }}
        />

        {/* Rows */}
        {isLoading && <SkeletonList rows={10} cols={12} />}

        {!isLoading && isError && (
          <div
            className="flex items-center justify-center"
            style={{ height: 160, fontSize: 12, color: '#b91c1c' }}
          >
            Failed to load iteration status. Please try again.
          </div>
        )}

        {!isLoading && !isError && (
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={localItems.map((it) => it.id)}
              strategy={verticalListSortingStrategy}
            >
              {localItems.map((item, idx) => (
                <StatusRow
                  key={item.id}
                  item={item}
                  rank={(currentPage - 1) * pageSize + idx + 1}
                  memberMap={memberMap}
                  selectedIterationId={selectedId!}
                  canEdit={canEdit}
                  colStyles={colStyles}
                  dragEnabled={!sortCol}
                  selected={selection.isSelected(item.id)}
                  onToggleSelect={() => selection.toggle(item.id)}
                  onOpen={() =>
                    navigate({
                      to: '/item/$itemKey',
                      params: { itemKey: item.itemKey },
                    })
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <div
            className="flex items-center justify-center"
            style={{ height: 160, fontSize: 12, color: AZ.textMuted }}
          >
            No items assigned to this iteration
          </div>
        )}

        {!isLoading && !isError && items.length > 0 && (
          <TableFooterTotals colStyles={colStyles} totals={totals} />
        )}
      </div>

      {!isLoading && !isError && sortedItems.length > 0 && (
        <PaginationFooter
          pageSize={pageSize}
          setPageSize={setPageSize}
          currentPage={currentPage}
          rangeStart={(currentPage - 1) * pageSize + 1}
          rangeEnd={(currentPage - 1) * pageSize + pagedItems.length}
          total={sortedItems.length}
          pageCount={pageCount}
          hasPrevPage={currentPage > 1}
          hasNextPage={currentPage < pageCount}
          onPrevPage={goPrevPage}
          onNextPage={goNextPage}
        />
      )}

      {/* ── Add Item modal ───────────────────────────────────────────────── */}
      {showAdd && selected && (
        <AddItemModal
          iteration={selected}
          onClose={() => setShowAdd(false)}
          onCreated={() => setShowAdd(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${selection.count} item${selection.count === 1 ? '' : 's'}?`}
        message="This permanently removes the selected work items from the project. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        pending={deleteItem.isPending}
        onConfirm={() => void deleteSelected()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}

// ── Iteration page header (title + iteration picker + view-mode toggle) ─────
//
// Rally's Iteration Status page leads with the iteration picker and a progress
// banner — it does NOT stack a redundant in-page breadcrumb (the app shell
// already renders "Project › Iteration"). We fold the page title, the sprint
// selector (prev/next + dropdown + date range) and the list/board/compact
// toggle into a SINGLE header row so "Iteration" isn't repeated four times.

function IterationHeader({
  iterations,
  selected,
  selectedId,
  selectedIndex,
  setSelectedId,
  move,
  selectorOpen,
  setSelectorOpen,
  viewMode,
  setViewMode,
}: {
  iterations: Iteration[]
  selected: Iteration | undefined
  selectedId: string | null
  selectedIndex: number
  setSelectedId: (id: string) => void
  move: (dir: -1 | 1) => void
  selectorOpen: boolean
  setSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>
  viewMode: 'list' | 'board' | 'compact'
  setViewMode: (mode: 'list' | 'board' | 'compact') => void
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-3 px-4"
      style={{
        height: 44,
        borderBottom: `1px solid ${AZ.border}`,
        backgroundColor: AZ.bg,
      }}
    >
      <span style={{ fontSize: 16, fontWeight: 700, color: AZ.textPrimary, whiteSpace: 'nowrap' }}>
        Iteration Status
      </span>
      <div
        className="flex items-center"
        style={{
          border: `1px solid ${AZ.border}`,
          borderRadius: 2,
          overflow: 'visible',
          height: 28,
        }}
      >
        <button
          disabled={selectedIndex <= 0}
          onClick={() => move(-1)}
          style={{
            height: '100%',
            padding: '0 6px',
            display: 'flex',
            alignItems: 'center',
            cursor: selectedIndex <= 0 ? 'not-allowed' : 'pointer',
            background: 'transparent',
            border: 'none',
            borderRight: `1px solid ${AZ.border}`,
            color: selectedIndex <= 0 ? AZ.textMuted : AZ.textSecondary,
            opacity: selectedIndex <= 0 ? 0.4 : 1,
          }}
          onMouseOver={(e) => {
            if (selectedIndex > 0) e.currentTarget.style.backgroundColor = AZ.bgAlt
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <ChevronLeft size={14} />
        </button>
        <div className="relative" style={{ height: '100%' }}>
          <button
            onClick={() => setSelectorOpen((o) => !o)}
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0 10px',
              cursor: 'pointer',
              background: 'transparent',
              border: 'none',
              minWidth: 300,
              color: AZ.textPrimary,
              fontFamily: AZ.font,
              textAlign: 'left',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = AZ.bgAlt
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {selected?.name}
            </span>
            <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: AZ.textSecondary }}>
              {selected && fmtRange(selected)}
            </span>
            <ChevronDown size={12} style={{ marginLeft: 'auto', color: AZ.textMuted }} />
          </button>
          {selectorOpen && (
            <div
              className="absolute top-full left-0 z-50"
              style={{
                marginTop: 4,
                width: 380,
                backgroundColor: AZ.bg,
                borderRadius: 2,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                border: `1px solid ${AZ.border}`,
                maxHeight: 300,
                overflowY: 'auto',
                padding: '4px 0',
              }}
            >
              {iterations.map((it) => (
                <button
                  key={it.id}
                  onClick={() => {
                    setSelectedId(it.id)
                    setSelectorOpen(false)
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    border: 'none',
                    background: selectedId === it.id ? AZ.primaryLight : 'transparent',
                    color: selectedId === it.id ? AZ.primary : AZ.textPrimary,
                    fontFamily: AZ.font,
                    fontSize: 12,
                    textAlign: 'left',
                  }}
                  onMouseOver={(e) => {
                    if (selectedId !== it.id) e.currentTarget.style.backgroundColor = AZ.bgAlt
                  }}
                  onMouseOut={(e) => {
                    if (selectedId !== it.id) e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <span style={{ fontWeight: 600, flex: 1 }}>{it.name}</span>
                  <span style={{ color: AZ.textMuted, fontSize: 11 }}>{fmtRange(it)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          disabled={selectedIndex >= iterations.length - 1}
          onClick={() => move(1)}
          style={{
            height: '100%',
            padding: '0 6px',
            display: 'flex',
            alignItems: 'center',
            cursor: selectedIndex >= iterations.length - 1 ? 'not-allowed' : 'pointer',
            background: 'transparent',
            border: 'none',
            borderLeft: `1px solid ${AZ.border}`,
            color: selectedIndex >= iterations.length - 1 ? AZ.textMuted : AZ.textSecondary,
            opacity: selectedIndex >= iterations.length - 1 ? 0.4 : 1,
          }}
          onMouseOver={(e) => {
            if (selectedIndex < iterations.length - 1)
              e.currentTarget.style.backgroundColor = AZ.bgAlt
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="flex-1" />
      {/* View-mode toggle (list / board / compact) */}
      <div
        className="flex items-center"
        style={{ border: `1px solid ${AZ.border}`, borderRadius: 2, overflow: 'hidden' }}
      >
        {(['list', 'board', 'compact'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              padding: '3px 12px',
              fontSize: 11,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: viewMode === mode ? AZ.primary : 'transparent',
              color: viewMode === mode ? '#fff' : AZ.textSecondary,
              fontFamily: AZ.font,
              textTransform: 'capitalize' as const,
            }}
            onMouseOver={(e) => {
              if (viewMode !== mode) e.currentTarget.style.backgroundColor = AZ.bgAlt
            }}
            onMouseOut={(e) => {
              if (viewMode !== mode) e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            {mode}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Metrics strip ────────────────────────────────────────────────────────────

function MetricsStrip({
  metrics,
  velocityPct,
  acceptedPct,
  iterationEnd,
  iterationProgressPct,
}: {
  metrics: import('@/features/iterations/api').IterationStatus['metrics'] | undefined
  velocityPct: number
  acceptedPct: number
  iterationEnd: { value: string; label: string; color: string }
  iterationProgressPct: number
}) {
  return (
    <div
      className="flex shrink-0 items-stretch px-4"
      style={{
        height: 72,
        borderBottom: `1px solid ${AZ.border}`,
        backgroundColor: AZ.bg,
        gap: 24,
      }}
    >
      {/* Left side: KPI cards from the iteration read-model */}
      <div className="flex items-stretch" style={{ gap: 32, flex: 1 }}>
        <MetricCard
          label="Planned Velocity"
          value={`${velocityPct}%`}
          caption={`${metrics?.totalPlanEstimate ?? 0} of ${metrics?.plannedVelocity ?? 0} Points`}
          progressPct={velocityPct}
          minWidth={160}
        />
        <MetricCard
          label="Iteration End"
          value={iterationEnd.value}
          valueColor={iterationEnd.color}
          caption={iterationEnd.label}
          progressPct={iterationProgressPct}
          progressColor={BRAND.textMuted}
          minWidth={140}
        />
        <MetricCard
          label="Accepted"
          value={`${acceptedPct}%`}
          valueColor="#1e6930"
          caption={`${metrics?.acceptedPoints ?? 0} of ${metrics?.totalPlanEstimate ?? 0} Points`}
          progressPct={acceptedPct}
          progressColor="#1e6930"
          minWidth={140}
        />
      </div>

      {/* Right side: Defects, Tasks, View Charts */}
      <div className="flex items-center" style={{ gap: 20 }}>
        <div className="flex items-center gap-2" style={{ minWidth: 90 }}>
          <Bug size={16} style={{ color: AZ.textMuted }} />
          <div className="flex flex-col">
            <span style={{ fontSize: 11, fontWeight: 600, color: AZ.textPrimary }}>
              {metrics?.defectCount ?? 0} Active
            </span>
            <span style={{ fontSize: 10, color: AZ.textMuted }}>Defects</span>
          </div>
        </div>
        <div className="flex items-center gap-2" style={{ minWidth: 90 }}>
          <ListChecks size={16} style={{ color: AZ.textMuted }} />
          <div className="flex flex-col">
            <span style={{ fontSize: 11, fontWeight: 600, color: AZ.textPrimary }}>
              {metrics?.taskCount ?? 0} Active
            </span>
            <span style={{ fontSize: 10, color: AZ.textMuted }}>Tasks</span>
          </div>
        </div>
        <button
          className="flex items-center gap-1.5"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: AZ.primary,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: 2,
            fontFamily: AZ.font,
            whiteSpace: 'nowrap',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = AZ.primaryLight
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <BarChart3 size={14} />
          View Charts
        </button>
      </div>
    </div>
  )
}

// ── Toolbar (search + add + filter/fields placeholders) ────────────────────

function Toolbar({
  search,
  setSearch,
  canCreate,
  onAddNew,
  columns,
  order,
  hidden,
  toggleVisible,
  reorder,
  stateFilter,
  setStateFilter,
  ownerFilter,
  setOwnerFilter,
  blockedOnly,
  setBlockedOnly,
  members,
}: {
  search: string
  setSearch: (v: string) => void
  canCreate: boolean
  onAddNew: () => void
  columns: ColumnDef<ColKey>[]
  order: ColKey[]
  hidden: Set<ColKey>
  toggleVisible: (key: ColKey) => void
  reorder: (dragKey: ColKey, overKey: ColKey) => void
  stateFilter: ScheduleState | 'all'
  setStateFilter: (v: ScheduleState | 'all') => void
  ownerFilter: string
  setOwnerFilter: (v: string) => void
  blockedOnly: boolean
  setBlockedOnly: (v: boolean) => void
  members: import('@/features/teams/api').ProjectMember[]
}) {
  const activeFilterCount =
    (stateFilter !== 'all' ? 1 : 0) + (ownerFilter !== 'all' ? 1 : 0) + (blockedOnly ? 1 : 0)
  return (
    <PageToolbar
      search={{
        value: search,
        onChange: setSearch,
        placeholder: 'Search Work Items',
        ariaLabel: 'Search work items',
        width: 220,
      }}
      actions={
        canCreate ? (
          <button
            onClick={onAddNew}
            className="flex items-center gap-1.5 rounded px-3 py-1 text-[11px] font-semibold text-white"
            style={{ backgroundColor: BRAND.primary }}
          >
            <Plus size={14} /> Add New
          </button>
        ) : undefined
      }
      activeFilterCount={activeFilterCount}
      defaultFiltersOpen={activeFilterCount > 0}
      filters={
        <>
          <label
            className="flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: BRAND.textSecondary }}
          >
            State
            <InlineSelect
              value={stateFilter}
              aria-label="Filter by schedule state"
              onChange={(e) => setStateFilter(e.target.value as ScheduleState | 'all')}
              className="w-auto"
            >
              <option value="all">All States</option>
              {SCHEDULE_STATE_VALUES.map((s) => (
                <option key={s} value={s}>
                  {SCHEDULE_STATE_LABEL[s as ScheduleState] ?? s}
                </option>
              ))}
            </InlineSelect>
          </label>
          <label
            className="flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: BRAND.textSecondary }}
          >
            Owner
            <InlineSelect
              value={ownerFilter}
              aria-label="Filter by owner"
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="w-auto"
            >
              <option value="all">All Owners</option>
              <option value={OWNER_UNASSIGNED}>Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </InlineSelect>
          </label>
          <label
            className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium"
            style={{ color: BRAND.textPrimary }}
          >
            <input
              type="checkbox"
              checked={blockedOnly}
              onChange={(e) => setBlockedOnly(e.target.checked)}
            />
            Blocked items only
          </label>
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setStateFilter('all')
                setOwnerFilter('all')
                setBlockedOnly(false)
              }}
              className="cursor-pointer rounded px-2.5 py-1 text-[11px]"
              style={{ color: BRAND.primaryLight }}
            >
              Clear filters
            </button>
          )}
        </>
      }
      fields={
        <ColumnFieldsMenu
          columns={columns}
          order={order}
          hidden={hidden}
          onToggle={toggleVisible}
          onReorder={reorder}
        />
      }
    />
  )
}

// ── Table header row ─────────────────────────────────────────────────────────

// ── Header column metadata ──────────────────────────────────────────────────
// Drives the (single-source) header render: label, optional sort key, and
// alignment. Order mirrors ITERATION_STATUS_COLUMNS; visual position is driven
// by CSS `order` via styleFor, so the DOM order stays canonical.
const HEADER_META: DataTableHeaderColumn<ColKey>[] = [
  { key: 'rank', label: 'Rank', sortCol: 'rank', align: 'center' },
  { key: 'id', label: 'ID', sortCol: 'id' },
  { key: 'name', label: 'Name', sortCol: 'name' },
  { key: 'feature', label: 'Feature' },
  { key: 'state', label: 'State', sortCol: 'scheduleState' },
  { key: 'block', label: 'Block', sortCol: 'block', align: 'center' },
  { key: 'blockedReason', label: 'Blocked Reason' },
  { key: 'planEstimate', label: 'Plan Est', sortCol: 'planEstimate', align: 'right' },
  { key: 'taskEstimate', label: 'Task Est', sortCol: 'taskEstimate', align: 'right' },
  { key: 'toDo', label: 'To Do', sortCol: 'toDo', align: 'right' },
  { key: 'tasksPct', label: 'Tasks' },
  { key: 'actual', label: 'Actual', align: 'right' },
  { key: 'owner', label: 'Owner', sortCol: 'owner' },
  { key: 'defects', label: 'Defects', align: 'center' },
  { key: 'defectStatus', label: 'Defect Status' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'devOwner', label: 'Dev Owner' },
]

// ── Table footer totals ──────────────────────────────────────────────────────

function TableFooterTotals({
  colStyles,
  totals,
}: {
  colStyles: Record<string, React.CSSProperties>
  totals: { planEst: number; taskEst: number; toDoSum: number; count: number }
}) {
  return (
    <div
      className="flex items-center"
      style={{
        height: 28,
        paddingLeft: 4,
        paddingRight: 12,
        backgroundColor: AZ.bgHeader,
        borderTop: `2px solid ${AZ.border}`,
        fontSize: 11,
        color: AZ.textSecondary,
        fontWeight: 600,
        minWidth: 'max-content',
      }}
    >
      <div className="w-5 shrink-0 px-2" />
      <div className="w-4 shrink-0 px-2" />
      <div style={colStyles.rank} />
      <div style={colStyles.id} />
      <div style={colStyles.name} className="flex items-center px-2">
        Totals ({totals.count})
      </div>
      <div style={colStyles.feature} />
      <div style={colStyles.state} />
      <div style={colStyles.block} />
      <div style={colStyles.blockedReason} />
      <div style={colStyles.planEstimate} className="px-2 text-right">
        {totals.planEst} Points
      </div>
      <div style={colStyles.taskEstimate} className="px-2 text-right">
        {totals.taskEst} Hours
      </div>
      <div style={colStyles.toDo} className="px-2 text-right">
        {totals.toDoSum} Hours
      </div>
      <div style={colStyles.tasksPct} />
      <div style={colStyles.actual} />
      <div style={colStyles.owner} />
      <div style={colStyles.defects} />
      <div style={colStyles.defectStatus} />
      <div style={colStyles.milestones} />
      <div style={colStyles.devOwner} />
    </div>
  )
}

// ── Status row ──────────────────────────────────────────────────────────────

function StatusRow({
  item,
  rank,
  memberMap,
  selectedIterationId,
  canEdit,
  colStyles,
  dragEnabled,
  selected,
  onToggleSelect,
  onOpen,
}: {
  item: IterationStatusItem
  rank: number
  memberMap: Map<string, import('@/features/teams/api').ProjectMember>
  selectedIterationId: string
  canEdit: boolean
  colStyles: Record<string, React.CSSProperties>
  dragEnabled: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
}) {
  const navigate = useNavigate()
  const update = useUpdateWorkItem(item.id)
  const member = item.assigneeId ? memberMap.get(item.assigneeId) : undefined
  const ownerName = member?.displayName ?? member?.email ?? null

  // Narrowed locals so closures below keep the non-null type.
  const featureKey = item.featureKey
  const featureTitle = item.featureTitle
  const milestones = item.milestones

  const [tasksExpanded, setTasksExpanded] = useState(false)
  const { data: childTasks = [], isLoading: isLoadingTasks } = useTasks(
    tasksExpanded ? item.id : undefined,
  )

  const membersList = useMemo(() => Array.from(memberMap.values()), [memberMap])

  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: !dragEnabled || !canEdit,
  })
  const rowStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  function commitEstimate(raw: string) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('Estimate must be a positive number')
      return
    }
    // Auto-sync To Do to the new Plan Estimate value.
    update.mutate(
      { storyPoints: num, todoHours: num },
      {
        onSuccess: () => toast.success('Plan estimate updated'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function commitTodo(raw: string) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('Todo hours must be a positive number')
      return
    }
    update.mutate(
      { todoHours: num },
      {
        onSuccess: () => toast.success('Todo hours updated'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function commitTitle(raw: string) {
    const next = raw.trim()
    if (!next || next === item.title) return
    update.mutate(
      { title: next },
      {
        onSuccess: () => toast.success('Name updated'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function handleOwnerChange(userId: string | null) {
    update.mutate(
      { assigneeId: userId },
      {
        onSuccess: () => toast.success('Owner updated'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function toggleBlocked() {
    update.mutate(
      { isBlocked: !item.isBlocked },
      {
        onSuccess: () =>
          toast.success(item.isBlocked ? 'Work item unblocked' : 'Work item blocked'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  return (
    <>
      <div
        ref={setNodeRef}
        className="group flex items-center transition-colors duration-100 hover:bg-[#f1f6fc]"
        style={{
          height: 34,
          paddingLeft: 4,
          paddingRight: 12,
          borderBottom: `1px solid ${AZ.border}`,
          backgroundColor: AZ.bg,
          fontSize: 12,
          minWidth: 'max-content',
          ...rowStyle,
        }}
        {...(dragEnabled && canEdit ? attributes : {})}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = '#f1f6fc'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = AZ.bg
        }}
      >
        {/* Selection checkbox */}
        <div className="w-5 shrink-0 px-2" onClick={(e) => e.stopPropagation()}>
          <SelectionCheckbox
            checked={selected}
            onChange={onToggleSelect}
            ariaLabel={`Select ${item.itemKey}`}
          />
        </div>

        {/* Drag handle — left gutter, reveals on row hover */}
        <DragHandle
          ref={setActivatorNodeRef}
          disabled={!dragEnabled || !canEdit}
          {...(dragEnabled && canEdit ? listeners : {})}
        />

        {/* Rank number + expand toggle */}
        <div style={colStyles.rank} className="flex items-center justify-center gap-1.5 px-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setTasksExpanded(!tasksExpanded)
            }}
            aria-label={tasksExpanded ? 'Collapse tasks' : 'Expand tasks'}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              color: AZ.textSecondary,
            }}
          >
            <ChevronDown
              size={12}
              style={{
                transform: tasksExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.15s ease',
              }}
            />
          </button>
          <span className="font-mono text-[10px] tabular-nums" style={{ color: AZ.textSecondary }}>
            {rank}
          </span>
        </div>

        {/* ID */}
        <div style={colStyles.id} className="flex items-center gap-1 px-2">
          <TypeBadge type={item.type} />
          <button
            onClick={onOpen}
            title={item.itemKey}
            style={{
              minWidth: 0,
              fontSize: 12,
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              color: AZ.primary,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              textAlign: 'left',
              whiteSpace: 'nowrap',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.textDecoration = 'underline'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.textDecoration = 'none'
            }}
          >
            {item.itemKey}
          </button>
        </div>

        {/* Name — click to edit inline (Rally parity); use the ID link to open */}
        <div
          style={colStyles.name}
          className="overflow-hidden px-2"
          onClick={(e) => e.stopPropagation()}
        >
          <InlineEditableCell
            value={item.title}
            canEdit={canEdit}
            onCommit={commitTitle}
            ariaLabel="Name"
            title={item.title}
            className="block w-full truncate"
            style={{ fontSize: 12, color: AZ.textPrimary, fontFamily: AZ.font }}
            inputStyle={{
              width: '100%',
              fontSize: 12,
              fontFamily: AZ.font,
              color: AZ.textPrimary,
              border: `1px solid ${AZ.primary}`,
              borderRadius: 2,
              outline: 'none',
              padding: '1px 4px',
            }}
          />
        </div>

        {/* Feature */}
        <div style={colStyles.feature} className="flex items-center overflow-hidden px-2">
          {featureKey ? (
            <Chip
              label={featureKey}
              title={featureTitle ?? featureKey}
              tone="accent"
              onClick={() => navigate({ to: '/item/$itemKey', params: { itemKey: featureKey } })}
            />
          ) : (
            <span style={{ color: AZ.textMuted, fontSize: 12 }}>&mdash;</span>
          )}
        </div>

        {/* Schedule State — Rally-style segmented stepper */}
        <div
          style={colStyles.state}
          className="flex items-center px-2 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <ScheduleStateStepper
            value={item.scheduleState as ScheduleState}
            canEdit={canEdit}
            onChange={(next) => update.mutate({ scheduleState: next })}
          />
        </div>

        {/* Block - Click to Toggle */}
        <div style={colStyles.block} className="flex justify-center px-2">
          <button
            onClick={canEdit ? toggleBlocked : undefined}
            style={{
              background: 'none',
              border: 'none',
              cursor: canEdit ? 'pointer' : 'default',
              padding: 0,
            }}
          >
            {item.isBlocked ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 20,
                  borderRadius: 2,
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  fontFamily: AZ.font,
                }}
                title="Blocked - Click to Unblock"
              >
                B
              </span>
            ) : (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 20,
                  borderRadius: 2,
                  fontSize: 11,
                  fontWeight: 500,
                  border: '1px dashed #cccccc',
                  color: AZ.textMuted,
                  fontFamily: AZ.font,
                }}
                title="Unblocked - Click to Block"
              >
                &middot;
              </span>
            )}
          </button>
        </div>

        {/* Blocked Reason */}
        <div style={colStyles.blockedReason} className="flex items-center px-2">
          {item.blockedReason ? (
            <span
              className="truncate"
              title={item.blockedReason}
              style={{ fontSize: 12, color: AZ.textSecondary }}
            >
              {item.blockedReason}
            </span>
          ) : (
            <span style={{ color: AZ.textMuted, fontSize: 12 }}>&mdash;</span>
          )}
        </div>

        {/* Plan Estimate */}
        <div style={{ ...colStyles.planEstimate, textAlign: 'right' }} className="px-2">
          <InlineEditableCell
            value={String(item.planEstimate ?? '')}
            canEdit={canEdit}
            onCommit={commitEstimate}
            displayValue={item.planEstimate ?? '—'}
            style={{
              fontFamily: 'Consolas, Monaco, monospace',
              color: AZ.textSecondary,
              fontSize: 12,
            }}
            inputStyle={{
              width: '100%',
              textAlign: 'right',
              fontSize: 11,
              fontFamily: 'Consolas, Monaco, monospace',
              border: `1px solid ${AZ.primary}`,
              borderRadius: 2,
              outline: 'none',
            }}
            ariaLabel="Plan estimate"
          />
        </div>

        {/* Task Estimate (Rollup - readonly) */}
        <div
          style={{
            ...colStyles.taskEstimate,
            textAlign: 'right',
            fontFamily: 'Consolas, Monaco, monospace',
            color: AZ.textSecondary,
            fontSize: 12,
          }}
          className="px-2 text-right"
        >
          {item.taskEstimate || '—'}
        </div>

        {/* To Do */}
        <div style={{ ...colStyles.toDo, textAlign: 'right' }} className="px-2">
          <InlineEditableCell
            value={String(item.toDo ?? '')}
            canEdit={canEdit}
            onCommit={commitTodo}
            displayValue={item.toDo ?? '—'}
            style={{
              fontFamily: 'Consolas, Monaco, monospace',
              color: AZ.textSecondary,
              fontSize: 12,
            }}
            inputStyle={{
              width: '100%',
              textAlign: 'right',
              fontSize: 11,
              fontFamily: 'Consolas, Monaco, monospace',
              border: `1px solid ${AZ.primary}`,
              borderRadius: 2,
              outline: 'none',
            }}
            ariaLabel="Todo hours"
          />
        </div>

        {/* Tasks % complete (rollup) */}
        <div style={colStyles.tasksPct} className="flex items-center px-2">
          <TasksProgress estimate={item.taskEstimate} toDo={item.toDo} />
        </div>

        {/* Actual — not tracked at story level, only on tasks */}
        <div
          style={{ ...colStyles.actual, textAlign: 'right', color: AZ.textMuted, fontSize: 12 }}
          className="px-2 text-right"
        >
          &mdash;
        </div>

        {/* Owner */}
        <div
          style={colStyles.owner}
          className="overflow-hidden px-2"
          onClick={(e) => e.stopPropagation()}
        >
          <OwnerSelectCell
            ownerName={ownerName}
            assigneeId={item.assigneeId}
            members={membersList}
            canEdit={canEdit}
            onChange={handleOwnerChange}
          />
        </div>

        {/* Defects — child-defect count */}
        <div
          style={{ ...colStyles.defects, textAlign: 'center', fontSize: 12 }}
          className="px-2 text-center"
        >
          {item.defectCount > 0 ? (
            <span style={{ color: AZ.textSecondary, fontWeight: 600 }}>{item.defectCount}</span>
          ) : (
            <span style={{ color: AZ.textMuted }}>&mdash;</span>
          )}
        </div>

        {/* Defect Status — open/closed summary */}
        <div style={colStyles.defectStatus} className="flex items-center px-2">
          <DefectStatusPill total={item.defectCount} open={item.openDefectCount} />
        </div>

        {/* Milestones */}
        <div style={colStyles.milestones} className="flex items-center gap-1 overflow-hidden px-2">
          {milestones.length > 0 ? (
            <>
              <span className="min-w-0 flex-1">
                <Chip label={milestones[0]} title={milestones.join(', ')} />
              </span>
              {milestones.length > 1 && (
                <span
                  className="shrink-0"
                  style={{ fontSize: 11, color: AZ.textMuted, whiteSpace: 'nowrap' }}
                  title={milestones.join(', ')}
                >
                  +{milestones.length - 1}
                </span>
              )}
            </>
          ) : (
            <span style={{ color: AZ.textMuted, fontSize: 12 }}>&mdash;</span>
          )}
        </div>

        {/* DEV O — assignee name */}
        <div style={colStyles.devOwner} className="overflow-hidden px-2">
          <OwnerCell name={ownerName} />
        </div>

        {/* selectedIterationId kept for future refetch semantics */}
        <span hidden>{selectedIterationId}</span>
      </div>

      {/* Child Tasks List */}
      {tasksExpanded && (
        <div style={{ borderLeft: `2px solid ${AZ.primaryLight}`, backgroundColor: '#fafbfc' }}>
          {isLoadingTasks && (
            <div
              style={{
                padding: '6px 44px',
                fontSize: 11,
                color: AZ.textMuted,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Loader2 size={12} className="animate-spin" /> Loading tasks...
            </div>
          )}
          {!isLoadingTasks && childTasks.length === 0 && (
            <div
              style={{
                padding: '6px 44px',
                fontSize: 11,
                color: AZ.textMuted,
                fontStyle: 'italic',
              }}
            >
              No tasks created under this item
            </div>
          )}
          {!isLoadingTasks &&
            childTasks.map((task) => {
              const taskMember = task.assigneeId ? memberMap.get(task.assigneeId) : undefined
              const taskOwner = taskMember?.displayName ?? taskMember?.email ?? 'Unassigned'
              return (
                <ChildTaskRow
                  key={task.id}
                  task={task}
                  taskOwner={taskOwner}
                  membersList={membersList}
                  canEdit={canEdit}
                  colStyles={colStyles}
                  onOpen={() =>
                    navigate({ to: '/item/$itemKey', params: { itemKey: task.itemKey } })
                  }
                />
              )
            })}
        </div>
      )}
    </>
  )
}

// ── Child task row ──────────────────────────────────────────────────────────

function ChildTaskRow({
  task,
  taskOwner,
  membersList,
  canEdit,
  colStyles,
  onOpen,
}: {
  task: WorkItem
  taskOwner: string
  membersList: import('@/features/teams/api').ProjectMember[]
  canEdit: boolean
  colStyles: Record<string, React.CSSProperties>
  onOpen: () => void
}) {
  const updateTask = useUpdateWorkItem(task.id)

  function commitTaskTitle(raw: string) {
    const next = raw.trim()
    if (!next || next === task.title) return
    updateTask.mutate(
      { title: next },
      {
        onSuccess: () => toast.success('Name updated'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function commitTaskEstimate(raw: string) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('Estimate must be a positive number')
      return
    }
    // Auto-sync To Do to the new estimate value.
    updateTask.mutate(
      { estimateHours: num, todoHours: num },
      {
        onSuccess: () => toast.success('Task estimate updated'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function commitTaskTodo(raw: string) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('Todo hours must be a positive number')
      return
    }
    updateTask.mutate(
      { todoHours: num },
      {
        onSuccess: () => toast.success('Todo hours updated'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function commitTaskActual(raw: string) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('Actual hours must be a positive number')
      return
    }
    updateTask.mutate(
      { actualHours: num },
      {
        onSuccess: () => toast.success('Actual hours updated'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function handleOwnerChange(userId: string | null) {
    updateTask.mutate(
      { assigneeId: userId },
      {
        onSuccess: () => toast.success('Owner updated'),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  return (
    <div
      className="flex items-center"
      style={{
        height: 30,
        paddingLeft: 44,
        paddingRight: 12,
        borderBottom: `1px dashed ${AZ.border}`,
        fontSize: 11,
        color: AZ.textSecondary,
        minWidth: 'max-content',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.backgroundColor = '#f1f6fc'
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      <div className="w-5 shrink-0 px-2" />
      <div className="w-4 shrink-0 px-2" />
      <div style={colStyles.rank} className="px-2" />
      <div style={colStyles.id} className="flex items-center gap-1 px-2">
        <TypeBadge type={task.type} />
        <button
          onClick={onOpen}
          title={task.itemKey}
          style={{
            fontSize: 11,
            fontFamily: 'Consolas, Monaco, monospace',
            color: AZ.primary,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textAlign: 'left',
            whiteSpace: 'nowrap',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.textDecoration = 'underline'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.textDecoration = 'none'
          }}
        >
          {task.itemKey}
        </button>
      </div>
      <div
        style={colStyles.name}
        className="overflow-hidden px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          value={task.title}
          canEdit={canEdit}
          onCommit={commitTaskTitle}
          ariaLabel="Name"
          title={task.title}
          className="block w-full truncate"
          style={{ fontSize: 12, color: AZ.textPrimary, fontFamily: AZ.font }}
          inputStyle={{
            width: '100%',
            fontSize: 12,
            fontFamily: AZ.font,
            color: AZ.textPrimary,
            border: `1px solid ${AZ.primary}`,
            borderRadius: 2,
            outline: 'none',
            padding: '1px 4px',
          }}
        />
      </div>
      <div style={colStyles.feature} className="px-2" />
      <div
        style={colStyles.state}
        className="flex items-center px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <SimplifiedStateControl
          scheduleState={task.scheduleState as ScheduleState}
          canEdit={canEdit}
          onChange={(next) => {
            updateTask.mutate(
              { scheduleState: next },
              {
                onSuccess: () => toast.success('Task state updated'),
                onError: (err) => toast.error(err.message),
              },
            )
          }}
        />
      </div>
      <div style={colStyles.block} className="px-2" />
      <div style={colStyles.blockedReason} className="px-2" />
      <div style={colStyles.planEstimate} className="px-2" />
      <div style={{ ...colStyles.taskEstimate, textAlign: 'right' }} className="px-2 text-right">
        <InlineEditableCell
          value={String(task.estimateHours ?? '')}
          canEdit={canEdit}
          onCommit={commitTaskEstimate}
          displayValue={task.estimateHours ?? '—'}
          style={{ fontFamily: 'Consolas, Monaco, monospace', fontSize: 11 }}
          inputStyle={{
            width: '100%',
            textAlign: 'right',
            fontSize: 11,
            fontFamily: 'Consolas, Monaco, monospace',
            border: `1px solid ${AZ.primary}`,
            borderRadius: 2,
            outline: 'none',
          }}
          ariaLabel="Task estimate"
        />
      </div>
      <div style={{ ...colStyles.toDo, textAlign: 'right' }} className="px-2 text-right">
        <InlineEditableCell
          value={String(task.todoHours ?? '')}
          canEdit={canEdit}
          onCommit={commitTaskTodo}
          displayValue={task.todoHours ?? '—'}
          style={{ fontFamily: 'Consolas, Monaco, monospace', fontSize: 11 }}
          inputStyle={{
            width: '100%',
            textAlign: 'right',
            fontSize: 11,
            fontFamily: 'Consolas, Monaco, monospace',
            border: `1px solid ${AZ.primary}`,
            borderRadius: 2,
            outline: 'none',
          }}
          ariaLabel="Todo hours"
        />
      </div>
      <div style={colStyles.tasksPct} className="px-2" />
      <div style={{ ...colStyles.actual, textAlign: 'right' }} className="px-2 text-right">
        <InlineEditableCell
          value={String(task.actualHours ?? '')}
          canEdit={canEdit}
          onCommit={commitTaskActual}
          displayValue={task.actualHours ?? '—'}
          style={{ fontFamily: 'Consolas, Monaco, monospace', fontSize: 11 }}
          inputStyle={{
            width: '100%',
            textAlign: 'right',
            fontSize: 11,
            fontFamily: 'Consolas, Monaco, monospace',
            border: `1px solid ${AZ.primary}`,
            borderRadius: 2,
            outline: 'none',
          }}
          ariaLabel="Actual hours"
        />
      </div>
      <div
        style={colStyles.owner}
        className="overflow-hidden px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerSelectCell
          ownerName={task.assigneeId ? taskOwner : null}
          assigneeId={task.assigneeId}
          members={membersList}
          canEdit={canEdit}
          onChange={handleOwnerChange}
        />
      </div>
      <div style={colStyles.defects} className="px-2" />
      <div style={colStyles.defectStatus} className="px-2" />
      <div style={colStyles.milestones} className="px-2" />
      <div
        style={colStyles.devOwner}
        className="overflow-hidden px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerSelectCell
          ownerName={task.assigneeId ? taskOwner : null}
          assigneeId={task.assigneeId}
          members={membersList}
          canEdit={canEdit}
          onChange={handleOwnerChange}
          ariaLabel="Dev Owner"
        />
      </div>
    </div>
  )
}

// ── Segmented state stepper (Rally parity) ──────────────────────────────────
// Both wrappers delegate to the shared StateStepper so every grid row —
// story/defect and task — uses one visual language (see state-stepper.tsx).

// Story-level schedule-state stepper (7 states).
function ScheduleStateStepper({
  value,
  canEdit,
  onChange,
}: {
  value: ScheduleState
  canEdit: boolean
  onChange: (next: ScheduleState) => void
}) {
  return (
    <StateStepper
      steps={SCHEDULE_STATE_STEPS}
      value={value}
      canEdit={canEdit}
      onChange={onChange}
      ariaLabel="Schedule state"
    />
  )
}

// Task-level simplified-state stepper (Define / In-Progress / Complete).
function SimplifiedStateControl({
  scheduleState,
  canEdit,
  onChange,
}: {
  scheduleState: ScheduleState
  canEdit: boolean
  onChange: (next: ScheduleState) => void
}) {
  const current = SIMPLIFIED_STATE_TO_SCHEDULE_STATE[getSimplifiedState(scheduleState)]
  return (
    <StateStepper
      steps={SIMPLIFIED_STATE_STEPS}
      value={current}
      canEdit={canEdit}
      onChange={onChange}
      ariaLabel="Task state"
    />
  )
}

// ── Add Item modal ──────────────────────────────────────────────────────────

function AddItemModal({
  iteration,
  onClose,
  onCreated,
}: {
  iteration: Iteration
  onClose: () => void
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const create = useCreateIterationItem(iteration.id)
  const [type, setType] = useState<'story' | 'defect'>('story')
  const [title, setTitle] = useState('')
  const [planEstimate, setPlanEstimate] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(openDetail = false) {
    setError(null)
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    try {
      const result = await create.mutateAsync({
        type,
        title: title.trim(),
        planEstimate: planEstimate === '' ? undefined : Number(planEstimate),
      })
      toast.success(
        `${type === 'defect' ? 'Defect' : 'Story'} "${title.trim()}" added to iteration`,
      )
      if (openDetail) {
        void navigate({ to: '/item/$itemKey', params: { itemKey: result.itemKey } })
      } else {
        onCreated()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create item'
      setError(msg)
      toast.error(msg)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title="Add Item to Iteration"
      subtitle={`${iteration.name} · ${fmtRange(iteration)}`}
      width={460}
    >
      <ModalBody className="space-y-4">
        {/* Type toggle */}
        <FormField label="Type">
          <div className="flex gap-2">
            {(['story', 'defect'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setType(o)}
                className="flex-1 rounded-sm py-1.5 text-[11px] font-semibold capitalize transition-colors"
                style={{
                  backgroundColor: type === o ? '#eef3fb' : 'transparent',
                  color: type === o ? BRAND.primary : BRAND.textSecondary,
                  border: `1px solid ${type === o ? '#bdd0ef' : BRAND.borderSubtle}`,
                }}
              >
                {o}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label="Title" required error={error ?? undefined}>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a concise work item title..."
          />
        </FormField>

        <FormField label="Plan Estimate">
          <Input
            type="number"
            min={0}
            value={planEstimate}
            onChange={(e) => setPlanEstimate(e.target.value)}
            placeholder="0"
          />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[#f0f2f5]"
          style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => submit(true)}
          className="rounded px-4 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ border: '1px solid #9fb5d5', color: BRAND.primary, backgroundColor: '#f5f8fc' }}
        >
          Create with details
        </button>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => submit(false)}
          className="flex items-center gap-1.5 rounded px-4 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: BRAND.primary }}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          Create Item
        </button>
      </ModalFooter>
    </AppModal>
  )
}
