/**
 * Team Board — Kanban view of an iteration's work, grouped by Schedule State.
 *
 * Business flow (BA design): the board is the *doing* surface for a committed
 * iteration. Each column is a Schedule State (Idea → … → Release); dragging a
 * card between columns advances its readiness, which the backend persists as a
 * `scheduleState` change on the work item. Cards, metrics and the create action
 * all read/write the **same** iteration read-model used by Iteration Status
 * (`/v1/iterations/:id/status`) — single source of truth, no divergent data.
 *
 * Reuses shared primitives (MetricCard, AppModal, TypeBadge, OwnerCell, …) and
 * the canonical Schedule-State model so the board can never drift from the rest
 * of the tracking surface.
 */
import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { Search, Plus, GripVertical, AlertTriangle, Loader2 } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useProjectMembers } from '@/features/teams/api'
import {
  useIterations,
  useIterationStatus,
  useCreateIterationItem,
  type Iteration,
  type IterationStatusItem,
} from '@/features/iterations/api'
import { useUpdateAnyWorkItem } from '@/features/work-items/api'
import {
  SCHEDULE_STATE_CONFIG,
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  ScheduleState,
  type WorkItemType,
} from '@/entities/work-item/model/types'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { ViewOnlyBadge } from '@/shared/ui/view-only-badge'
import { IterationPicker } from '@/shared/ui/iteration-picker'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { NativeSelect } from '@/shared/ui/native-select'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'

const OWNER_UNASSIGNED = '__unassigned__'
const EMPTY_ITEMS: IterationStatusItem[] = []

function fmtRange(it: Pick<Iteration, 'startDate' | 'endDate'>) {
  const s = it.startDate ?? '—'
  const e = it.endDate ?? '—'
  return `${s} - ${e}`
}

