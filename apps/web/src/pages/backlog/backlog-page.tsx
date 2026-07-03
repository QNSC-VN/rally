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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, GripVertical, Plus, Search, X } from 'lucide-react'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import {
  useBacklog,
  useUpdateWorkItem,
  useBulkAssignRelease,
  useBulkAssignIteration,
  type WorkItem,
  type UpdateWorkItemInput,
} from '@/features/work-items/api'
import { useReleases } from '@/features/releases/api'
import { useProjectMembers } from '@/features/teams/api'
import { useIterations } from '@/features/iterations/api'
import { TypeBadge, ScheduleStateBadge, PriorityBadge } from '@/entities/work-item/ui/badges'
import { CreateWorkItemModal } from '@/features/work-items/ui/create-work-item-modal'

const SCHEDULE_STATE_VALUES = [
  'idea',
  'defined',
  'in_progress',
  'completed',
  'accepted',
  'released',
] as const
const PRIORITY_VALUES = ['none', 'low', 'normal', 'high', 'urgent'] as const

// ── Column definitions ─────────────────────────────────────────────────────────

type ColumnKey = 'type' | 'id' | 'name' | 'scheduleState' | 'priority' | 'estimate' | 'owner'

const COLUMN_MINS: Record<ColumnKey, number> = {
  type: 60,
  id: 64,
  name: 180,
  scheduleState: 120,
  priority: 80,
  estimate: 44,
  owner: 90,
}

const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  type: 72,
  id: 88,
  name: 480,
  scheduleState: 136,
  priority: 96,
  estimate: 52,
  owner: 120,
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  type: 'Type',
  id: 'ID',
  name: 'Name',
  scheduleState: 'Schedule State',
  priority: 'Priority',
  estimate: 'Est.',
  owner: 'Owner',
}

const LS_WIDTHS_KEY = 'rally-backlog-col-widths'

