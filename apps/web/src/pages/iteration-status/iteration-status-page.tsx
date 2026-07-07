/**
 * Track › Iteration Status — P2.3
 *
 * Tracking view over the work items assigned to one selected iteration:
 * selector (prev/next + dropdown), metric strip (from the backend read-model),
 * and an editable work-item list. Add Item creates a Story/Defect directly in
 * the selected iteration. Sourced from /v1/iterations/:id/status.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Filter,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { SkeletonList } from '@/shared/ui/skeleton'
import { InlineSelect } from '@/shared/ui/native-select'
import { BRAND } from '@/shared/config/brand'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import {
  useIterations,
  useIterationStatus,
  useCreateIterationItem,
  type Iteration,
  type IterationStatusItem,
} from '@/features/iterations/api'
import { useRankWorkItemMutation, useUpdateWorkItem } from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { ScheduleStateBadge } from '@/entities/work-item/ui/badges'
import {
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  type ScheduleState,
} from '@/entities/work-item/model/types'

function fmtRange(it: Pick<Iteration, 'startDate' | 'endDate'>) {
  const s = it.startDate ?? '—'
  const e = it.endDate ?? '—'
  return `${s} → ${e}`
}

type IterationColumnKey = 'rank' | 'id' | 'name' | 'scheduleState' | 'iteration' | 'blocked' | 'planEstimate' | 'taskEstimate' | 'toDo' | 'owner'
type IterationFilterColumn = 'id' | 'name' | 'type' | 'scheduleState' | 'iteration' | 'blocked' | 'planEstimate' | 'taskEstimate' | 'toDo' | 'owner'
type IterationFilters = Partial<Record<IterationFilterColumn, string>>
type IterationSort = { column: IterationColumnKey; direction: 'asc' | 'desc' }

const ITERATION_FILTER_COLUMNS: Array<{ key: IterationFilterColumn; label: string; mode: 'search' | 'select' }> = [
  { key: 'id', label: 'ID', mode: 'search' },
  { key: 'name', label: 'Name', mode: 'search' },
  { key: 'type', label: 'Type', mode: 'select' },
  { key: 'scheduleState', label: 'Schedule State', mode: 'select' },
  { key: 'iteration', label: 'Iteration', mode: 'select' },
  { key: 'blocked', label: 'Blocked', mode: 'select' },
  { key: 'planEstimate', label: 'Plan Est', mode: 'search' },
  { key: 'taskEstimate', label: 'Task Est', mode: 'search' },
  { key: 'toDo', label: 'To Do', mode: 'search' },
  { key: 'owner', label: 'Owner', mode: 'select' },
]

const ITERATION_COLUMNS: Array<{ key: IterationColumnKey; label: string; width: number; align?: 'center' | 'right' }> = [
  { key: 'rank', label: '#', width: 34, align: 'center' },
  { key: 'id', label: 'ID', width: 72 },
  { key: 'name', label: 'Name', width: 360 },
  { key: 'scheduleState', label: 'Schedule State', width: 128 },
  { key: 'iteration', label: 'Iteration', width: 140 },
  { key: 'blocked', label: 'Blocked', width: 72, align: 'center' },
  { key: 'planEstimate', label: 'Plan Est', width: 72, align: 'right' },
  { key: 'taskEstimate', label: 'Task Est', width: 72, align: 'right' },
  { key: 'toDo', label: 'To Do', width: 62, align: 'right' },
  { key: 'owner', label: 'Owner', width: 170 },
]

function compareIterationValues(a: string | number, b: string | number) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function SortableHeader({
  column,
  sort,
  onSort,
}: {
  column: (typeof ITERATION_COLUMNS)[number]
  sort: IterationSort | null
  onSort: (column: IterationColumnKey) => void
}) {
  const active = sort?.column === column.key
  const SortIcon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <div
      className="relative flex h-full shrink-0 items-center text-[11px] font-semibold uppercase select-none"
      style={{
        width: column.width,
        color: active ? BRAND.primary : BRAND.textMuted,
        justifyContent:
          column.align === 'center' ? 'center' : column.align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className="flex h-full min-w-0 items-center gap-1 rounded-sm focus:outline-none"
        style={{
          width: 'calc(100% - 8px)',
          justifyContent:
            column.align === 'center' ? 'center' : column.align === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        <span className="truncate">{column.label}</span>
        <SortIcon size={10} className="shrink-0" />
      </button>
      <div className="absolute top-1 right-[3px] bottom-1 w-px" style={{ backgroundColor: '#d9dee7' }} />
    </div>
  )
}

export function IterationStatusPage() {
  const navigate = useNavigate()
  const { project } = useAppContext()
  const projectId = project?.projectId
  const canEdit = useAuthStore((s) => s.hasPermission('work_item:edit'))
  const canCreate = useAuthStore((s) => s.hasPermission('work_item:create'))

  const { data: iterations = [] } = useIterations(projectId)
  const { data: members = [] } = useProjectMembers(projectId)

  // O(1) member lookup — avoids O(n×m) per-row array scan
  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  )
  // Explicit user choice; falls back to the first iteration until one is picked.
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<IterationFilters>({})
  const [showManageFilters, setShowManageFilters] = useState(false)
  const [filterColumnSearch, setFilterColumnSearch] = useState('')
  const [pendingFilterColumns, setPendingFilterColumns] = useState<Set<IterationFilterColumn>>(new Set())
  const [sort, setSort] = useState<IterationSort | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pageSize, setPageSize] = useState(25)
  const [currentPage, setCurrentPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)
  const rankWorkItem = useRankWorkItemMutation()

  // Derive the effective selection during render (no setState-in-effect): the
  // chosen id when it's still present, otherwise the first iteration.
  const selectedId =
    chosenId && iterations.some((i) => i.id === chosenId)
      ? chosenId
      : (iterations[0]?.id ?? null)
  const setSelectedId = setChosenId

  const { data: status, isLoading } = useIterationStatus(selectedId ?? undefined, {
    q: search.trim() || undefined,
  })

  const selectedIndex = useMemo(
    () => iterations.findIndex((i) => i.id === selectedId),
    [iterations, selectedId],
  )
  const selected = iterations[selectedIndex]

  function move(dir: -1 | 1) {
    const next = selectedIndex + dir
    if (next >= 0 && next < iterations.length) setSelectedId(iterations[next].id)
  }

  const activeFilterColumns = ITERATION_FILTER_COLUMNS.filter((column) => filters[column.key] !== undefined)
  const activeFilterCount = activeFilterColumns.length
  const availableFilterColumns = ITERATION_FILTER_COLUMNS.filter((column) =>
    column.label.toLowerCase().includes(filterColumnSearch.toLowerCase()),
  )

  function openManageFilters() {
    setShowFilters(true)
    setPendingFilterColumns(new Set(activeFilterColumns.map((column) => column.key)))
    setShowManageFilters(true)
  }

  function togglePendingFilterColumn(column: IterationFilterColumn) {
    setPendingFilterColumns((previous) => {
      const next = new Set(previous)
      if (next.has(column)) next.delete(column)
      else next.add(column)
      return next
    })
  }

  function applyManagedFilters() {
    setFilters((previous) => {
      const next: IterationFilters = {}
      pendingFilterColumns.forEach((column) => {
        next[column] = previous[column] ?? ''
      })
      return next
    })
    setShowManageFilters(false)
    setCurrentPage(1)
  }

  function updateManagedFilter(column: IterationFilterColumn, value: string) {
    setFilters((previous) => ({ ...previous, [column]: value }))
    setCurrentPage(1)
  }

  function removeManagedFilter(column: IterationFilterColumn) {
    setFilters((previous) => {
      const next = { ...previous }
      delete next[column]
      return next
    })
    setCurrentPage(1)
  }

  function toggleSort(column: IterationColumnKey) {
    setSort((previous) =>
      previous?.column === column
        ? { column, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: ['id', 'planEstimate', 'taskEstimate', 'toDo'].includes(column) ? 'desc' : 'asc' },
    )
  }

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px]" style={{ color: BRAND.textMuted }}>
        Select a project to view Iteration Status.
      </div>
    )
  }

  if (!iterations.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[13px]" style={{ color: BRAND.textMuted }}>
        <span>No iterations in this project/team yet.</span>
        <button onClick={() => navigate({ to: '/timeboxes' })} className="cursor-pointer text-[12px] font-semibold hover:underline" style={{ color: BRAND.primaryLight }}>
          Go to Timeboxes →
        </button>
      </div>
    )
  }

  const metrics = status?.metrics
  const velocityPct = metrics?.plannedVelocityPercent ?? 0
  const rawItems = status?.items ?? []
  const filteredItems = rawItems
    .filter((item) =>
      activeFilterColumns.every((filter) => {
        const value = (filters[filter.key] ?? '').trim()
        if (!value) return true
        const normalized = value.toLowerCase()
        switch (filter.key) {
          case 'id':
            return item.itemKey.toLowerCase().includes(normalized)
          case 'name':
            return item.title.toLowerCase().includes(normalized)
          case 'type':
            return item.type === value
          case 'scheduleState':
            return item.scheduleState === value
          case 'iteration':
            return item.iterationId === value
          case 'blocked':
            return String(Boolean(item.isBlocked)) === value
          case 'planEstimate':
            return String(item.planEstimate ?? '').includes(value)
          case 'taskEstimate':
            return String(item.taskEstimate ?? '').includes(value)
          case 'toDo':
            return String(item.toDo ?? '').includes(value)
          case 'owner':
            return item.assigneeId === value
        }
      }),
    )
    .sort((a, b) => {
      if (!sort) return 0
      const valueFor = (item: IterationStatusItem, index: number): string | number => {
        switch (sort.column) {
          case 'rank':
            return index + 1
          case 'id':
            return Number(item.itemKey.replace(/\D/g, '')) || item.itemKey
          case 'name':
            return item.title.toLowerCase()
          case 'scheduleState':
            return SCHEDULE_STATE_LABEL[item.scheduleState as ScheduleState] ?? item.scheduleState
          case 'iteration':
            return iterations.find((it) => it.id === item.iterationId)?.name ?? ''
          case 'blocked':
            return item.isBlocked ? 1 : 0
          case 'planEstimate':
            return item.planEstimate ?? 0
          case 'taskEstimate':
            return item.taskEstimate ?? 0
          case 'toDo':
            return item.toDo ?? 0
          case 'owner':
            return memberMap.get(item.assigneeId ?? '')?.displayName ?? ''
        }
      }
      const result = compareIterationValues(valueFor(a, rawItems.indexOf(a)), valueFor(b, rawItems.indexOf(b)))
      return sort.direction === 'asc' ? result : -result
    })
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const activePage = Math.min(currentPage, totalPages)
  const pageStart = (activePage - 1) * pageSize
  const pageItems = filteredItems.slice(pageStart, pageStart + pageSize)
  const allChecked = pageItems.length > 0 && pageItems.every((item) => selectedIds.has(item.id))

  function getFilterSelectOptions(column: IterationFilterColumn) {
    switch (column) {
      case 'type':
        return [
          { value: '', label: 'All' },
          { value: 'story', label: 'Story' },
          { value: 'defect', label: 'Defect' },
        ]
      case 'scheduleState':
        return [
          { value: '', label: 'All' },
          ...SCHEDULE_STATE_VALUES.map((value) => ({ value, label: SCHEDULE_STATE_LABEL[value as ScheduleState] ?? value })),
        ]
      case 'iteration':
        return [{ value: '', label: 'All' }, ...iterations.map((iteration) => ({ value: iteration.id, label: iteration.name }))]
      case 'blocked':
        return [
          { value: '', label: 'All' },
          { value: 'true', label: 'Blocked' },
          { value: 'false', label: 'Not blocked' },
        ]
      case 'owner':
        return [
          { value: '', label: 'All' },
          ...members.map((member) => ({ value: member.userId, label: member.displayName ?? member.email ?? member.userId })),
        ]
      default:
        return []
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (allChecked) pageItems.forEach((item) => next.delete(item.id))
      else pageItems.forEach((item) => next.add(item.id))
      return next
    })
  }

  async function moveStatusItem(item: IterationStatusItem, direction: -1 | 1) {
    if (!projectId) return
    if (sort && (sort.column !== 'rank' || sort.direction !== 'asc')) {
      toast.warning('Clear sort or sort Rank ascending before reordering.')
      return
    }
    const currentIndex = filteredItems.findIndex((candidate) => candidate.id === item.id)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= filteredItems.length) return

    const nextOrder = filteredItems.filter((candidate) => candidate.id !== item.id)
    nextOrder.splice(nextIndex, 0, item)
    const beforeId = nextOrder[nextIndex - 1]?.id
    const afterId = nextOrder[nextIndex + 1]?.id

    try {
      await rankWorkItem.mutateAsync({
        id: item.id,
        input: { projectId, beforeId, afterId },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reorder work item')
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Selector bar */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0" style={{ backgroundColor: BRAND.surface, borderBottom: `1px solid ${BRAND.borderSubtle}` }}>
        <span className="text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Iteration
        </span>
        <div className="flex items-center rounded overflow-visible" style={{ border: '1px solid #bdd0ef', height: 28 }}>
          <button disabled={selectedIndex <= 0} onClick={() => move(-1)} className="h-full px-2 flex items-center cursor-pointer hover:bg-[#f0f4fb] disabled:cursor-not-allowed disabled:opacity-40" style={{ color: BRAND.primaryLight, borderRight: `1px solid ${BRAND.borderSubtle}` }}>
            <ChevronLeft size={14} />
          </button>
          <div className="relative h-full">
            <button onClick={() => setSelectorOpen((o) => !o)} className="h-full flex cursor-pointer items-center gap-3 px-3 text-left bg-white hover:bg-[#f7f9fc]" style={{ minWidth: 280, color: BRAND.textPrimary }}>
              <span className="text-[12px] font-semibold whitespace-nowrap">{selected?.name}</span>
              <span className="text-[11px] whitespace-nowrap" style={{ color: BRAND.textSecondary }}>
                {selected && fmtRange(selected)}
              </span>
              <ChevronDown size={12} className="ml-auto" style={{ color: BRAND.textSecondary }} />
            </button>
            {selectorOpen && (
              <div className="absolute left-0 top-full mt-1 w-full bg-white rounded shadow-lg z-50 py-1 max-h-72 overflow-auto" style={{ border: `1px solid ${BRAND.border}` }}>
                {iterations.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => {
                      setSelectedId(it.id)
                      setSelectorOpen(false)
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f4f6f9]"
                    style={{ backgroundColor: selectedId === it.id ? '#edf2fb' : 'transparent' }}
                  >
                    <span className="text-[12px] font-semibold flex-1" style={{ color: selectedId === it.id ? BRAND.primary : BRAND.textPrimary }}>
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
          <button disabled={selectedIndex >= iterations.length - 1} onClick={() => move(1)} className="h-full px-2 flex cursor-pointer items-center hover:bg-[#f0f4fb] disabled:cursor-not-allowed disabled:opacity-40" style={{ color: BRAND.primaryLight, borderLeft: `1px solid ${BRAND.borderSubtle}` }}>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="flex-1" />
      </div>

      {/* Metric strip */}
      <div className="flex items-stretch shrink-0" style={{ backgroundColor: BRAND.surface, borderBottom: `1px solid ${BRAND.borderSubtle}`, height: 64 }}>
        <Metric label="Planned Velocity" value={`${velocityPct}%`} sub={`${metrics?.acceptedPoints ?? 0}/${metrics?.plannedVelocity ?? 0} pts`} bar={velocityPct} barColor={velocityPct >= 70 ? '#2a8c3f' : BRAND.primaryLight} />
        <Metric
          label="Iteration End"
          value={metrics?.daysLeft == null ? '—' : String(Math.max(metrics.daysLeft, 0))}
          sub={metrics?.daysLeft == null ? 'no end date' : metrics.daysLeft < 0 ? 'ended' : 'days left'}
          valueColor="#8a5808"
        />
        <Metric label="Accepted" value={`${metrics?.acceptedPercent ?? 0}%`} sub={`${metrics?.acceptedPoints ?? 0} pts`} valueColor="#1e6930" bar={metrics?.acceptedPercent ?? 0} barColor="#2a8c3f" />
        <Metric label="Defects" value={String(metrics?.defectCount ?? 0)} sub="active" valueColor={(metrics?.defectCount ?? 0) > 0 ? BRAND.danger : BRAND.textPrimary} />
        <Metric label="Tasks" value={String(metrics?.taskCount ?? 0)} sub="in iteration" last />
      </div>

      {/* List toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{ backgroundColor: BRAND.surface, borderBottom: `1px solid ${BRAND.borderSubtle}` }}>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: BRAND.textMuted }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter items..." className="pl-7 pr-3 py-1 text-[11px] rounded focus:outline-none" style={{ backgroundColor: BRAND.surfaceSubtle, border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary, width: 200 }} />
        </div>
        <button
          onClick={() => setShowFilters((previous) => !previous)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px]"
          style={{
            border: '1px solid #bdd0ef',
            color: BRAND.primaryLight,
            backgroundColor: showFilters || activeFilterCount > 0 ? '#edf2fb' : '#fff',
          }}
        >
          <Filter size={11} /> {showFilters ? 'Hide filter' : 'Show filter'}
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        <div className="flex-1" />
        {canCreate && (
          <button onClick={() => setShowAdd(true)} className="flex cursor-pointer items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-white rounded transition-opacity hover:opacity-90" style={{ backgroundColor: BRAND.primary }}>
            <Plus size={12} /> Add Item
          </button>
        )}
      </div>

      {showFilters && (
        <div className="shrink-0 px-4 py-3" style={{ backgroundColor: '#f5f8fc', borderBottom: '1px solid #cfdced' }}>
          <div className="relative flex items-start gap-2">
            <div className="relative shrink-0">
              <button onClick={openManageFilters} className="flex items-center gap-1.5 rounded px-3 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: '#4b74d9', border: '1px solid #3d66c8' }}>
                <Filter size={12} /> Manage filters
              </button>
              {showManageFilters && (
                <div className="absolute top-[34px] left-0 z-30 w-[330px] rounded bg-white shadow-xl" style={{ border: '1px solid #cfd6e3' }}>
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #edf0f4' }}>
                    <p className="text-[14px] font-semibold" style={{ color: '#3a4254' }}>Manage Filters</p>
                    <button aria-label="Close manage filters" onClick={() => setShowManageFilters(false)} className="rounded p-1" style={{ color: BRAND.primaryLight }}><X size={16} /></button>
                  </div>
                  <div className="px-4 pt-3">
                    <div className="relative">
                      <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" style={{ color: '#5c6478' }} />
                      <input value={filterColumnSearch} onChange={(event) => setFilterColumnSearch(event.target.value)} placeholder="Search" className="w-full rounded py-2 pr-3 pl-8 text-[12px] focus:outline-none" style={{ border: '1px solid #6aa0ff', color: '#1a2234' }} />
                    </div>
                  </div>
                  <div className="max-h-[250px] overflow-y-auto px-4 py-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase" style={{ color: '#1a2234' }}>Selected</p>
                    {ITERATION_FILTER_COLUMNS.filter((column) => pendingFilterColumns.has(column.key)).length === 0 ? (
                      <p className="mb-3 text-[11px]" style={{ color: '#8c94a6' }}>No columns selected</p>
                    ) : (
                      ITERATION_FILTER_COLUMNS.filter((column) => pendingFilterColumns.has(column.key)).map((column) => (
                        <label key={column.key} className="flex items-center gap-2 py-1.5 text-[12px]" style={{ color: '#1a2234' }}>
                          <input type="checkbox" checked onChange={() => togglePendingFilterColumn(column.key)} className="h-3.5 w-3.5 rounded" style={{ accentColor: '#4b74d9' }} />
                          {column.label}
                        </label>
                      ))
                    )}
                    <p className="mt-2 mb-2 text-[11px] font-semibold uppercase" style={{ color: '#1a2234' }}>Available</p>
                    {availableFilterColumns.filter((column) => !pendingFilterColumns.has(column.key)).map((column) => (
                      <label key={column.key} className="flex items-center gap-2 py-1.5 text-[12px]" style={{ color: '#3a4254' }}>
                        <input type="checkbox" checked={false} onChange={() => togglePendingFilterColumn(column.key)} className="h-3.5 w-3.5 rounded" style={{ accentColor: '#4b74d9' }} />
                        {column.label}
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid #edf0f4' }}>
                    <button onClick={() => setShowManageFilters(false)} className="rounded px-3 py-1.5 text-[12px]" style={{ color: BRAND.primaryLight }}>Cancel</button>
                    <button onClick={applyManagedFilters} className="rounded px-4 py-1.5 text-[12px] font-semibold text-white" style={{ backgroundColor: '#4b74d9' }}>Apply</button>
                  </div>
                </div>
              )}
            </div>
            {activeFilterCount > 0 && (
              <button onClick={() => setFilters({})} className="rounded px-2.5 py-1 text-[11px]" style={{ color: BRAND.primaryLight }}>
                Clear filters
              </button>
            )}
          </div>
          {activeFilterCount === 0 ? (
            <div className="mt-2 rounded bg-white px-3 py-2 text-[11px]" style={{ color: '#8c94a6', border: '1px dashed #cfd6e3' }}>
              No filters selected. Use Manage filters to choose columns.
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {activeFilterColumns.map((columnMeta) => (
                <div key={columnMeta.key} className="flex items-center gap-1.5 rounded bg-white px-2 py-1.5" style={{ border: '1px solid #dde2ea' }}>
                  <span className="text-[11px] font-semibold" style={{ color: '#3a4254' }}>{columnMeta.label}</span>
                  {columnMeta.mode === 'search' ? (
                    <input aria-label={`${columnMeta.label} filter value`} type={['planEstimate', 'taskEstimate', 'toDo'].includes(columnMeta.key) ? 'number' : 'text'} value={filters[columnMeta.key] ?? ''} onChange={(event) => updateManagedFilter(columnMeta.key, event.target.value)} className="rounded px-2 py-1 text-[11px] focus:outline-none" style={{ width: columnMeta.key === 'name' ? 220 : 128, border: '1px solid #dde2ea', color: '#1a2234' }} />
                  ) : (
                    <select aria-label={`${columnMeta.label} filter value`} value={filters[columnMeta.key] ?? ''} onChange={(event) => updateManagedFilter(columnMeta.key, event.target.value)} className="rounded bg-white px-2 py-1 text-[11px] focus:outline-none" style={{ minWidth: 132, border: '1px solid #dde2ea', color: '#1a2234' }}>
                      {getFilterSelectOptions(columnMeta.key).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  )}
                  <button aria-label={`Remove ${columnMeta.label} filter`} onClick={() => removeManagedFilter(columnMeta.key)} className="rounded p-1" style={{ color: '#8c94a6' }}><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Work item list */}
      <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: BRAND.surface }}>
        <div className="flex-1 overflow-auto">
          <div style={{ width: 24 + 20 + 16 + ITERATION_COLUMNS.reduce((sum, column) => sum + column.width, 0), minWidth: '100%' }}>
            <div className="sticky top-0 z-10 flex h-8 items-center gap-2 px-3 select-none" style={{ backgroundColor: BRAND.surfaceHover, borderBottom: `1px solid ${BRAND.borderSubtle}` }}>
              <div className="w-5 shrink-0">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-3.5 w-3.5 rounded" style={{ accentColor: BRAND.primary }} aria-label="Select all iteration items" />
              </div>
              <div className="w-4 shrink-0" />
              {ITERATION_COLUMNS.map((column) => (
                <SortableHeader key={column.key} column={column} sort={sort} onSort={toggleSort} />
              ))}
            </div>

            {isLoading && <SkeletonList rows={10} cols={10} />}

            {!isLoading &&
              pageItems.map((item, index) => (
                <StatusRow
                  key={item.id}
                  item={item}
                  rowNum={pageStart + index + 1}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleSelect(item.id)}
                  iterations={iterations}
                  memberMap={memberMap}
                  selectedIterationId={selectedId!}
                  canEdit={canEdit}
                  canMoveUp={pageStart + index > 0}
                  canMoveDown={pageStart + index < filteredItems.length - 1}
                  isMoving={rankWorkItem.isPending}
                  onMoveUp={() => void moveStatusItem(item, -1)}
                  onMoveDown={() => void moveStatusItem(item, 1)}
                  onOpen={() => navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })}
                />
              ))}

            {!isLoading && pageItems.length === 0 && (
              <div className="flex h-40 items-center justify-center text-[12px]" style={{ color: BRAND.textMuted }}>
                No items assigned to this iteration
              </div>
            )}
          </div>
        </div>

        <div className="flex h-10 shrink-0 items-center justify-between bg-white px-3" style={{ borderTop: `1px solid ${BRAND.borderSubtle}` }}>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: BRAND.textSecondary }}>
            <span>Rows per page</span>
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setCurrentPage(1) }} className="rounded bg-white px-2 py-1 focus:outline-none" style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}>
              {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <span style={{ color: BRAND.textMuted }}>
              {filteredItems.length === 0 ? '0 records' : `${pageStart + 1}-${Math.min(pageStart + pageSize, filteredItems.length)} of ${filteredItems.length}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums" style={{ color: BRAND.textSecondary }}>
              Page {activePage} of {totalPages}
            </span>
            <button disabled={activePage === 1} onClick={() => setCurrentPage(activePage - 1)} className="rounded p-1.5 disabled:opacity-35" style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }} aria-label="Previous page">
              <ChevronLeft size={13} />
            </button>
            <button disabled={activePage === totalPages} onClick={() => setCurrentPage(activePage + 1)} className="rounded p-1.5 disabled:opacity-35" style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }} aria-label="Next page">
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {showAdd && selected && (
        <AddItemModal iteration={selected} onClose={() => setShowAdd(false)} onCreated={() => setShowAdd(false)} />
      )}
    </div>
  )
}

// ── Metric card ─────────────────────────────────────────────────────────────

function Metric({
  label,
  value,
  sub,
  valueColor = BRAND.textPrimary,
  bar,
  barColor,
  last,
}: {
  label: string
  value: string
  sub: string
  valueColor?: string
  bar?: number
  barColor?: string
  last?: boolean
}) {
  return (
    <div className="flex flex-[1] flex-col justify-center px-5 gap-1 min-w-0" style={{ borderLeft: last || label === 'Planned Velocity' ? undefined : `1px solid ${BRAND.borderSubtle}` }}>
      <span className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: BRAND.textMuted }}>
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[20px] font-semibold leading-none" style={{ color: valueColor }}>
          {value}
        </span>
        <span className="text-[10px]" style={{ color: BRAND.textSecondary }}>
          {sub}
        </span>
      </div>
      {bar !== undefined && (
        <div className="w-28 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#e4e8ed' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(bar, 100)}%`, backgroundColor: barColor }} />
        </div>
      )}
    </div>
  )
}

