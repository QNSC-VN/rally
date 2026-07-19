/**
 * IterationBoard — the shared Kanban surface for an iteration's work items,
 * grouped by Schedule State.
 *
 * This is the single source of truth for the board rendering used by BOTH the
 * dedicated **Team Board** page and the **Iteration Status** page's "Board"
 * view toggle. Both surfaces read the same iteration read-model
 * (`/v1/iterations/:id/status`), so sharing one board component guarantees the
 * card layout, drag semantics and Schedule-State columns can never drift.
 *
 * The component is intentionally "dumb" about data loading and filtering: the
 * caller passes already-resolved (and already-filtered) `items` plus an
 * `onMove` callback that persists a Schedule-State change. Drag orchestration,
 * column bucketing and the success/error toast are owned here so callers stay
 * thin.
 */
import { useMemo, useState } from 'react'
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
import { GripVertical, AlertTriangle } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import {
  SCHEDULE_STATE_CONFIG,
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  ScheduleState,
} from '@/entities/work-item/model/types'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { OwnerCell } from '@/shared/ui/owner-cell'
import type { IterationStatusItem } from '@/features/iterations/api'

type MemberMap = Map<string, { displayName?: string | null; email?: string | null }>

/** Resolve a drag `over` target (column id or card id) to its Schedule State. */
function resolveTargetState(overId: string, items: IterationStatusItem[]): ScheduleState | null {
  if ((SCHEDULE_STATE_VALUES as string[]).includes(overId)) return overId as ScheduleState
  const overItem = items.find((i) => i.id === overId)
  return (overItem?.scheduleState as ScheduleState) ?? null
}

function ownerNameOf(item: IterationStatusItem, memberMap: MemberMap): string | null {
  if (!item.assigneeId) return null
  const m = memberMap.get(item.assigneeId)
  return m?.displayName ?? m?.email ?? null
}

export function IterationBoard({
  items,
  memberMap,
  canEdit,
  onOpen,
  onMove,
}: {
  /** Work items to display — already filtered by the caller. */
  items: IterationStatusItem[]
  memberMap: MemberMap
  canEdit: boolean
  /** Open a work item's detail page. */
  onOpen: (itemKey: string) => void
  /** Persist a Schedule-State change for a dragged card. */
  onMove: (itemId: string, target: ScheduleState) => Promise<void>
}) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const columns = useMemo(() => {
    const byState = new Map<ScheduleState, IterationStatusItem[]>()
    for (const state of SCHEDULE_STATE_VALUES) byState.set(state, [])
    for (const it of items) {
      const bucket = byState.get(it.scheduleState as ScheduleState)
      if (bucket) bucket.push(it)
    }
    return byState
  }, [items])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const activeItem = activeId ? items.find((i) => i.id === activeId) : undefined

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const item = items.find((i) => i.id === String(active.id))
    if (!item) return
    const target = resolveTargetState(String(over.id), items)
    if (!target || target === item.scheduleState) return
    try {
      await onMove(item.id, target)
      toast.success(`${item.itemKey} moved to ${SCHEDULE_STATE_LABEL[target]}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move card')
    }
  }

  return (
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
            onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay>
        {activeItem ? (
          <BoardCard
            item={activeItem}
            ownerName={ownerNameOf(activeItem, memberMap)}
            canEdit={canEdit}
            dragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
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
  memberMap: MemberMap
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
              ownerName={ownerNameOf(item, memberMap)}
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