function loadSavedWidths(): Record<ColumnKey, number> {
  try {
    const raw = localStorage.getItem(LS_WIDTHS_KEY)
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
        color: '#8c94a6',
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
  { value: '', label: 'All States' },
  { value: 'idea', label: 'Idea' },
  { value: 'defined', label: 'Defined' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'released', label: 'Released' },
] as const

export function BacklogPage() {
  const navigate = useNavigate()
  const { project } = useAppContext()
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
  const { data: iterations = [] } = useIterations(projectId)

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

  const items = data?.data ?? []
  const pageInfo = data?.pageInfo

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
            localStorage.setItem(LS_WIDTHS_KEY, JSON.stringify(updated))
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
  const tableWidth = 5 + 20 + 16 + 24 + 8 + totalColWidth // checkbox + grip + row# + gaps

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
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as '' | 'story' | 'defect')}
          className="rounded bg-white px-2 py-1 text-[11px] focus:outline-none"
          style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
          aria-label="Filter by type"
        >
          <option value="">All Types</option>
          <option value="story">Story</option>
          <option value="defect">Defect</option>
        </select>

        {/* Schedule State filter */}
        <select
          value={filterState}
          onChange={(e) => setFilterState(e.target.value)}
          className="rounded bg-white px-2 py-1 text-[11px] focus:outline-none"
          style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
          aria-label="Filter by schedule state"
        >
          {SCHEDULE_STATE_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Owner filter (P2-BL-06) */}
        <select
          value={filterOwner}
          onChange={(e) => setFilterOwner(e.target.value)}
          className="rounded bg-white px-2 py-1 text-[11px] focus:outline-none"
          style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
          aria-label="Filter by owner"
        >
          <option value="">All Owners</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName ?? m.email ?? m.userId}
            </option>
          ))}
        </select>

        {/* Release filter (P2-BL-06) */}
        <select
          value={filterRelease}
          onChange={(e) => setFilterRelease(e.target.value)}
          className="rounded bg-white px-2 py-1 text-[11px] focus:outline-none"
          style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
          aria-label="Filter by release"
        >
          <option value="">All Releases</option>
          {releases.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        {/* Iteration filter (P2-BL-06) */}
        <select
          value={filterIteration}
          onChange={(e) => setFilterIteration(e.target.value)}
          className="rounded bg-white px-2 py-1 text-[11px] focus:outline-none"
          style={{ border: '1px solid #dde2ea', color: '#5c6478' }}
          aria-label="Filter by iteration"
        >
          <option value="">All Iterations</option>
          {iterations.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {/* Create Work Item button — right side of toolbar */}
        <button
          onClick={() => setShowCreate(true)}
          disabled={!canCreate}
          title={!canCreate ? 'You do not have permission to create work items' : undefined}
          className="flex items-center gap-1.5 rounded px-3 py-1 text-[11px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: '#1d3f73' }}
          onMouseEnter={(e) => {
            if (canCreate) e.currentTarget.style.backgroundColor = '#163259'
          }}
          onMouseLeave={(e) => {
            if (canCreate) e.currentTarget.style.backgroundColor = '#1d3f73'
          }}
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
              <select
                value=""
                disabled={bulkRelease.isPending}
                onChange={(e) => {
                  if (!e.target.value) return
                  void assignReleaseToSelected(e.target.value === '__none__' ? null : e.target.value)
                }}
                className="rounded bg-white px-2 py-1 text-[11px] focus:outline-none disabled:opacity-50"
                style={{ border: '1px solid #bdd0ef', color: '#2558a6' }}
                aria-label="Assign release to selected"
              >
                <option value="">Assign Release…</option>
                <option value="__none__">— Unschedule —</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              {/* Bulk assign Iteration */}
              <select
                value=""
                disabled={bulkIteration.isPending}
                onChange={(e) => {
                  if (!e.target.value) return
                  void assignIterationToSelected(e.target.value === '__none__' ? null : e.target.value)
                }}
                className="rounded bg-white px-2 py-1 text-[11px] focus:outline-none disabled:opacity-50"
                style={{ border: '1px solid #bdd0ef', color: '#2558a6' }}
                aria-label="Assign iteration to selected"
              >
                <option value="">Assign Iteration…</option>
                <option value="__none__">— Unschedule —</option>
                {iterations.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
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
              {isLoading && (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )}

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
              {!isLoading &&
                !isError &&
                items.map((item, idx) => (
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
                    iterations={iterations}
                  />
                ))}
            </div>
          </div>

          {/* Pagination footer */}
          <div
            className="flex h-10 shrink-0 items-center justify-between bg-white px-3"
            style={{ borderTop: '1px solid #e2e6eb' }}
          >
            <div className="flex items-center gap-2 text-[11px]" style={{ color: '#5c6478' }}>
              <span>Rows per page</span>
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded bg-white px-2 py-1 focus:outline-none"
                style={{ border: '1px solid #dde2ea', color: '#1a2234' }}
              >
                {[10, 25, 50, 100].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
          onCreated={() => setShowCreate(false)}
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
//
// Inline-edits Title, Schedule State, Priority (defects only), Plan Estimate and
// Owner via PATCH /work-items/:id. Release/Iteration reassignment is handled by
// the bulk bars (P2-BL-08) and the Work Item Detail panel, since the backlog
// table does not surface Release/Iteration columns.

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
  iterations: Array<{ id: string; name: string }>
}

const inlineSelectCls =
  'w-full rounded bg-white px-1 py-0.5 text-[11px] focus:outline-none'
const inlineSelectStyle = { border: '1px solid #dde2ea', color: '#1a2234' }

function BacklogRow({
  item,
  rowNum,
  selected,
  onToggleSelect,
  onOpen,
  colWidths,
  canEdit,
  members,
}: BacklogRowProps) {
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

  const ownerName =
    members.find((m) => m.userId === item.assigneeId)?.displayName ??
    members.find((m) => m.userId === item.assigneeId)?.email

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      className="group flex h-8 items-center gap-2 px-3 hover:bg-[#f7f8fa]"
      style={{
        minWidth: '100%',
        backgroundColor: selected ? '#f3f6fb' : undefined,
        borderBottom: '1px solid #edf0f4',
      }}
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

      {/* Grip */}
      <div className="w-4 shrink-0 opacity-0 group-hover:opacity-100">
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
          <select
            value={item.scheduleState}
            onChange={(e) =>
              patch({ scheduleState: e.target.value as UpdateWorkItemInput['scheduleState'] })
            }
            className={inlineSelectCls}
            style={inlineSelectStyle}
            aria-label="Schedule state"
          >
            {SCHEDULE_STATE_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <ScheduleStateBadge state={item.scheduleState} />
        )}
      </div>

      {/* Priority — defects only */}
      <div className="shrink-0 overflow-hidden" style={{ width: colWidths.priority }} onClick={stop}>
        {item.type === 'defect' ? (
          canEdit ? (
            <select
              value={item.priority}
              onChange={(e) =>
                patch({ priority: e.target.value as UpdateWorkItemInput['priority'] })
              }
              className={inlineSelectCls}
              style={inlineSelectStyle}
              aria-label="Priority"
            >
              {PRIORITY_VALUES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
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
          <select
            value={item.assigneeId ?? ''}
            onChange={(e) => patch({ assigneeId: e.target.value || null })}
            className={inlineSelectCls}
            style={inlineSelectStyle}
            aria-label="Owner"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName ?? m.email ?? m.userId}
              </option>
            ))}
          </select>
        ) : (
          <OwnerCell name={ownerName} />
        )}
      </div>
    </div>
  )
}