// ── Editable row ────────────────────────────────────────────────────────────

function StatusRow({
  item,
  rowNum,
  selected,
  onToggleSelect,
  iterations,
  memberMap,
  selectedIterationId,
  canEdit,
  canMoveUp,
  canMoveDown,
  isMoving,
  onMoveUp,
  onMoveDown,
  onOpen,
}: {
  item: IterationStatusItem
  rowNum: number
  selected: boolean
  onToggleSelect: () => void
  iterations: Iteration[]
  memberMap: Map<string, import('@/features/teams/api').ProjectMember>
  selectedIterationId: string
  canEdit: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  isMoving: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onOpen: () => void
}) {
  const update = useUpdateWorkItem(item.id)
  const member = item.assigneeId ? memberMap.get(item.assigneeId) : undefined
  const ownerName = member?.displayName ?? member?.email ?? null
  const col = Object.fromEntries(ITERATION_COLUMNS.map((column) => [column.key, column.width])) as Record<IterationColumnKey, number>

  return (
    <div className="group flex h-8 items-center gap-2 px-3 text-[11px]" style={{ backgroundColor: selected ? '#f3f6fb' : undefined, borderBottom: `1px solid ${BRAND.borderInner}` }}>
      {/* Selection */}
      <div className="w-5 shrink-0 flex items-center justify-center">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="rounded" style={{ accentColor: BRAND.primary }} aria-label={`Select ${item.itemKey}`} />
      </div>
      <div className="flex w-4 shrink-0 flex-col opacity-0 group-hover:opacity-100">
        <button aria-label="Move item up" onClick={onMoveUp} disabled={!canEdit || !canMoveUp || isMoving} className="h-3 disabled:opacity-30" style={{ color: BRAND.textMuted }} type="button"><ChevronUp size={10} /></button>
        <button aria-label="Move item down" onClick={onMoveDown} disabled={!canEdit || !canMoveDown || isMoving} className="h-3 disabled:opacity-30" style={{ color: BRAND.textMuted }} type="button"><ChevronDown size={10} /></button>
      </div>
      <div className="shrink-0 text-center font-mono text-[10px] tabular-nums" style={{ width: col.rank, color: BRAND.textMuted }}>
        {rowNum}
      </div>
      <button className="shrink-0 cursor-pointer text-left font-mono truncate hover:underline" style={{ width: col.id, color: BRAND.primaryLight }} onClick={onOpen}>
        {item.itemKey}
      </button>
      <button className="flex shrink-0 cursor-pointer items-center gap-1.5 truncate pr-2 text-left hover:underline" style={{ width: col.name, color: BRAND.textPrimary }} onClick={onOpen}>
        <span className="rounded-sm px-1 py-px text-[9px] font-semibold capitalize" style={{ backgroundColor: '#eef3fb', color: BRAND.primary }}>
          {item.type}
        </span>
        <span className="truncate">{item.title}</span>
      </button>
      <div className="shrink-0" style={{ width: col.scheduleState }}>
        {canEdit ? (
          <InlineSelect
            value={item.scheduleState}
            onChange={(e) => update.mutate({ scheduleState: e.target.value as ScheduleState })}
            className="text-[11px] px-1 py-0.5 rounded bg-white focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
          >
            {SCHEDULE_STATE_VALUES.map((s) => (
              <option key={s} value={s}>
                {SCHEDULE_STATE_LABEL[s as ScheduleState] ?? s}
              </option>
            ))}
          </InlineSelect>
        ) : (
          <ScheduleStateBadge state={item.scheduleState} />
        )}
      </div>
      <div className="shrink-0 pr-2" style={{ width: col.iteration }}>
        {canEdit ? (
          <InlineSelect
            value={item.iterationId ?? ''}
            onChange={(e) => update.mutate({ iterationId: e.target.value || null })}
            className="w-full text-[11px] px-1 py-0.5 rounded bg-white focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
          >
            <option value="">Unscheduled</option>
            {iterations.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </InlineSelect>
        ) : (
          <span style={{ color: BRAND.textSecondary }}>
            {iterations.find((i) => i.id === item.iterationId)?.name ?? '—'}
          </span>
        )}
      </div>
      {/* Blocked */}
      <div className="shrink-0 text-center" style={{ width: col.blocked }}>
        {item.isBlocked && (
          <span className="text-[10px] font-semibold px-1 py-px rounded" style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
            B
          </span>
        )}
      </div>
      <div className="shrink-0 text-right font-mono tabular-nums" style={{ width: col.planEstimate, color: BRAND.textSecondary }}>
        {item.planEstimate ?? ''}
      </div>
      <div className="shrink-0 text-right font-mono tabular-nums" style={{ width: col.taskEstimate, color: BRAND.textSecondary }}>
        {item.taskEstimate || ''}
      </div>
      <div className="shrink-0 text-right font-mono tabular-nums" style={{ width: col.toDo, color: BRAND.textSecondary }}>
        {item.toDo || ''}
      </div>
      {/* Owner */}
      <div className="shrink-0 truncate text-[11px]" style={{ width: col.owner, color: BRAND.textSecondary }}>
        {ownerName ?? <span style={{ color: BRAND.textMuted }}>Unassigned</span>}
      </div>
      {/* selectedIterationId kept for future "leaves list on reassign" refetch semantics */}
      <span hidden>{selectedIterationId}</span>
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
      toast.success(`${type === 'defect' ? 'Defect' : 'Story'} "${title.trim()}" added to iteration`)
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
                className="flex-1 py-1.5 text-[11px] font-semibold rounded-sm capitalize transition-colors"
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
