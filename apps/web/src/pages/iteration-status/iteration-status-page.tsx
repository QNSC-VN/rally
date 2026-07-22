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
import { useTranslation } from 'react-i18next'
import { SelectableTable, useDataTable } from '@/shared/ui/table'
import { IterationBoard } from '@/widgets/iteration-board/iteration-board'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import {
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { SkeletonList } from '@/shared/ui/skeleton'
import { BRAND } from '@/shared/config/brand'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { BulkDeleteCopy } from '@/features/work-items/ui/bulk-delete-copy'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import {
  useIterations,
  useIterationStatus,
  useIterationOptions,
  useCreateIterationItem,
  type IterationStatusItem,
} from '@/features/iterations/api'
import {
  useUpdateAnyWorkItem,
  useRankAnyWorkItem,
} from '@/features/work-items/api'
import { useProjectMembers } from '@/features/teams/api'
import { useMilestones } from '@/features/milestones/api'
import { ScheduleState } from '@/entities/work-item/model/types'
import { StatusRow } from './ui/status-row'
import { AddItemModal } from './ui/add-item-modal'
import { IterationHeader, MetricsStrip, Toolbar, TableFooterTotals } from './ui/iteration-chrome'
import { computeTotalDays } from './model/iteration-helpers'
import {
  type ColKey,
  ITERATION_STATUS_COLUMNS,
  OWNER_UNASSIGNED,
  HEADER_META,
} from './model/columns'

// Stable empty-array reference — `status?.items ?? []` would otherwise mint a
// new array every render while status is loading, which defeats the
// `syncedItems !== sortedItems` reference-equality check below and causes an
// infinite render loop ("Too many re-renders").
const EMPTY_ITEMS: IterationStatusItem[] = []

// ── Main page ──────────────────────────────────────────────────────────────

export function IterationStatusPage() {
  const { t } = useTranslation('iteration-status')
  const navigate = useNavigate()
  const { project } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canEdit = can('work_item:edit')
  const canCreate = can('work_item:create')

  const { data: iterations = [] } = useIterations(projectId)
  const { data: members = [] } = useProjectMembers(projectId)
  const { data: milestoneOptions = [] } = useMilestones(projectId)

  const memberMap = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])

  const [chosenId, setChosenId] = useState<string | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [stateFilter, setStateFilter] = useState<ScheduleState | 'all'>('all')
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState<number>(1)

  // List (grid) vs Board (Kanban) view — the BA-spec toggle for Iteration
  // Status. Persisted so the choice survives navigation/reload. The Board view
  // reuses the shared IterationBoard widget over the SAME read-model.
  const [viewMode, setViewMode] = useState<'list' | 'board'>(() =>
    localStorage.getItem(STORAGE_KEYS.ITERATION_STATUS_VIEW_MODE) === 'board' ? 'board' : 'list',
  )
  const setViewModePersisted = useCallback((mode: 'list' | 'board') => {
    setViewMode(mode)
    localStorage.setItem(STORAGE_KEYS.ITERATION_STATUS_VIEW_MODE, mode)
  }, [])

  // Shared table engine (identical to projects/releases): resize + reorder + show/hide.
  const table = useDataTable<unknown, unknown, ColKey>(ITERATION_STATUS_COLUMNS, {
    storageKey: STORAGE_KEYS.ITERATION_STATUS_COLUMNS,
  })
  const { startResize, order, hidden, toggleVisible, reorder, styleFor } = table

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

  // Iteration picker feed for inline reassignment — scoped to the current
  // iteration's team so every option is assignable (backend enforces the same
  // team-scope rule via assertIterationAssignable).
  const { data: iterationOptions = [] } = useIterationOptions(projectId, selected?.teamId)

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
  const bulkUpdate = useUpdateAnyWorkItem()
  const copyItem = useCreateIterationItem(selectedId ?? '')

  // Copy = duplicate the single selected Story/Defect into the current iteration
  // (Rally "Copy"; disabled when more than one row is selected). Delete is
  // handled by the shared BulkDeleteCopy in the bulk bar.
  async function copySelected() {
    if (!selectedId || selection.count !== 1) return
    const src = items.find((i) => selection.selectedIds.has(i.id))
    if (!src || (src.type !== 'story' && src.type !== 'defect')) return
    try {
      await copyItem.mutateAsync({
        type: src.type,
        title: `${src.title} (copy)`,
        ...(src.planEstimate != null ? { planEstimate: src.planEstimate } : {}),
      })
      selection.clear()
      toast.success('Item copied')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Copy failed')
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
    ? { value: 'Done', label: 'Completed', color: BRAND.success }
    : metrics?.daysLeft == null
      ? { value: '—', label: 'no end date', color: BRAND.warning }
      : metrics.daysLeft < 0
        ? {
            value: String(Math.abs(metrics.daysLeft)),
            label: metrics.daysLeft === -1 ? 'day overdue' : 'days overdue',
            color: BRAND.danger,
          }
        : { value: String(metrics.daysLeft), label: `of ${tDays} days left`, color: BRAND.warning }

  const colStyles = useMemo(
    () => ({
      rank: styleFor('rank', { flexShrink: 0 }),
      id: styleFor('id', { flexShrink: 0 }),
      name: styleFor('name', { flex: 1, minWidth: 150 }),
      feature: styleFor('feature', { flexShrink: 0 }),
      iteration: styleFor('iteration', { flexShrink: 0 }),
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
        className="flex flex-1 items-center justify-center text-foreground-subtle"
        style={{ fontSize: 13 }}
      >
        {t('selectProject')}
      </div>
    )
  }

  if (!iterations.length) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 text-foreground-subtle"
        style={{ fontSize: 13 }}
      >
        <span>{t('noIterations')}</span>
        <button
          onClick={() => navigate({ to: '/timeboxes' })}
          className="text-primary"
          style={{
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
          {t('goToTimeboxes')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden bg-card text-foreground"
      style={{ fontSize: 12 }}
    >
      {/* ── Single page header: title + iteration picker ────────────────── */}
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
        setViewMode={setViewModePersisted}
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

      {/* ── 6. Table (List view) or Board view ───────────────────────────── */}
      {/* Bulk bar (Delete + Copy) is rendered by SelectableTable in List view. */}
      {viewMode === 'board' ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {isLoading ? (
            <SkeletonList rows={6} cols={6} />
          ) : isError ? (
            <div className="flex h-full items-center justify-center text-ui-lg text-destructive">
              {t('boardLoadError')}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex h-full items-center justify-center text-ui-lg text-foreground-subtle">
              {t('emptyItems')}
            </div>
          ) : (
            <IterationBoard
              items={filteredItems}
              memberMap={memberMap}
              canEdit={canEdit}
              onOpen={(itemKey) => navigate({ to: '/item/$itemKey', params: { itemKey } })}
              onMove={(id, target) =>
                bulkUpdate
                  .mutateAsync({ id, input: { scheduleState: target } })
                  .then(() => undefined)
              }
            />
          )}
        </div>
      ) : (
        <SelectableTable
          rows={localItems}
          selection={selection}
          headerProps={{
            columns: HEADER_META,
            colStyles,
            onResize: startResize,
            sort: { col: sortCol, dir: sortDir, onSort: toggleSort },
            columnDrag: table.columnDrag,
          }}
          padClassName="pr-3 pl-1"
          bodyBackground={BRAND.surface}
          bulkActions={
            canEdit
              ? (sel) => (
                  <BulkDeleteCopy
                    selection={sel}
                    projectId={projectId ?? ''}
                    onCopy={copySelected}
                    copyPending={copyItem.isPending}
                  />
                )
              : undefined
          }
          dnd={{
            dndContextProps: {
              sensors: dndSensors,
              collisionDetection: closestCenter,
              onDragEnd: handleDragEnd,
            },
            sortableContextProps: {
              items: localItems.map((it) => it.id),
              strategy: verticalListSortingStrategy,
            },
          }}
          totals={
            !isLoading && !isError && items.length > 0 ? (
              <TableFooterTotals colStyles={colStyles} totals={totals} />
            ) : undefined
          }
          loading={isLoading}
          skeleton={{ rows: 10, cols: 12 }}
          error={
            isError ? (
              <div
                className="flex items-center justify-center text-destructive"
                style={{ height: 160, fontSize: 12 }}
              >
                {t('loadError')}
              </div>
            ) : undefined
          }
          empty={
            items.length === 0 ? (
              <div
                className="flex items-center justify-center text-foreground-subtle"
                style={{ height: 160, fontSize: 12 }}
              >
                {t('emptyItems')}
              </div>
            ) : undefined
          }
          footer={
            !isLoading && !isError && sortedItems.length > 0 ? (
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
            ) : undefined
          }
          renderRow={(item, { selected, onToggleSelect }) => (
            <StatusRow
              key={item.id}
              item={item}
              rank={(currentPage - 1) * pageSize + localItems.indexOf(item) + 1}
              memberMap={memberMap}
              milestoneOptions={milestoneOptions}
              iterationOptions={iterationOptions}
              selectedIterationId={selectedId!}
              canEdit={canEdit}
              colStyles={colStyles}
              dragEnabled={!sortCol}
              selected={selected}
              onToggleSelect={onToggleSelect}
              onOpen={() =>
                navigate({
                  to: '/item/$itemKey',
                  params: { itemKey: item.itemKey },
                })
              }
            />
          )}
        />
      )}

      {/* ── Add Item modal ───────────────────────────────────────────────── */}
      {showAdd && selected && (
        <AddItemModal
          iteration={selected}
          projectId={projectId}
          onClose={() => setShowAdd(false)}
          onCreated={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
