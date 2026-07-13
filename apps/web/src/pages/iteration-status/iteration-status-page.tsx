/**
 * Track › Iteration Status — Azure DevOps-style layout
 *
 * Tracking view over the work items assigned to one selected iteration:
 * breadcrumb bar, view mode toggle, iteration selector (prev/next + dropdown),
 * metric strip (from the backend read-model), and an editable work-item list.
 * Sourced from /v1/iterations/:id/status.
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useMemo, useState, useCallback, useEffect } from 'react'
import { useColumnLayout, type ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { ResizeHandle } from '@/shared/ui/resize-handle'
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
  Search,
  Plus,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Bug,
  ListChecks,
  BarChart3,
  GripVertical,
} from 'lucide-react'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { SkeletonList } from '@/shared/ui/skeleton'
import { BRAND } from '@/shared/config/brand'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
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
  useTasks,
  useRankAnyWorkItem,
  type WorkItem,
} from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import {
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  SCHEDULE_STATE_CONFIG,
  ScheduleState,
  getSimplifiedState,
  SIMPLIFIED_STATE_LABEL,
  SIMPLIFIED_STATE_CONFIG,
  SIMPLIFIED_STATE_ORDER,
  SIMPLIFIED_STATE_TO_SCHEDULE_STATE,
} from '@/entities/work-item/model/types'

// ── Azure-style primary color ──────────────────────────────────────────────
const AZ = {
  primary: '#0078d4',
  primaryHover: '#106ebe',
  primaryLight: '#deecf9',
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
const STATE_LETTER: Record<ScheduleState, string> = {
  idea: 'I',
  defined: 'D',
  ready: 'Rd',
  in_progress: 'P',
  completed: 'C',
  accepted: 'A',
  released: 'R',
}
// ── Helpers ────────────────────────────────────────────────────────────────

type ColKey =
  | 'rank'
  | 'id'
  | 'name'
  | 'state'
  | 'block'
  | 'planEstimate'
  | 'taskEstimate'
  | 'toDo'
  | 'actual'
  | 'owner'
  | 'defects'
  | 'devOwner'

const ITERATION_STATUS_COLUMNS: ColumnDef<ColKey>[] = [
  { key: 'rank', label: 'Rank', defaultWidth: 45, locked: true },
  { key: 'id', label: 'ID', defaultWidth: 70, locked: true },
  { key: 'name', label: 'Name', defaultWidth: 240, minWidth: 150, locked: true },
  { key: 'state', label: 'State', defaultWidth: 112 },
  { key: 'block', label: 'Block', defaultWidth: 42 },
  { key: 'planEstimate', label: 'Plan Estimate', defaultWidth: 80 },
  { key: 'taskEstimate', label: 'Task Estimate', defaultWidth: 80 },
  { key: 'toDo', label: 'To Do', defaultWidth: 70 },
  { key: 'actual', label: 'Actual', defaultWidth: 70 },
  { key: 'owner', label: 'Owner', defaultWidth: 130 },
  { key: 'defects', label: 'Defects', defaultWidth: 60 },
  { key: 'devOwner', label: 'Dev Owner', defaultWidth: 130 },
]

// Stable empty-array reference — `status?.items ?? []` would otherwise mint a
// new array every render while status is loading, which defeats the
// `syncedItems !== sortedItems` reference-equality check below and causes an
// infinite render loop ("Too many re-renders").
const EMPTY_ITEMS: IterationStatusItem[] = []

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

  const { startResize, order, hidden, toggleVisible, reorder, styleFor } = useColumnLayout(
    ITERATION_STATUS_COLUMNS,
    STORAGE_KEYS.ITERATION_STATUS_COLUMNS,
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

  const toggleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return col
      }
      setSortDir('asc')
      return col
    })
  }, [])

  const sortedItems = useMemo(() => {
    if (!sortCol) return items
    const dir = sortDir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => {
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
  }, [items, sortCol, sortDir])

  // ── Rank drag-and-drop (only meaningful in default rank order) ──────────
  const rankMutation = useRankAnyWorkItem()
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [localItems, setLocalItems] = useState<IterationStatusItem[]>(sortedItems)
  const [syncedItems, setSyncedItems] = useState(sortedItems)
  if (syncedItems !== sortedItems) {
    setSyncedItems(sortedItems)
    setLocalItems(sortedItems)
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
  const iterationProgressPct = tDays > 0 ? ((tDays - Math.max(daysLeft, 0)) / tDays) * 100 : 0

  const colStyles = useMemo(
    () => ({
      rank: styleFor('rank', { flexShrink: 0 }),
      id: styleFor('id', { flexShrink: 0 }),
      name: styleFor('name', { flex: 1, minWidth: 150 }),
      state: styleFor('state', { flexShrink: 0 }),
      block: styleFor('block', { flexShrink: 0 }),
      planEstimate: styleFor('planEstimate', { flexShrink: 0 }),
      taskEstimate: styleFor('taskEstimate', { flexShrink: 0 }),
      toDo: styleFor('toDo', { flexShrink: 0 }),
      actual: styleFor('actual', { flexShrink: 0 }),
      owner: styleFor('owner', { flexShrink: 0 }),
      defects: styleFor('defects', { flexShrink: 0 }),
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
      <TopBar viewMode={viewMode} setViewMode={setViewMode} />

      <IterationSelectorBar
        iterations={iterations}
        selected={selected}
        selectedId={selectedId}
        selectedIndex={selectedIndex}
        setSelectedId={setSelectedId}
        move={move}
        selectorOpen={selectorOpen}
        setSelectorOpen={setSelectorOpen}
      />

      {/* ── 3. "Iteration Status" title ───────────────────────────────────── */}
      <div
        className="shrink-0 px-4"
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          borderBottom: `1px solid ${AZ.border}`,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700, color: AZ.textPrimary }}>
          Iteration Status
        </span>
      </div>

      <MetricsStrip
        metrics={metrics}
        velocityPct={velocityPct}
        acceptedPct={acceptedPct}
        tDays={tDays}
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
      />

      {/* ── 6. Table ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-auto" style={{ backgroundColor: AZ.bg }}>
        <TableHeaderRow
          colStyles={colStyles}
          sortCol={sortCol}
          sortDir={sortDir}
          toggleSort={toggleSort}
          startResize={startResize}
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
                  rank={idx + 1}
                  memberMap={memberMap}
                  selectedIterationId={selectedId!}
                  canEdit={canEdit}
                  colStyles={colStyles}
                  dragEnabled={!sortCol}
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

      {/* ── Add Item modal ───────────────────────────────────────────────── */}
      {showAdd && selected && (
        <AddItemModal
          iteration={selected}
          onClose={() => setShowAdd(false)}
          onCreated={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}

// ── Breadcrumb / view-mode toggle bar ───────────────────────────────────────

function TopBar({
  viewMode,
  setViewMode,
}: {
  viewMode: 'list' | 'board' | 'compact'
  setViewMode: (mode: 'list' | 'board' | 'compact') => void
}) {
  return (
    <div
      className="flex shrink-0 items-center px-4"
      style={{
        height: 32,
        borderBottom: `1px solid ${AZ.border}`,
        backgroundColor: AZ.bg,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 13, color: AZ.textPrimary }}>Iteration</span>
      <span style={{ margin: '0 8px', color: AZ.textMuted, fontSize: 13 }}>&rsaquo;</span>
      <span style={{ fontSize: 12, color: AZ.textMuted }}>Children</span>
      <div className="flex-1" />
      {/* View mode toggles */}
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

// ── Iteration selector bar (prev/next + dropdown) ───────────────────────────

function IterationSelectorBar({
  iterations,
  selected,
  selectedId,
  selectedIndex,
  setSelectedId,
  move,
  selectorOpen,
  setSelectorOpen,
}: {
  iterations: Iteration[]
  selected: Iteration | undefined
  selectedId: string | null
  selectedIndex: number
  setSelectedId: (id: string) => void
  move: (dir: -1 | 1) => void
  selectorOpen: boolean
  setSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 px-4"
      style={{
        height: 36,
        borderBottom: `1px solid ${AZ.border}`,
        backgroundColor: AZ.bg,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: AZ.textPrimary, whiteSpace: 'nowrap' }}>
        Iteration
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
      {/* Saved Views dropdown placeholder */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          border: `1px solid ${AZ.border}`,
          borderRadius: 2,
          color: AZ.textMuted,
          fontSize: 11,
          height: 28,
          cursor: 'pointer',
        }}
      >
        <span>Saved Views</span>
        <ChevronDown size={12} />
      </div>
    </div>
  )
}

// ── Metrics strip ────────────────────────────────────────────────────────────

function MetricsStrip({
  metrics,
  velocityPct,
  acceptedPct,
  tDays,
  iterationProgressPct,
}: {
  metrics: import('@/features/iterations/api').IterationStatus['metrics'] | undefined
  velocityPct: number
  acceptedPct: number
  tDays: number
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
      {/* Left side: 3 metric cards with progress bars */}
      <div className="flex items-stretch" style={{ gap: 32, flex: 1 }}>
        {/* Planned Velocity */}
        <div className="flex flex-col justify-center" style={{ minWidth: 160 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: AZ.textMuted,
              marginBottom: 2,
            }}
          >
            Planned Velocity
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: AZ.primary, lineHeight: 1 }}>
              {velocityPct}%
            </span>
            <span style={{ fontSize: 11, color: AZ.textSecondary }}>
              {metrics?.totalPlanEstimate ?? 0} of {metrics?.plannedVelocity ?? 0} Points
            </span>
          </div>
          <div
            style={{
              width: 120,
              height: 4,
              backgroundColor: '#e0e0e0',
              borderRadius: 2,
              marginTop: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(velocityPct, 100)}%`,
                height: '100%',
                backgroundColor: AZ.primary,
                borderRadius: 2,
              }}
            />
          </div>
        </div>

        {/* Iteration End */}
        <div className="flex flex-col justify-center" style={{ minWidth: 140 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: AZ.textMuted,
              marginBottom: 2,
            }}
          >
            Iteration End
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#8a5808', lineHeight: 1 }}>
              {metrics?.daysLeft == null ? '—' : String(Math.max(metrics.daysLeft, 0))}
            </span>
            <span style={{ fontSize: 11, color: AZ.textSecondary }}>
              {metrics?.daysLeft == null ? 'no end date' : `of ${tDays} days left`}
            </span>
          </div>
          <div
            style={{
              width: 120,
              height: 4,
              backgroundColor: '#e0e0e0',
              borderRadius: 2,
              marginTop: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(iterationProgressPct, 100)}%`,
                height: '100%',
                backgroundColor: '#999999',
                borderRadius: 2,
              }}
            />
          </div>
        </div>

        {/* Accepted */}
        <div className="flex flex-col justify-center" style={{ minWidth: 140 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: AZ.textMuted,
              marginBottom: 2,
            }}
          >
            Accepted
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#1e6930', lineHeight: 1 }}>
              {acceptedPct}%
            </span>
            <span style={{ fontSize: 11, color: AZ.textSecondary }}>
              {metrics?.acceptedPoints ?? 0} of {metrics?.totalPlanEstimate ?? 0} Points
            </span>
          </div>
          <div
            style={{
              width: 120,
              height: 4,
              backgroundColor: '#e0e0e0',
              borderRadius: 2,
              marginTop: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(acceptedPct, 100)}%`,
                height: '100%',
                backgroundColor: '#1e6930',
                borderRadius: 2,
              }}
            />
          </div>
        </div>
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
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 px-4"
      style={{
        height: 36,
        borderBottom: `1px solid ${AZ.border}`,
        backgroundColor: AZ.bg,
      }}
    >
      <div className="relative">
        <Search
          size={14}
          style={{
            position: 'absolute',
            left: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: AZ.textMuted,
          }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Work Items"
          style={{
            paddingLeft: 30,
            paddingRight: 10,
            height: 26,
            fontSize: 12,
            borderRadius: 2,
            border: `1px solid ${AZ.border}`,
            backgroundColor: AZ.bg,
            color: AZ.textPrimary,
            width: 220,
            fontFamily: AZ.font,
            outline: 'none',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = AZ.primary
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = AZ.border
          }}
        />
      </div>

      {canCreate && (
        <button
          onClick={onAddNew}
          className="flex items-center gap-1.5"
          style={{
            padding: '4px 14px',
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            backgroundColor: AZ.primary,
            border: 'none',
            borderRadius: 2,
            cursor: 'pointer',
            fontFamily: AZ.font,
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = AZ.primaryHover
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = AZ.primary
          }}
        >
          <Plus size={14} /> Add New
        </button>
      )}

      <button
        className="flex items-center gap-1.5"
        style={{
          padding: '4px 12px',
          fontSize: 12,
          fontWeight: 500,
          color: AZ.textSecondary,
          backgroundColor: 'transparent',
          border: `1px solid ${AZ.border}`,
          borderRadius: 2,
          cursor: 'pointer',
          fontFamily: AZ.font,
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = AZ.bgAlt
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        <Filter size={14} /> Show Filters
      </button>

      <ColumnFieldsMenu
        columns={columns}
        order={order}
        hidden={hidden}
        onToggle={toggleVisible}
        onReorder={reorder}
        buttonStyle={{
          padding: '4px 12px',
          fontWeight: 500,
          border: `1px solid ${AZ.border}`,
          fontFamily: AZ.font,
        }}
      />
    </div>
  )
}

// ── Table header row ─────────────────────────────────────────────────────────

function TableHeaderRow({
  colStyles,
  sortCol,
  sortDir,
  toggleSort,
  startResize,
}: {
  colStyles: Record<string, React.CSSProperties>
  sortCol: string | null
  sortDir: 'asc' | 'desc'
  toggleSort: (col: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startResize: (col: any, e: React.MouseEvent) => void
}) {
  return (
    <div
      className="sticky top-0 z-10 flex items-center select-none"
      style={{
        height: 34,
        paddingLeft: 4,
        paddingRight: 12,
        backgroundColor: '#f3f4f6',
        borderBottom: '1px solid #e2e8f0',
        fontSize: 11,
        fontWeight: 700,
        color: '#4b5563',
        minWidth: 'max-content',
      }}
    >
      <div style={colStyles.rank} className="group relative px-2 text-center">
        <SortHeader label="Rank" col="rank" activeCol={sortCol} dir={sortDir} onSort={toggleSort} />
        <ResizeHandle onMouseDown={(e) => startResize('rank', e)} ariaLabel="Resize rank column" />
      </div>
      <div style={colStyles.id} className="group relative px-2">
        <SortHeader label="ID" col="id" activeCol={sortCol} dir={sortDir} onSort={toggleSort} />
        <ResizeHandle onMouseDown={(e) => startResize('id', e)} ariaLabel="Resize ID column" />
      </div>
      <div style={colStyles.name} className="group relative px-2">
        <SortHeader label="Name" col="name" activeCol={sortCol} dir={sortDir} onSort={toggleSort} />
        <ResizeHandle onMouseDown={(e) => startResize('name', e)} ariaLabel="Resize Name column" />
      </div>
      <div style={colStyles.state} className="group relative px-2 text-center">
        <SortHeader
          label="State"
          col="scheduleState"
          activeCol={sortCol}
          dir={sortDir}
          onSort={toggleSort}
        />
        <ResizeHandle
          onMouseDown={(e) => startResize('state', e)}
          ariaLabel="Resize State column"
        />
      </div>
      <div style={colStyles.block} className="group relative px-2 text-center">
        <SortHeader
          label="Block"
          col="block"
          activeCol={sortCol}
          dir={sortDir}
          onSort={toggleSort}
        />
        <ResizeHandle
          onMouseDown={(e) => startResize('block', e)}
          ariaLabel="Resize Block column"
        />
      </div>
      <div style={colStyles.planEstimate} className="group relative px-2 text-right">
        <SortHeader
          label="Plan Estimate"
          col="planEstimate"
          activeCol={sortCol}
          dir={sortDir}
          onSort={toggleSort}
          rightAlign
        />
        <ResizeHandle
          onMouseDown={(e) => startResize('planEstimate', e)}
          ariaLabel="Resize Plan Estimate column"
        />
      </div>
      <div style={colStyles.taskEstimate} className="group relative px-2 text-right">
        <SortHeader
          label="Task Estimate"
          col="taskEstimate"
          activeCol={sortCol}
          dir={sortDir}
          onSort={toggleSort}
          rightAlign
        />
        <ResizeHandle
          onMouseDown={(e) => startResize('taskEstimate', e)}
          ariaLabel="Resize Task Estimate column"
        />
      </div>
      <div style={colStyles.toDo} className="group relative px-2 text-right">
        <SortHeader
          label="To Do"
          col="toDo"
          activeCol={sortCol}
          dir={sortDir}
          onSort={toggleSort}
          rightAlign
        />
        <ResizeHandle onMouseDown={(e) => startResize('toDo', e)} ariaLabel="Resize To Do column" />
      </div>
      <div style={colStyles.actual} className="group relative px-2 text-right">
        <span>Actual</span>
        <ResizeHandle
          onMouseDown={(e) => startResize('actual', e)}
          ariaLabel="Resize Actual column"
        />
      </div>
      <div style={colStyles.owner} className="group relative px-2">
        <SortHeader
          label="Owner"
          col="owner"
          activeCol={sortCol}
          dir={sortDir}
          onSort={toggleSort}
        />
        <ResizeHandle
          onMouseDown={(e) => startResize('owner', e)}
          ariaLabel="Resize Owner column"
        />
      </div>
      <div style={colStyles.defects} className="group relative px-2 text-center">
        <span>Defects</span>
        <ResizeHandle
          onMouseDown={(e) => startResize('defects', e)}
          ariaLabel="Resize Defects column"
        />
      </div>
      <div style={colStyles.devOwner} className="group relative px-2">
        <span>DEV O</span>
        <ResizeHandle
          onMouseDown={(e) => startResize('devOwner', e)}
          ariaLabel="Resize Dev Owner column"
        />
      </div>
    </div>
  )
}

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
      <div style={colStyles.rank} />
      <div style={colStyles.id} />
      <div style={colStyles.name} className="flex gap-24">
        <span>{totals.planEst} Points</span>
        <span>{totals.taskEst} Hours</span>
        <span>{totals.toDoSum} Hours</span>
      </div>
      <div style={colStyles.state} />
      <div style={colStyles.block} />
      <div style={colStyles.planEstimate} />
      <div style={colStyles.taskEstimate} />
      <div style={colStyles.toDo} />
      <div style={colStyles.actual} />
      <div style={colStyles.owner} />
      <div style={colStyles.defects} />
      <div style={colStyles.devOwner} />
    </div>
  )
}

// ── Sort header ─────────────────────────────────────────────────────────────

function SortHeader({
  label,
  col,
  activeCol,
  dir,
  onSort,
  rightAlign,
}: {
  label: string
  col: string
  activeCol: string | null
  dir?: 'asc' | 'desc'
  onSort: (col: string) => void
  rightAlign?: boolean
}) {
  const isActive = activeCol === col
  return (
    <div
      className="group/sort flex cursor-pointer items-center gap-1 select-none"
      style={{ justifyContent: rightAlign ? 'flex-end' : 'flex-start', width: '100%' }}
      onClick={() => onSort(col)}
    >
      <span
        style={{
          color: isActive ? BRAND.primaryLight : '#4b5563',
          fontWeight: 700,
        }}
        className="transition-colors duration-150 group-hover/sort:text-slate-800"
      >
        {label}
      </span>
      {isActive ? (
        dir === 'desc' ? (
          <ChevronDown size={11} className="shrink-0 text-[#0078d4]" />
        ) : (
          <ChevronUp size={11} className="shrink-0 text-[#0078d4]" />
        )
      ) : (
        <ChevronUp
          size={11}
          className="shrink-0 text-slate-300 opacity-0 transition-opacity duration-150 group-hover/sort:opacity-100"
        />
      )}
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
  onOpen,
}: {
  item: IterationStatusItem
  rank: number
  memberMap: Map<string, import('@/features/teams/api').ProjectMember>
  selectedIterationId: string
  canEdit: boolean
  colStyles: Record<string, React.CSSProperties>
  dragEnabled: boolean
  onOpen: () => void
}) {
  const navigate = useNavigate()
  const update = useUpdateWorkItem(item.id)
  const member = item.assigneeId ? memberMap.get(item.assigneeId) : undefined
  const ownerName = member?.displayName ?? member?.email ?? null

  const stateLetter = STATE_LETTER[item.scheduleState] ?? '?'
  const [tasksExpanded, setTasksExpanded] = useState(false)
  const { data: childTasks = [], isLoading: isLoadingTasks } = useTasks(
    tasksExpanded ? item.id : undefined,
  )

  const membersList = useMemo(() => Array.from(memberMap.values()), [memberMap])

  const [editingOwner, setEditingOwner] = useState(false)

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

  function handleOwnerChange(userId: string | null) {
    update.mutate(
      { assigneeId: userId },
      {
        onSuccess: () => {
          setEditingOwner(false)
          toast.success('Owner updated')
        },
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
        className="flex items-center transition-colors duration-100 hover:bg-[#f1f6fc]"
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
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = '#f1f6fc'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = AZ.bg
        }}
      >
        {/* Rank / Expand Button */}
        <div style={colStyles.rank} className="flex items-center justify-center gap-1 px-2">
          <span className="font-mono text-[10px]" style={{ color: AZ.textSecondary }}>
            {rank}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setTasksExpanded(!tasksExpanded)
            }}
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
          <span
            ref={setActivatorNodeRef}
            {...(dragEnabled && canEdit ? { ...attributes, ...listeners } : {})}
            style={{ display: 'inline-flex', cursor: dragEnabled && canEdit ? 'grab' : 'default' }}
          >
            <GripVertical size={12} style={{ color: AZ.textMuted }} />
          </span>
        </div>

        {/* ID */}
        <div style={colStyles.id} className="flex items-center gap-1 px-2">
          <TypeBadge type={item.type} />
          <button
            onClick={onOpen}
            style={{
              fontSize: 12,
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              color: AZ.primary,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              textAlign: 'left',
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

        {/* Name */}
        <div style={colStyles.name} className="overflow-hidden px-2">
          <button
            onClick={onOpen}
            style={{
              fontSize: 12,
              color: AZ.textPrimary,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              textAlign: 'left',
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
              fontFamily: AZ.font,
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.textDecoration = 'underline'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.textDecoration = 'none'
            }}
          >
            {item.title}
          </button>
        </div>

        {/* Schedule State — Continuous Segmented Rectangles layout */}
        <div style={colStyles.state} className="flex justify-center px-2 select-none">
          {canEdit ? (
            <div
              className="flex overflow-hidden rounded border"
              style={{ borderColor: AZ.border, height: 20 }}
            >
              {SCHEDULE_STATE_VALUES.map((s) => {
                const isSel = item.scheduleState === s
                return (
                  <button
                    key={s}
                    title={SCHEDULE_STATE_LABEL[s as ScheduleState] ?? s}
                    onClick={() => {
                      if (!isSel) update.mutate({ scheduleState: s as ScheduleState })
                    }}
                    style={{
                      border: 'none',
                      padding: '0 4px',
                      fontSize: '9px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      backgroundColor: isSel ? AZ.primary : '#fff',
                      color: isSel ? '#fff' : AZ.textSecondary,
                    }}
                  >
                    {STATE_LETTER[s] ?? s[0].toUpperCase()}
                  </button>
                )
              })}
            </div>
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
                fontWeight: 700,
                backgroundColor:
                  SCHEDULE_STATE_CONFIG[item.scheduleState as ScheduleState]?.bg ?? AZ.primaryLight,
                color:
                  SCHEDULE_STATE_CONFIG[item.scheduleState as ScheduleState]?.color ?? AZ.primary,
                fontFamily: AZ.font,
              }}
              title={
                SCHEDULE_STATE_LABEL[item.scheduleState as ScheduleState] ?? item.scheduleState
              }
            >
              {stateLetter}
            </span>
          )}
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

        {/* Actual — not tracked at story level, only on tasks */}
        <div
          style={{ ...colStyles.actual, textAlign: 'right', color: AZ.textMuted, fontSize: 12 }}
          className="px-2 text-right"
        >
          &mdash;
        </div>

        {/* Owner */}
        <div style={colStyles.owner} className="overflow-hidden px-2">
          {editingOwner && canEdit ? (
            <select
              autoFocus
              value={item.assigneeId ?? ''}
              onChange={(e) => handleOwnerChange(e.target.value || null)}
              onBlur={() => setEditingOwner(false)}
              style={{
                width: '100%',
                fontSize: 11,
                border: `1px solid ${AZ.primary}`,
                borderRadius: 2,
                fontFamily: AZ.font,
              }}
            >
              <option value="">Unassigned</option>
              {membersList.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          ) : (
            <span
              onClick={canEdit ? () => setEditingOwner(true) : undefined}
              style={{
                fontSize: 12,
                cursor: canEdit ? 'pointer' : 'default',
                color: ownerName ? AZ.textSecondary : AZ.textMuted,
              }}
            >
              {ownerName ?? 'Unassigned'}
            </span>
          )}
        </div>

        {/* Defects — no per-item data available */}
        <div
          style={{ ...colStyles.defects, textAlign: 'center', color: AZ.textMuted, fontSize: 12 }}
          className="px-2 text-center"
        >
          &mdash;
        </div>

        {/* DEV O — assignee name */}
        <div style={colStyles.devOwner} className="overflow-hidden px-2">
          <span style={{ fontSize: 12, color: ownerName ? AZ.textSecondary : AZ.textMuted }}>
            {ownerName ?? 'Unassigned'}
          </span>
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
  const [editingOwner, setEditingOwner] = useState(false)

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
        onSuccess: () => {
          setEditingOwner(false)
          toast.success('Owner updated')
        },
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
      <div style={colStyles.rank} className="px-2" />
      <div style={colStyles.id} className="flex items-center gap-1 px-2">
        <TypeBadge type={task.type} />
        <button
          onClick={onOpen}
          style={{
            fontSize: 11,
            fontFamily: 'Consolas, Monaco, monospace',
            color: AZ.primary,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textAlign: 'left',
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
      <div style={colStyles.name} className="overflow-hidden px-2">
        <span style={{ color: AZ.textPrimary }}>{task.title}</span>
      </div>
      <div
        style={colStyles.state}
        className="flex justify-center px-2"
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
      <div style={colStyles.owner} className="overflow-hidden px-2">
        {editingOwner && canEdit ? (
          <select
            autoFocus
            value={task.assigneeId ?? ''}
            onChange={(e) => handleOwnerChange(e.target.value || null)}
            onBlur={() => setEditingOwner(false)}
            style={{
              width: '100%',
              fontSize: 11,
              border: `1px solid ${AZ.primary}`,
              borderRadius: 2,
              fontFamily: AZ.font,
            }}
          >
            <option value="">Unassigned</option>
            {membersList.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
        ) : (
          <span
            onClick={canEdit ? () => setEditingOwner(true) : undefined}
            style={{ cursor: canEdit ? 'pointer' : 'default' }}
          >
            {taskOwner}
          </span>
        )}
      </div>
      <div style={colStyles.defects} className="px-2" />
      <div style={colStyles.devOwner} className="overflow-hidden px-2">
        {editingOwner && canEdit ? (
          <select
            value={task.assigneeId ?? ''}
            onChange={(e) => handleOwnerChange(e.target.value || null)}
            onBlur={() => setEditingOwner(false)}
            style={{
              width: '100%',
              fontSize: 11,
              border: `1px solid ${AZ.primary}`,
              borderRadius: 2,
              fontFamily: AZ.font,
            }}
          >
            <option value="">Unassigned</option>
            {membersList.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
        ) : (
          <span
            onClick={canEdit ? () => setEditingOwner(true) : undefined}
            style={{ cursor: canEdit ? 'pointer' : 'default' }}
          >
            {taskOwner}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Simplified 3-rectangle state control (Defined / In Progress / Complete) ──
// Same segmented-rectangle visual language as the US/DE state column above,
// collapsed to the 3 states that apply to Tasks.

function SimplifiedStateControl({
  scheduleState,
  canEdit,
  onChange,
}: {
  scheduleState: ScheduleState
  canEdit: boolean
  onChange: (next: ScheduleState) => void
}) {
  const current = getSimplifiedState(scheduleState)

  if (!canEdit) {
    const cfg = SIMPLIFIED_STATE_CONFIG[current]
    return (
      <span
        style={{
          padding: '1px 6px',
          borderRadius: 2,
          fontSize: 10,
          fontWeight: 600,
          backgroundColor: cfg.bg,
          color: cfg.color,
        }}
        title={SIMPLIFIED_STATE_LABEL[current]}
      >
        {SIMPLIFIED_STATE_LABEL[current]}
      </span>
    )
  }

  return (
    <div
      className="flex overflow-hidden rounded border"
      style={{ borderColor: AZ.border, height: 20 }}
    >
      {SIMPLIFIED_STATE_ORDER.map((s) => {
        const isSel = current === s
        const cfg = SIMPLIFIED_STATE_CONFIG[s]
        return (
          <button
            key={s}
            title={SIMPLIFIED_STATE_LABEL[s]}
            onClick={() => {
              if (!isSel) onChange(SIMPLIFIED_STATE_TO_SCHEDULE_STATE[s])
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
            {SIMPLIFIED_STATE_LABEL[s][0]}
          </button>
        )
      })}
    </div>
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