/** Resolve a drag `over` target (column id or card id) to its Schedule State. */
function resolveTargetState(overId: string, items: IterationStatusItem[]): ScheduleState | null {
  if ((SCHEDULE_STATE_VALUES as string[]).includes(overId)) return overId as ScheduleState
  const overItem = items.find((i) => i.id === overId)
  return (overItem?.scheduleState as ScheduleState) ?? null
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function TeamBoardPage() {
  const navigate = useNavigate()
  const { project, team } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canEdit = can('work_item:edit')
  const canCreate = can('work_item:create')

  const { data: iterations = [] } = useIterations(projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const memberMap = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])

  const [chosenId, setChosenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<WorkItemType | 'all'>('all')
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Default selection = this-session pick → last-viewed (persisted, shared with
  // Iteration Status) → first iteration. Derived during render so switching
  // project scope re-resolves without a cascading state effect.
  const persistedId = projectId
    ? localStorage.getItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`)
    : null
  const selectedId =
    chosenId && iterations.some((i) => i.id === chosenId)
      ? chosenId
      : persistedId && iterations.some((i) => i.id === persistedId)
        ? persistedId
        : (iterations[0]?.id ?? null)

  const setSelectedId = useCallback(
    (id: string | null) => {
      setChosenId(id)
      if (projectId) {
        if (id) localStorage.setItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`, id)
        else localStorage.removeItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`)
      }
    },
    [projectId],
  )

  const {
    data: status,
    isLoading,
    isError,
  } = useIterationStatus(selectedId ?? undefined, { q: search.trim() || undefined })

  const updateItem = useUpdateAnyWorkItem()

  const selected = iterations.find((i) => i.id === selectedId)

  const allItems = status?.items ?? EMPTY_ITEMS

  // Client-side refinement on top of the server `q` search (Owner / Type /
  // Blocked) — mirrors the Iteration Status filter semantics.
  const items = useMemo(
    () =>
      allItems.filter((it) => {
        if (typeFilter !== 'all' && it.type !== typeFilter) return false
        if (ownerFilter === OWNER_UNASSIGNED && it.assigneeId != null) return false
        if (
          ownerFilter !== 'all' &&
          ownerFilter !== OWNER_UNASSIGNED &&
          it.assigneeId !== ownerFilter
        )
          return false
        if (blockedOnly && !it.isBlocked) return false
        return true
      }),
    [allItems, typeFilter, ownerFilter, blockedOnly],
  )

  const columns = useMemo(() => {
    const byState = new Map<ScheduleState, IterationStatusItem[]>()
    for (const state of SCHEDULE_STATE_VALUES) byState.set(state, [])
    for (const it of items) {
      const bucket = byState.get(it.scheduleState as ScheduleState)
      if (bucket) bucket.push(it)
    }
    return byState
  }, [items])

  // Metric strip — derived from the loaded (unfiltered) iteration items so the
  // KPIs reflect the whole iteration, not the current filter view.
  const metrics = useMemo(() => {
    const done = new Set<string>([ScheduleState.Accepted, ScheduleState.Release])
    const active = allItems.filter((i) => !done.has(i.scheduleState)).length
    const accepted = allItems
      .filter((i) => i.scheduleState === ScheduleState.Accepted)
      .reduce((s, i) => s + (i.planEstimate ?? 0), 0)
    const toDo = allItems.reduce((s, i) => s + (i.toDo ?? 0), 0)
    const blocked = allItems.filter((i) => i.isBlocked).length
    return {
      cards: allItems.length,
      active,
      planEst: status?.metrics.totalPlanEstimate ?? 0,
      accepted,
      toDo,
      blocked,
    }
  }, [allItems, status])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const activeItem = activeId ? allItems.find((i) => i.id === activeId) : undefined

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const item = allItems.find((i) => i.id === String(active.id))
    if (!item) return
    const target = resolveTargetState(String(over.id), allItems)
    if (!target || target === item.scheduleState) return
    try {
      await updateItem.mutateAsync({ id: item.id, input: { scheduleState: target } })
      toast.success(`${item.itemKey} moved to ${SCHEDULE_STATE_LABEL[target]}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move card')
    }
  }

  const openItem = useCallback(
    (itemKey: string) => void navigate({ to: '/item/$itemKey', params: { itemKey } }),
    [navigate],
  )

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: BRAND.textMuted }}>
        <p className="text-sm">Select a project to view its team board.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: BRAND.pageBg }}>
      {/* ── Header: iteration selector + scope + view ─────────────────────── */}
      <div
        className="flex items-center gap-3 px-4"
        style={{
          height: 44,
          backgroundColor: BRAND.surface,
          borderBottom: `1px solid ${BRAND.border}`,
        }}
      >
        <IterationPicker iterations={iterations} selectedId={selectedId} onSelect={setSelectedId} />

        <span className="text-[12px]" style={{ color: BRAND.textSecondary }}>
          {project.projectName}
          {team ? ` · ${team.teamName}` : ''}
        </span>

        <span className="ml-auto text-[12px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Board
        </span>
        {!canEdit && <ViewOnlyBadge />}
      </div>

      {/* ── Metric strip ─────────────────────────────────────────────────── */}
      <MetricStrip>
        <MetricCard label="Cards" value={metrics.cards} minWidth={70} />
        <MetricCard
          label="Active"
          value={metrics.active}
          valueColor={BRAND.primaryLight}
          minWidth={70}
        />
        <MetricCard label="Plan Est" value={metrics.planEst} caption="pts" minWidth={90} />
        <MetricCard
          label="Accepted"
          value={metrics.accepted}
          valueColor={BRAND.success}
          caption="pts"
          minWidth={90}
        />
        <MetricCard
          label="To Do"
          value={metrics.toDo}
          valueColor={BRAND.warning}
          caption="pts"
          minWidth={80}
        />
        <MetricCard
          label="Blocked"
          value={metrics.blocked}
          valueColor={metrics.blocked > 0 ? BRAND.danger : undefined}
          minWidth={80}
        />
      </MetricStrip>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-4"
        style={{
          height: 44,
          backgroundColor: BRAND.surface,
          borderBottom: `1px solid ${BRAND.border}`,
        }}
      >
        <div className="relative">
          <Search
            size={13}
            className="absolute top-1/2 left-2 -translate-y-1/2"
            style={{ color: BRAND.textMuted }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter cards..."
            className="rounded-sm py-1 pr-2 pl-7 text-[12px] outline-none"
            style={{ width: 200, border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
          />
        </div>

        <NativeSelect
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as WorkItemType | 'all')}
          className="w-auto py-1 text-[11px]"
          aria-label="Filter by type"
        >
          <option value="all">All types</option>
          <option value="story">Story</option>
          <option value="defect">Defect</option>
          <option value="task">Task</option>
          <option value="feature">Feature</option>
          <option value="initiative">Initiative</option>
        </NativeSelect>

        <NativeSelect
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="w-auto py-1 text-[11px]"
          aria-label="Filter by owner"
        >
          <option value="all">All owners</option>
          <option value={OWNER_UNASSIGNED}>Unassigned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName ?? m.email}
            </option>
          ))}
        </NativeSelect>

        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px]"
          style={{ color: BRAND.textSecondary }}
        >
          <input
            type="checkbox"
            checked={blockedOnly}
            onChange={(e) => setBlockedOnly(e.target.checked)}
          />
          Blocked only
        </label>

        {(typeFilter !== 'all' || ownerFilter !== 'all' || blockedOnly || search) && (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setTypeFilter('all')
              setOwnerFilter('all')
              setBlockedOnly(false)
            }}
            className="text-[11px] hover:underline"
            style={{ color: BRAND.primaryLight }}
          >
            Clear filters
          </button>
        )}

        {canCreate && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            disabled={!selected}
            className="ml-auto flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND.primary }}
          >
            <Plus size={13} /> Add Item
          </button>
        )}
      </div>

      {/* ── Board ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {isLoading ? (
          <SkeletonList rows={6} cols={6} />
        ) : isError ? (
          <div
            className="flex h-full items-center justify-center text-[13px]"
            style={{ color: BRAND.danger }}
          >
            Failed to load board data.
          </div>
        ) : !selected ? (
          <div
            className="flex h-full items-center justify-center text-[13px]"
            style={{ color: BRAND.textMuted }}
          >
            No iteration to display. Create an iteration to start planning.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex h-full gap-3">
              {SCHEDULE_STATE_VALUES.map((state) => (
                <BoardColumn
                  key={state}
                  state={state}
                  items={columns.get(state) ?? []}
                  memberMap={memberMap}
                  canEdit={canEdit}
                  onOpen={openItem}
                />
              ))}
            </div>
            <DragOverlay>
              {activeItem ? (
                <BoardCard
                  item={activeItem}
                  ownerName={
                    activeItem.assigneeId
                      ? (memberMap.get(activeItem.assigneeId)?.displayName ??
                        memberMap.get(activeItem.assigneeId)?.email ??
                        null)
                      : null
                  }
                  canEdit={canEdit}
                  dragging
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {showAdd && selected && (
        <AddItemModal
          iteration={selected}
          members={members}
          onClose={() => setShowAdd(false)}
          onCreated={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}

// ── Column ─────────────────────────────────────────────────────────────────

function BoardColumn({
  state,
  items,
  memberMap,
  canEdit,
  onOpen,
}: {
  state: ScheduleState
  items: IterationStatusItem[]
  memberMap: Map<string, { displayName?: string | null; email?: string | null }>
  canEdit: boolean
  onOpen: (itemKey: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: state, disabled: !canEdit })
  const cfg = SCHEDULE_STATE_CONFIG[state]
  const points = items.reduce((s, i) => s + (i.planEstimate ?? 0), 0)

  return (
    <div className="flex h-full min-w-[240px] flex-1 flex-col">
      <div
        className="flex items-center gap-2 rounded-t-sm px-2.5 py-2"
        style={{ backgroundColor: cfg.bg, borderBottom: `2px solid ${cfg.color}` }}
      >
        <span className="text-[12px] font-semibold" style={{ color: cfg.color }}>
          {SCHEDULE_STATE_LABEL[state]}
        </span>
        <span
          className="rounded-full px-1.5 text-[10px] font-semibold"
          style={{ backgroundColor: BRAND.surface, color: BRAND.textSecondary }}
        >
          {items.length}
        </span>
        <span className="ml-auto text-[10px] font-medium" style={{ color: BRAND.textMuted }}>
          {points} pts
        </span>
      </div>
      <div
        ref={setNodeRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-b-sm p-2"
        style={{
          backgroundColor: isOver ? BRAND.accentBg : BRAND.surfaceHover,
          border: `1px solid ${isOver ? BRAND.accentBorderActive : BRAND.border}`,
          borderTop: 'none',
        }}
      >
        {items.length === 0 ? (
          <div
            className="flex flex-1 items-center justify-center rounded-sm py-6 text-[11px]"
            style={{ color: BRAND.textMuted }}
          >
            {canEdit ? 'Drop cards here' : 'No cards'}
          </div>
        ) : (
          items.map((item) => (
            <DraggableCard
              key={item.id}
              item={item}
              ownerName={
                item.assigneeId
                  ? (memberMap.get(item.assigneeId)?.displayName ??
                    memberMap.get(item.assigneeId)?.email ??
                    null)
                  : null
              }
              canEdit={canEdit}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Draggable wrapper ────────────────────────────────────────────────────────

function DraggableCard({
  item,
  ownerName,
  canEdit,
  onOpen,
}: {
  item: IterationStatusItem
  ownerName: string | null
  canEdit: boolean
  onOpen: (itemKey: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: !canEdit,
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
      }}
      onDoubleClick={() => onOpen(item.itemKey)}
    >
      <BoardCard
        item={item}
        ownerName={ownerName}
        canEdit={canEdit}
        dragHandleProps={canEdit ? { ...attributes, ...listeners } : undefined}
        onOpen={onOpen}
      />
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────

function BoardCard({
  item,
  ownerName,
  canEdit,
  dragging,
  dragHandleProps,
  onOpen,
}: {
  item: IterationStatusItem
  ownerName: string | null
  canEdit: boolean
  dragging?: boolean
  dragHandleProps?: Record<string, unknown>
  onOpen?: (itemKey: string) => void
}) {
  const taskTotal = item.taskEstimate ?? 0
  const taskDone = Math.max(0, taskTotal - (item.toDo ?? 0))
  const taskPct = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0

  return (
    <div
      className="group rounded-sm p-2"
      style={{
        backgroundColor: BRAND.surface,
        border: `1px solid ${item.isBlocked ? BRAND.danger : BRAND.border}`,
        boxShadow: dragging ? '0 6px 16px rgba(0,0,0,0.18)' : '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <div className="flex items-center gap-1.5">
        <TypeBadge type={item.type} size={16} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen?.(item.itemKey)
          }}
          className="font-mono text-[11px] hover:underline"
          style={{ color: BRAND.primaryLight }}
        >
          {item.itemKey}
        </button>
        {canEdit && dragHandleProps && (
          <span
            {...dragHandleProps}
            className="ml-auto cursor-grab text-[0] opacity-0 group-hover:opacity-100"
            style={{ color: BRAND.textMuted, touchAction: 'none' }}
            aria-label="Drag card"
          >
            <GripVertical size={13} />
          </span>
        )}
      </div>

      <p
        className="mt-1.5 text-[12px] leading-snug"
        style={{
          color: BRAND.textPrimary,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
        title={item.title}
      >
        {item.title}
      </p>

      {item.featureTitle && (
        <p
          className="mt-1 truncate text-[10px]"
          style={{ color: BRAND.textMuted }}
          title={item.featureTitle}
        >
          {item.featureTitle}
        </p>
      )}

      {taskTotal > 0 && (
        <div className="mt-2">
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: BRAND.borderSubtle }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${taskPct}%`,
                backgroundColor: taskPct >= 100 ? BRAND.success : BRAND.primaryLight,
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span
          className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: BRAND.primaryLighter, color: BRAND.primaryLight }}
        >
          {item.planEstimate ?? 0} pt
        </span>
        {item.isBlocked && (
          <span
            className="flex items-center gap-0.5 text-[10px] font-medium"
            style={{ color: BRAND.danger }}
            title={item.blockedReason ?? 'Blocked'}
          >
            <AlertTriangle size={11} /> Blocked
          </span>
        )}
        <span className="ml-auto">
          <OwnerCell name={ownerName} />
        </span>
      </div>
    </div>
  )
}

// ── Add Item modal ───────────────────────────────────────────────────────────

function AddItemModal({
  iteration,
  members,
  onClose,
  onCreated,
}: {
  iteration: Iteration
  members: Array<{ userId: string; displayName?: string | null; email?: string | null }>
  onClose: () => void
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const create = useCreateIterationItem(iteration.id)
  const [type, setType] = useState<'story' | 'defect'>('story')
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
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
        assigneeId: assigneeId || undefined,
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
        <FormField label="Type">
          <div className="flex gap-2">
            {(['story', 'defect'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setType(o)}
                className="flex-1 rounded-sm py-1.5 text-[11px] font-semibold capitalize transition-colors"
                style={{
                  backgroundColor: type === o ? BRAND.primaryLighter : 'transparent',
                  color: type === o ? BRAND.primary : BRAND.textSecondary,
                  border: `1px solid ${type === o ? BRAND.accentBorder : BRAND.borderSubtle}`,
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

        <FormField label="Owner">
          <NativeSelect value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName ?? m.email}
              </option>
            ))}
          </NativeSelect>
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
          className="rounded px-3.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-background"
          style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => submit(true)}
          className="rounded px-4 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
          style={{
            border: `1px solid ${BRAND.accentBorderStrong}`,
            color: BRAND.primary,
            backgroundColor: BRAND.surfaceHover,
          }}
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
