/**
 * Backlog Page — P1-BACKLOG-LIST
 *
 * Shows Story + Defect work items for the active project with:
 *  - search (title / itemKey)
 *  - type filter (Story / Defect)
 *  - schedule state filter
 *  - server-side pagination
 *  - resizable columns (persisted in localStorage)
 *  - "Create Work Item" modal
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, GripVertical, Plus, Search, X } from 'lucide-react'
import { SkeletonList } from '@/shared/ui/skeleton'
import { InlineCellSelect, InlineSelect } from '@/shared/ui/native-select'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import {
  useBacklog,
  useUpdateWorkItem,
  useRankAnyWorkItem,
  useBulkAssignRelease,
  useBulkAssignIteration,
  type WorkItem,
  type UpdateWorkItemInput,
} from '@/features/work-items/api'
import { useReleases } from '@/features/releases/api'
import { useProjectMembers } from '@/features/teams/api'
import { useIterationOptions } from '@/features/iterations/api'
import { TypeBadge, ScheduleStateBadge, PriorityBadge } from '@/entities/work-item/ui/badges'
import {
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  PRIORITY_VALUES,
  type ScheduleState,
} from '@/entities/work-item/model/types'
import { BRAND } from '@/shared/config/brand'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { CreateWorkItemModal } from '@/features/work-items/ui/create-work-item-modal'

// ── Column definitions ─────────────────────────────────────────────────────────

type ColumnKey = 'type' | 'id' | 'name' | 'scheduleState' | 'priority' | 'estimate' | 'owner' | 'release' | 'iteration'

const COLUMN_MINS: Record<ColumnKey, number> = {
  type: 60,
  id: 64,
  name: 180,
  scheduleState: 120,
  priority: 80,
  estimate: 44,
  owner: 90,
  release: 100,
  iteration: 100,
}

const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  type: 72,
  id: 88,
  name: 260,
  scheduleState: 136,
  priority: 96,
  estimate: 52,
  owner: 120,
  release: 160,
  iteration: 140,
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  type: 'Type',
  id: 'ID',
  name: 'Name',
  scheduleState: 'Schedule State',
  priority: 'Priority',
  estimate: 'Est.',
  owner: 'Owner',
  release: 'Release',
  iteration: 'Iteration',
}

function loadSavedWidths(): Record<ColumnKey, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BACKLOG_COLUMN_WIDTHS)
    if (!raw) return { ...DEFAULT_WIDTHS }
    return { ...DEFAULT_WIDTHS, ...JSON.parse(raw) } as Record<ColumnKey, number>
  } catch {
    return { ...DEFAULT_WIDTHS }
  }
}

// ── Resizable column header ────────────────────────────────────────────────────

interface ResizableHeaderProps {
  column: ColumnKey
  label: string
  width: number
  align?: 'left' | 'center' | 'right'
  onResizeStart: (col: ColumnKey, e: React.MouseEvent) => void
}

function ResizableHeader({
  column,
  label,
  width,
  align = 'left',
  onResizeStart,
}: ResizableHeaderProps) {
  return (
    <div
      className="relative flex h-full shrink-0 items-center text-[9px] font-semibold tracking-wider uppercase select-none"
      style={{
        width,
        color: BRAND.columnHeader,
        justifyContent:
          align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      {label}
      <div
        role="separator"
        aria-label={`Resize ${label}`}
        aria-orientation="vertical"
        onMouseDown={(e) => onResizeStart(column, e)}
        className="group absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize"
      >
        <div
          className="absolute top-1 right-[3px] bottom-1 w-px group-hover:bg-primary"
          style={{ backgroundColor: '#d9dee7' }}
        />
      </div>
    </div>
  )
}

// ── Owner cell (avatar + name) ─────────────────────────────────────────────────

function OwnerCell({ name }: { name?: string | null }) {
  if (!name)
    return (
      <span className="text-[10px]" style={{ color: '#a0a7b5' }}>
        —
      </span>
    )
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('')
  return (
    <div className="flex items-center gap-1 overflow-hidden">
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
        style={{ backgroundColor: '#e5ebf4', color: '#1d3f73' }}
      >
        {initials}
      </span>
      <span className="truncate text-[10px]" style={{ color: '#5c6478' }}>
        {name}
      </span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const SCHEDULE_STATE_OPTS = [
  { value: '' as const, label: 'All States' },
  ...SCHEDULE_STATE_VALUES.map((v) => ({ value: v, label: SCHEDULE_STATE_LABEL[v] })),
]

export function BacklogPage() {
  const navigate = useNavigate()
  const { project, team } = useAppContext()
  const projectId = project?.projectId

  const canEdit = useAuthStore((s) => s.hasPermission('work_item:edit'))

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'' | 'story' | 'defect'>('')
  const [filterState, setFilterState] = useState('')
  const [filterOwner, setFilterOwner] = useState('')
  const [filterRelease, setFilterRelease] = useState('')
  const [filterIteration, setFilterIteration] = useState('')
  const [pageSize, setPageSize] = useState<number>(25)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const currentPage = cursorHistory.length + 1

  // Reference lists for the P2.1 filters, inline selects and id→name lookups.
  const { data: members = [] } = useProjectMembers(projectId)
  const { data: releases = [] } = useReleases(projectId)
  const { data: iterations = [] } = useIterationOptions(projectId, team)

  // Reset pagination on filter/project change
  useEffect(() => {
    const id = setTimeout(() => {
      setCursor(undefined)
      setCursorHistory([])
    }, 0)
    return () => clearTimeout(id)
  }, [search, filterType, filterState, filterOwner, filterRelease, filterIteration, pageSize, projectId])

  const { data, isLoading, isError, error } = useBacklog(projectId, {
    type: filterType || undefined,
    scheduleState: filterState || undefined,
    assigneeId: filterOwner || undefined,
    releaseId: filterRelease || undefined,
    iterationId: filterIteration || undefined,
    q: search || undefined,
    limit: pageSize,
    cursor,
  })

  const items = useMemo(() => data?.data ?? [], [data])
  const pageInfo = data?.pageInfo

  // ── Drag-and-drop (rank reorder within current page) ──────────────────────────
  // Local copy for optimistic reordering. Re-sync (during render, not in an
  // effect) whenever the server data reference changes.
  const [localItems, setLocalItems] = useState<WorkItem[]>(items)
  const [syncedItems, setSyncedItems] = useState(items)
  if (syncedItems !== items) {
    setSyncedItems(items)
    setLocalItems(items)
  }

  const rankMutation = useRankAnyWorkItem()
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = localItems.findIndex((it) => it.id === active.id)
    const newIndex = localItems.findIndex((it) => it.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(localItems, oldIndex, newIndex)
    setLocalItems(reordered)
    const beforeId = newIndex > 0 ? reordered[newIndex - 1].id : null
    const afterId = newIndex < reordered.length - 1 ? reordered[newIndex + 1].id : null
    rankMutation.mutate({
      id: active.id as string,
      projectId: localItems[oldIndex].projectId,
      beforeId: beforeId ?? undefined,
      afterId: afterId ?? undefined,
    })
  }

  // ── Selection ─────────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id))

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function toggleAll() {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (allSelected) items.forEach((i) => n.delete(i.id))
      else items.forEach((i) => n.add(i.id))
      return n
    })
  }

  // ── Column resize ─────────────────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState<Record<ColumnKey, number>>(loadSavedWidths)
  const resizingRef = useRef<{ col: ColumnKey; startX: number; startW: number } | null>(null)
  // Holds the current resize cleanup fn so we can remove listeners on unmount
  // even if the user navigates away mid-drag (mouseup never fires).
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  // Safety net: remove any lingering document listeners when the component unmounts.
  useEffect(
    () => () => {
      resizeCleanupRef.current?.()
    },
    [],
  )

  const startResize = useCallback(
    (col: ColumnKey, e: React.MouseEvent) => {
      e.preventDefault()
      resizingRef.current = { col, startX: e.clientX, startW: colWidths[col] }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      function onMove(ev: MouseEvent) {
        if (!resizingRef.current) return
        const { col: c, startX, startW } = resizingRef.current
        const next = Math.max(COLUMN_MINS[c], startW + ev.clientX - startX)
        setColWidths((prev) => {
          const updated = { ...prev, [c]: next }
          try {
            localStorage.setItem(STORAGE_KEYS.BACKLOG_COLUMN_WIDTHS, JSON.stringify(updated))
          } catch {
            /* noop */
          }
          return updated
        })
      }
      function onUp() {
        resizingRef.current = null
        resizeCleanupRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      resizeCleanupRef.current = onUp
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [colWidths],
  )

  // ── Navigation ────────────────────────────────────────────────────────────────
  function openItem(item: WorkItem) {
    void navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
  }

  function goNextPage() {
    if (!pageInfo?.hasNextPage || !pageInfo.nextCursor) return
    setCursorHistory((h) => [...h, cursor ?? ''])
    setCursor(pageInfo.nextCursor)
  }

  function goPrevPage() {
    if (cursorHistory.length === 0) return
    const prev = [...cursorHistory]
    const prevCursor = prev.pop()
    setCursorHistory(prev)
    setCursor(prevCursor || undefined)
  }

  // ── Create modal ─────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false)
  const canCreate = useAuthStore((s) => s.hasPermission('work_item:create'))

  // ── Bulk assignment (P2-BL-08) ────────────────────────────────────────────────
  const bulkRelease = useBulkAssignRelease()
  const bulkIteration = useBulkAssignIteration()
  const [bulkError, setBulkError] = useState<string | null>(null)

  async function assignReleaseToSelected(releaseId: string | null) {
    if (!projectId || selectedIds.size === 0) return
    setBulkError(null)
    try {
      await bulkRelease.mutateAsync({ projectId, itemIds: [...selectedIds], releaseId })
      setSelectedIds(new Set())
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Bulk release assignment failed')
    }
  }

  async function assignIterationToSelected(iterationId: string | null) {
    if (!projectId || selectedIds.size === 0) return
    setBulkError(null)
    try {
      await bulkIteration.mutateAsync({ projectId, itemIds: [...selectedIds], iterationId })
      setSelectedIds(new Set())
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Bulk iteration assignment failed')
    }
  }
  // ── Table width ───────────────────────────────────────────────────────────────
  const totalColWidth = Object.values(colWidths).reduce((a, b) => a + b, 0)
  // Row layout: px-3 padding (24px) + checkbox w-5 (20px) + grip w-4 (16px) + row# w-6 (24px) +
  // gap-2 between 12 flex items (11 × 8px = 88px) + column widths
  const tableWidth = 24 + 20 + 16 + 24 + 88 + totalColWidth

  // ── Render ────────────────────────────────────────────────────────────────────
  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm" style={{ color: '#8c94a6' }}>
          Select a project to view the backlog.
        </p>
      </div>
    )
  }

  const COLUMNS: ColumnKey[] = [
    'type',
    'id',
    'name',
    'scheduleState',
    'priority',
    'estimate',
    'owner',
    'release',
    'iteration',
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 bg-white px-4 py-2"
        style={{ borderBottom: '1px solid #e2e6eb' }}
      >
        {/* Title */}
        <h2 className="mr-1 shrink-0 text-[13px] font-semibold" style={{ color: '#1a2234' }}>
          Backlog
        </h2>
        <div className="h-4 w-px shrink-0" style={{ backgroundColor: '#dde2ea' }} />

        {/* Search */}
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
            style={{ color: '#8c94a6' }}
          />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded py-1 pr-3 pl-7 text-[11px] focus:outline-none"
            style={{
              backgroundColor: '#f4f6f9',
              border: '1px solid #dde2ea',
              color: '#1a2234',
              width: 160,
            }}
          />
        </div>

        {/* Type filter */}
        <InlineSelect
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as '' | 'story' | 'defect')}
          aria-label="Filter by type"
          className="w-auto"
        >
          <option value="">All Types</option>
          <option value="story">Story</option>
          <option value="defect">Defect</option>
        </InlineSelect>

        {/* Schedule State filter */}
        <InlineSelect
          value={filterState}
          onChange={(e) => setFilterState(e.target.value)}
          aria-label="Filter by schedule state"
          className="w-auto"
        >
          {SCHEDULE_STATE_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </InlineSelect>

        {/* Owner filter (P2-BL-06) */}
        <InlineSelect
          value={filterOwner}
          onChange={(e) => setFilterOwner(e.target.value)}
          aria-label="Filter by owner"
          className="w-auto"
        >
          <option value="">All Owners</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName ?? m.email ?? m.userId}
            </option>
          ))}
        </InlineSelect>

        {/* Release filter (P2-BL-06) */}
        <InlineSelect
          value={filterRelease}
          onChange={(e) => setFilterRelease(e.target.value)}
          aria-label="Filter by release"
          className="w-auto"
        >
          <option value="">All Releases</option>
          {releases.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </InlineSelect>

        {/* Iteration filter (P2-BL-06) */}
        <InlineSelect
          value={filterIteration}
          onChange={(e) => setFilterIteration(e.target.value)}
          aria-label="Filter by iteration"
          className="w-auto"
        >
          <option value="">All Iterations</option>
          {iterations.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
        </InlineSelect>

        <div className="flex-1" />

        {/* Create Work Item button — right side of toolbar */}
        <button
          onClick={() => setShowCreate(true)}
          disabled={!canCreate}
          title={!canCreate ? 'You do not have permission to create work items' : undefined}
          className="flex items-center gap-1.5 rounded px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: BRAND.primary }}
        >
          <Plus size={12} />
          Create Work Item
        </button>
      </div>

      {/* Bulk action bar (P2-BL-08) */}
      {selectedIds.size > 0 && (
        <div
          className="flex shrink-0 items-center gap-2 px-4 py-1.5"
          style={{ backgroundColor: '#edf2fb', borderBottom: '1px solid #bdd0ef' }}
        >
          <span className="mr-1 text-[11px] font-semibold" style={{ color: '#2558a6' }}>
            {selectedIds.size} selected
          </span>

          {canEdit && (
            <>
              {/* Bulk assign Release */}
              <InlineSelect
                value=""
                disabled={bulkRelease.isPending}
                onChange={(e) => {
                  if (!e.target.value) return
                  void assignReleaseToSelected(e.target.value === '__none__' ? null : e.target.value)
                }}
                className="w-auto"
                aria-label="Assign release to selected"
              >
                <option value="">Assign Release…</option>
                <option value="__none__">— Unschedule —</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </InlineSelect>

              {/* Bulk assign Iteration */}
              <InlineSelect
                value=""
                disabled={bulkIteration.isPending}
                onChange={(e) => {
                  if (!e.target.value) return
                  void assignIterationToSelected(e.target.value === '__none__' ? null : e.target.value)
                }}
                className="w-auto"
                aria-label="Assign iteration to selected"
              >
                <option value="">Assign Iteration…</option>
                <option value="__none__">— Unschedule —</option>
                {iterations.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </InlineSelect>
            </>
          )}

          {bulkError && (
            <span className="text-[11px]" style={{ color: '#b91c1c' }}>
              {bulkError}
            </span>
          )}

          <div className="flex-1" />
          <button
            onClick={() => {
              setSelectedIds(new Set())
              setBulkError(null)
            }}
            className="p-0.5"
            style={{ color: '#5c6478' }}
            aria-label="Clear selection"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Table area */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden bg-white">
          <div className="flex-1 overflow-auto">
            <div style={{ width: tableWidth, minWidth: '100%' }}>
              {/* Header row */}
              <div
                className="sticky top-0 z-10 flex h-8 items-center gap-2 px-3 select-none"
                style={{ backgroundColor: '#f7f8fa', borderBottom: '1px solid #e2e6eb' }}
              >
                <div className="w-5 shrink-0">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded"
                    style={{ accentColor: '#1d3f73' }}
                    aria-label="Select all"
                  />
                </div>
                <div className="w-4 shrink-0" />
                <div
                  className="w-6 shrink-0 text-right text-[9px] font-semibold tracking-wider uppercase"
                  style={{ color: '#8c94a6' }}
                >
                  #
                </div>
                {COLUMNS.map((col) => (
                  <ResizableHeader
                    key={col}
                    column={col}
                    label={COLUMN_LABELS[col]}
                    width={colWidths[col]}
                    align={col === 'estimate' ? 'center' : 'left'}
                    onResizeStart={startResize}
                  />
                ))}
              </div>

              {/* Loading */}
              {isLoading && <SkeletonList rows={10} cols={7} />}

              {/* Error */}
              {isError && !isLoading && (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-sm" style={{ color: '#b91c1c' }}>
                    {error instanceof Error ? error.message : 'Failed to load backlog.'}
                  </p>
                </div>
              )}

              {/* Empty */}
              {!isLoading && !isError && items.length === 0 && (
                <div className="flex h-32 flex-col items-center justify-center gap-2">
                  <p className="text-sm" style={{ color: '#8c94a6' }}>
                    No backlog items match your filters.
                  </p>
                  <button
                    onClick={() => setShowCreate(true)}
                    disabled={!canCreate}
                    className="text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ color: '#2558a6' }}
                  >
                    + Create Work Item
                  </button>
                </div>
              )}

              {/* Rows */}
              {!isLoading && !isError && (
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={localItems.map((it) => it.id)} strategy={verticalListSortingStrategy}>
                    {localItems.map((item, idx) => (
                      <BacklogRow
                        key={item.id}
                        item={item}
                        rowNum={(currentPage - 1) * pageSize + idx + 1}
                        selected={selectedIds.has(item.id)}
                        onToggleSelect={() => toggleSelect(item.id)}
                        onOpen={() => openItem(item)}
                        colWidths={colWidths}
                        tableWidth={tableWidth}
                        canEdit={canEdit}
                        members={members}
                        releases={releases}
                        iterations={iterations}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>

          {/* Pagination footer */}
          <div
            className="flex h-10 shrink-0 items-center justify-between bg-white px-3"
            style={{ borderTop: '1px solid #e2e6eb' }}
          >
            <div className="flex items-center gap-2 text-[11px]" style={{ color: '#5c6478' }}>
              <span>Rows per page</span>
              <InlineSelect
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-auto"
              >
                {[10, 25, 50, 100].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </InlineSelect>
              <span style={{ color: '#8c94a6' }}>
                {pageInfo
                  ? `${(currentPage - 1) * pageSize + 1}–${(currentPage - 1) * pageSize + items.length} ${pageInfo.total ? `of ${pageInfo.total}` : ''}`
                  : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] tabular-nums" style={{ color: '#5c6478' }}>
                Page {currentPage}
              </span>
              <button
                aria-label="Previous page"
                disabled={currentPage === 1}
                onClick={goPrevPage}
                className="rounded p-1.5 disabled:opacity-35"
                style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
              >
                <ChevronLeft size={13} />
              </button>
              <button
                aria-label="Next page"
                disabled={!pageInfo?.hasNextPage}
                onClick={goNextPage}
                className="rounded p-1.5 disabled:opacity-35"
                style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateWorkItemModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={(item) => {
            setShowCreate(false)
            toast.success(`${item.type === 'defect' ? 'Defect' : 'Story'} "${item.title}" created`)
          }}
          onCreatedWithDetails={(item) => {
            setShowCreate(false)
            void navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
          }}
        />
      )}
    </div>
  )
}

// ── Backlog row with inline editing (P2-BL-07) ──────────────────────────────────

interface BacklogRowProps {
  item: WorkItem
  rowNum: number
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  colWidths: Record<ColumnKey, number>
  tableWidth: number
  canEdit: boolean
  members: Array<{ userId: string; displayName?: string; email?: string }>
  releases: Array<{ id: string; name: string }>
  iterations: Array<{ id: string; name: string }>
}

// inline table selects use <InlineSelect> component directly

function BacklogRow({
  item,
  rowNum,
  selected,
  onToggleSelect,
  onOpen,
  colWidths,
  canEdit,
  members,
  releases,
  iterations,
}: BacklogRowProps) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: item.id })
  const update = useUpdateWorkItem(item.id)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(item.title)

  // Fire a PATCH only when the value actually changed; errors surface via the
  // mutation cache (the list re-reads the source of truth on invalidate).
  function patch(body: Parameters<typeof update.mutate>[0]) {
    update.mutate(body)
  }

  function commitTitle() {
    setEditingTitle(false)
    const next = titleDraft.trim()
    if (next && next !== item.title) patch({ title: next })
    else setTitleDraft(item.title)
  }

  const ownerName = (() => {
    const m = members.find((m) => m.userId === item.assigneeId)
    return m?.displayName ?? m?.email
  })()

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      ref={setNodeRef}
      className="group flex h-8 items-center gap-2 px-3 hover:bg-[#f7f8fa]"
      style={{
        minWidth: '100%',
        backgroundColor: isDragging ? '#edf2fb' : selected ? '#f3f6fb' : undefined,
        borderBottom: '1px solid #edf0f4',
        opacity: isDragging ? 0.6 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
        position: isDragging ? 'relative' : undefined,
      }}
      {...attributes}
    >
      {/* Checkbox */}
      <div className="w-5 shrink-0" onClick={stop}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-3.5 w-3.5 rounded"
          style={{ accentColor: '#1d3f73' }}
          aria-label={`Select ${item.itemKey}`}
        />
      </div>

      {/* Drag handle (visible on hover, activates drag) */}
      <div
        ref={setActivatorNodeRef}
        className="w-4 shrink-0 cursor-grab opacity-0 group-hover:opacity-100 active:cursor-grabbing"
        {...listeners}
      >
        <GripVertical size={11} style={{ color: '#8c94a6' }} />
      </div>

      {/* Row number */}
      <div className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums" style={{ color: '#8c94a6' }}>
        {rowNum}
      </div>

      {/* Type */}
      <div className="shrink-0 overflow-hidden" style={{ width: colWidths.type }}>
        <TypeBadge type={item.type} />
      </div>

      {/* ID — opens detail */}
      <button
        className="shrink-0 overflow-hidden text-left font-mono text-[10px] underline-offset-2 hover:underline"
        style={{ width: colWidths.id, color: '#2558a6' }}
        onClick={onOpen}
      >
        {item.itemKey}
      </button>

      {/* Title — inline edit */}
      <div className="min-w-0 shrink-0 pr-2" style={{ width: colWidths.name }} onClick={stop}>
        {editingTitle && canEdit ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') {
                setTitleDraft(item.title)
                setEditingTitle(false)
              }
            }}
            className="w-full rounded px-1 py-0.5 text-[12px] focus:outline-none"
            style={{ border: '1px solid #9fb5d5', color: '#1a2234' }}
          />
        ) : (
          <span
            className="block truncate text-[12px] font-medium"
            style={{ color: '#1a2234', cursor: canEdit ? 'text' : 'pointer' }}
            onClick={() => (canEdit ? setEditingTitle(true) : onOpen())}
            title={item.title}
          >
            {item.title}
          </span>
        )}
      </div>

      {/* Schedule State — inline select */}
      <div className="shrink-0 overflow-hidden" style={{ width: colWidths.scheduleState }} onClick={stop}>
        {canEdit ? (
          <InlineCellSelect
            value={item.scheduleState}
            displayValue={SCHEDULE_STATE_LABEL[item.scheduleState as ScheduleState] ?? item.scheduleState}
            onChange={(e) =>
              patch({ scheduleState: e.target.value as UpdateWorkItemInput['scheduleState'] })
            }
            aria-label="Schedule state"
          >
            {SCHEDULE_STATE_VALUES.map((s) => (
              <option key={s} value={s}>
                {SCHEDULE_STATE_LABEL[s as ScheduleState] ?? s}
              </option>
            ))}
          </InlineCellSelect>
        ) : (
          <ScheduleStateBadge state={item.scheduleState} />
        )}
      </div>

      {/* Priority — defects only */}
      <div className="shrink-0 overflow-hidden" style={{ width: colWidths.priority }} onClick={stop}>
        {item.type === 'defect' ? (
          canEdit ? (
            <InlineCellSelect
              value={item.priority ?? ''}
              displayValue={item.priority ?? '—'}
              onChange={(e) =>
                patch({ priority: e.target.value as UpdateWorkItemInput['priority'] })
              }
              aria-label="Priority"
            >
              {PRIORITY_VALUES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </InlineCellSelect>
          ) : (
            <PriorityBadge priority={item.priority} />
          )
        ) : (
          <span className="font-mono text-[10px]" style={{ color: '#a0a7b5' }}>
            —
          </span>
        )}
      </div>

      {/* Plan Estimate — inline number */}
      <div className="shrink-0 text-center" style={{ width: colWidths.estimate }} onClick={stop}>
        {canEdit ? (
          <input
            type="number"
            min={0}
            defaultValue={item.storyPoints ?? ''}
            onBlur={(e) => {
              const raw = e.target.value
              const next = raw === '' ? null : Number(raw)
              if (next !== (item.storyPoints ?? null)) patch({ storyPoints: next })
            }}
            className="w-12 rounded px-1 py-0.5 text-center font-mono text-[10px] focus:outline-none"
            style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
            aria-label="Plan estimate"
          />
        ) : (
          <span className="font-mono text-[10px] font-semibold" style={{ color: '#5c6478' }}>
            {item.storyPoints ?? '—'}
          </span>
        )}
      </div>

      {/* Owner — inline select */}
      <div className="shrink-0 overflow-hidden" style={{ width: colWidths.owner }} onClick={stop}>
        {canEdit ? (
          <InlineCellSelect
            value={item.assigneeId ?? ''}
            displayValue={ownerName ?? 'Unassigned'}
            muted={!item.assigneeId}
            onChange={(e) => patch({ assigneeId: e.target.value || null })}
            aria-label="Owner"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName ?? m.email ?? m.userId}
              </option>
            ))}
          </InlineCellSelect>
        ) : (
          <OwnerCell name={ownerName} />
        )}
      </div>

      {/* Release — inline select */}
      <div className="shrink-0 overflow-hidden" style={{ width: colWidths.release }} onClick={stop}>
        {canEdit ? (
          <InlineCellSelect
            value={item.releaseId ?? ''}
            displayValue={releases.find((r) => r.id === item.releaseId)?.name ?? '—'}
            muted={!item.releaseId}
            onChange={(e) => patch({ releaseId: e.target.value || null })}
            aria-label="Release"
          >
            <option value="">—</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </InlineCellSelect>
        ) : (
          <span className="truncate text-[11px]" style={{ color: item.releaseId ? '#1a2234' : '#a0a7b5' }}>
            {releases.find((r) => r.id === item.releaseId)?.name ?? '—'}
          </span>
        )}
      </div>

      {/* Iteration — inline select */}
      <div className="shrink-0 overflow-hidden" style={{ width: colWidths.iteration }} onClick={stop}>
        {canEdit ? (
          <InlineCellSelect
            value={item.iterationId ?? ''}
            displayValue={iterations.find((it) => it.id === item.iterationId)?.name ?? '—'}
            muted={!item.iterationId}
            onChange={(e) => patch({ iterationId: e.target.value || null })}
            aria-label="Iteration"
          >
            <option value="">—</option>
            {iterations.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </InlineCellSelect>
        ) : (
          <span className="truncate text-[11px]" style={{ color: item.iterationId ? '#1a2234' : '#a0a7b5' }}>
            {iterations.find((it) => it.id === item.iterationId)?.name ?? '—'}
          </span>
        )}
      </div>
    </div>
  )
}
