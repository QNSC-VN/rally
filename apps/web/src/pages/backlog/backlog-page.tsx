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
/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { ListPageHeader } from '@/shared/ui/list-page/list-page-header'
import { Button } from '@/shared/ui/button'
import { RowGutter } from '@/shared/ui/row-gutter'
import { InlineSelect } from '@/shared/ui/native-select'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { OwnerSelectCell } from '@/shared/ui/owner-cell'
import { BulkDeleteCopy } from '@/features/work-items/ui/bulk-delete-copy'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import {
  useBacklog,
  useUpdateWorkItem,
  useRankAnyWorkItem,
  useCreateWorkItem,
  type WorkItem,
  type UpdateWorkItemInput,
} from '@/features/work-items/api'
import { useReleases } from '@/features/releases/api'
import { useProjectMembers } from '@/features/teams/api'
import { useIterationOptions, useIterations } from '@/features/iterations/api'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import {
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  PRIORITY_VALUES,
  PRIORITY_LABEL,
  type ScheduleState,
} from '@/entities/work-item/model/types'
import { BRAND } from '@/shared/config/brand'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { CreateWorkItemModal } from '@/features/work-items/ui/create-work-item-modal'
import { type ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { useDataTable, SelectableTable, RankSortHeader } from '@/shared/ui/table'
import { type DataTableHeaderColumn } from '@/shared/ui/table'

// ── Column definitions ─────────────────────────────────────────────────────────

type ColumnKey =
  | 'id'
  | 'name'
  | 'scheduleState'
  | 'flowState'
  | 'priority'
  | 'estimate'
  | 'owner'
  | 'release'
  | 'iteration'

const COLUMN_MINS: Record<ColumnKey, number> = {
  id: 88,
  name: 180,
  scheduleState: 120,
  flowState: 120,
  priority: 80,
  estimate: 44,
  owner: 90,
  release: 100,
  iteration: 100,
}

const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  id: 116,
  name: 260,
  scheduleState: 136,
  flowState: 136,
  priority: 96,
  estimate: 52,
  owner: 120,
  release: 160,
  iteration: 140,
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  id: 'ID',
  name: 'Name',
  scheduleState: 'Schedule State',
  flowState: 'Flow State',
  priority: 'Priority',
  estimate: 'Est.',
  owner: 'Owner',
  release: 'Release',
  iteration: 'Iteration',
}

const COLUMNS: ColumnKey[] = [
  'id',
  'name',
  'scheduleState',
  'flowState',
  'priority',
  'estimate',
  'owner',
  'release',
  'iteration',
]

const BACKLOG_COLUMNS: ColumnDef<ColumnKey>[] = COLUMNS.map((key) => ({
  key,
  label: COLUMN_LABELS[key],
  defaultWidth: DEFAULT_WIDTHS[key],
  minWidth: COLUMN_MINS[key],
}))

/**
 * Server-side sort field per column (backend `WorkItemSortBy`). Columns absent
 * from this map are not sortable (owner/release/iteration would sort by UUID).
 */
const COLUMN_SORT_FIELD: Partial<Record<ColumnKey, string>> = {
  id: 'itemKey',
  name: 'title',
  scheduleState: 'scheduleState',
  priority: 'priority',
  estimate: 'planEstimate',
}

/** Header descriptors for the shared <DataTableHeader>; sortable where mapped. */
const BACKLOG_HEADER_COLUMNS: DataTableHeaderColumn<ColumnKey>[] = COLUMNS.map((key) => ({
  key,
  label: COLUMN_LABELS[key],
  align: key === 'estimate' ? ('center' as const) : undefined,
  sortCol: COLUMN_SORT_FIELD[key],
}))

// ── Resizable column header ────────────────────────────────────────────────────

// ── Owner cell (avatar + name) ─────────────────────────────────────────────────

// ── Main page ─────────────────────────────────────────────────────────────────

const SCHEDULE_STATE_OPTS = [
  { value: '' as const, label: 'All States' },
  ...SCHEDULE_STATE_VALUES.map((v) => ({ value: v, label: SCHEDULE_STATE_LABEL[v] })),
]

export function BacklogPage() {
  const { t } = useTranslation('backlog')
  const navigate = useNavigate()
  const { project, team } = useAppContext()
  const projectId = project?.projectId

  const { can } = useProjectPermissions(projectId)
  const canEdit = can('work_item:edit')

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

  // ── Sort ───────────────────────────────────────────────────────────────────
  // Server-side column sort. `null` = default rank order (drag-and-drop enabled).
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

  // Reference lists for the P2.1 filters, inline selects and id→name lookups.
  const { data: members = [] } = useProjectMembers(projectId)
  const { data: releases = [] } = useReleases(projectId)
  // Assignable choices only (planning/committed) — used to populate the
  // inline-edit <option> list and the filter dropdown.
  const { data: iterationOptions = [] } = useIterationOptions(projectId, team?.teamId)
  // All iterations regardless of state — used to resolve an already-set
  // iterationId to its name. Reusing iterationOptions here silently rendered
  // '—' for any item whose iteration had since become Accepted, even though
  // the relation was genuinely set (see RELATION_DATA_TRACEABILITY.md).
  const { data: allIterations = [] } = useIterations(projectId, team?.teamId)

  // Reset pagination on filter/project change (synchronously, before useBacklog reads cursor)
  const prevTeamRef = useRef(team?.teamId)
  if (prevTeamRef.current !== team?.teamId) {
    prevTeamRef.current = team?.teamId
    setCursor(undefined)
    setCursorHistory([])
  }
  useEffect(() => {
    setCursor(undefined)
    setCursorHistory([])
  }, [
    search,
    filterType,
    filterState,
    filterOwner,
    filterRelease,
    filterIteration,
    pageSize,
    projectId,
    sortCol,
    sortDir,
  ])

  const { data, isLoading, isError, error } = useBacklog(projectId, {
    type: filterType || undefined,
    scheduleState: filterState || undefined,
    assigneeId: filterOwner || undefined,
    releaseId: filterRelease || undefined,
    iterationId: filterIteration || undefined,
    teamId: team?.teamId || undefined,
    q: search || undefined,
    sort: sortCol ? `${sortCol}:${sortDir}` : undefined,
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
    // Rank reorder is only meaningful in the default rank order; a column sort
    // detaches the visual order from rank, so drag is disabled while sorting.
    if (sortCol) return
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
  const selection = useRowSelection(items)
  const createItem = useCreateWorkItem()
  async function copySelected() {
    const src = localItems.find((i) => selection.selectedIds.has(i.id))
    if (!src || !projectId) return
    try {
      await createItem.mutateAsync({
        projectId,
        type: src.type as 'story' | 'defect',
        title: `${src.title} (copy)`,
        priority: (src.priority ?? 'none') as 'none' | 'low' | 'normal' | 'high' | 'urgent',
        ...(src.teamId ? { teamId: src.teamId } : {}),
        ...(src.storyPoints != null ? { storyPoints: Number(src.storyPoints) } : {}),
      })
      selection.clear()
      toast.success('Item copied')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Copy failed')
    }
  }

  // ── Shared table engine (identical to projects/releases): resize + reorder + show/hide ──
  const table = useDataTable<WorkItem, unknown, ColumnKey>(BACKLOG_COLUMNS, {
    storageKey: STORAGE_KEYS.BACKLOG_COLUMN_WIDTHS,
  })
  const { startResize, order, hidden, toggleVisible, reorder, colStyles } = table

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
  const canCreate = can('work_item:create')

  // ── Render ────────────────────────────────────────────────────────────────────
  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-foreground-subtle">{t('selectProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Title → toolbar. Backlog shows NO KPI/metric strip (P2-BL-FR-019 / AC#10). */}
      <ListPageHeader title={t('title')} />
      <BacklogToolbar
        search={search}
        setSearch={setSearch}
        filterType={filterType}
        setFilterType={setFilterType}
        filterState={filterState}
        setFilterState={setFilterState}
        filterOwner={filterOwner}
        setFilterOwner={setFilterOwner}
        filterRelease={filterRelease}
        setFilterRelease={setFilterRelease}
        filterIteration={filterIteration}
        setFilterIteration={setFilterIteration}
        members={members}
        releases={releases}
        iterations={iterationOptions}
        canCreate={canCreate}
        onCreate={() => setShowCreate(true)}
        columns={BACKLOG_COLUMNS}
        order={order}
        hidden={hidden}
        toggleVisible={toggleVisible}
        reorder={reorder}
      />

      {/* Table — shared SelectableTable shell (selection gutter + BulkActionBar
          with Assign Release/Iteration + DnD wrap), consistent with Quality /
          Iteration Status / Tasks. */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <SelectableTable
          rows={localItems}
          selection={selection}
          headerProps={{
            columns: BACKLOG_HEADER_COLUMNS,
            colStyles,
            onResize: startResize,
            sort: { col: sortCol, dir: sortDir, onSort: toggleSort },
            columnDrag: table.columnDrag,
          }}
          padClassName="gap-2 px-3"
          leadingExtra={
            <RankSortHeader
              active={sortCol === 'rank'}
              dir={sortDir}
              onSort={() => toggleSort('rank')}
            />
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
          bulkActions={(sel) =>
            canEdit ? (
              <BulkDeleteCopy
                selection={sel}
                projectId={projectId!}
                onCopy={copySelected}
                copyPending={createItem.isPending}
              />
            ) : null
          }
          loading={isLoading}
          skeleton={{ rows: 10, cols: 7 }}
          error={
            isError ? (
              <div className="flex h-32 items-center justify-center">
                <p className="text-sm text-destructive">
                  {error instanceof Error ? error.message : t('loadError')}
                </p>
              </div>
            ) : undefined
          }
          empty={
            items.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2">
                <p className="text-sm text-foreground-subtle">{t('empty')}</p>
                <button
                  onClick={() => setShowCreate(true)}
                  disabled={!canCreate}
                  className="text-xs font-medium text-primary-light disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('createFirst')}
                </button>
              </div>
            ) : undefined
          }
          footer={
            <PaginationFooter
              pageSize={pageSize}
              setPageSize={setPageSize}
              currentPage={currentPage}
              rangeStart={(currentPage - 1) * pageSize + 1}
              rangeEnd={(currentPage - 1) * pageSize + items.length}
              total={pageInfo?.total}
              hasPrevPage={currentPage > 1}
              hasNextPage={!!pageInfo?.hasNextPage}
              onPrevPage={goPrevPage}
              onNextPage={goNextPage}
            />
          }
          renderRow={(item, { selected, onToggleSelect }) => (
            <BacklogRow
              key={item.id}
              item={item}
              rowNum={(currentPage - 1) * pageSize + localItems.indexOf(item) + 1}
              selected={selected}
              onToggleSelect={onToggleSelect}
              onOpen={() => openItem(item)}
              colStyles={colStyles}
              canEdit={canEdit}
              members={members}
              releases={releases}
              iterations={iterationOptions}
              allIterations={allIterations}
            />
          )}
        />
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateWorkItemModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={(item) => {
            setShowCreate(false)
            toast.success(
              t('created', {
                type: item.type === 'defect' ? t('typeDefect') : t('typeStory'),
                title: item.title,
              }),
            )
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

// ── Toolbar (title, search, filters, create button) ─────────────────────────

interface BacklogToolbarProps {
  search: string
  setSearch: (v: string) => void
  filterType: '' | 'story' | 'defect'
  setFilterType: (v: '' | 'story' | 'defect') => void
  filterState: string
  setFilterState: (v: string) => void
  filterOwner: string
  setFilterOwner: (v: string) => void
  filterRelease: string
  setFilterRelease: (v: string) => void
  filterIteration: string
  setFilterIteration: (v: string) => void
  members: Array<{ userId: string; displayName?: string; email?: string }>
  releases: Array<{ id: string; name: string }>
  iterations: Array<{ id: string; name: string }>
  canCreate: boolean
  onCreate: () => void
  columns: ColumnDef<ColumnKey>[]
  order: ColumnKey[]
  hidden: Set<ColumnKey>
  toggleVisible: (key: ColumnKey) => void
  reorder: (dragKey: ColumnKey, overKey: ColumnKey) => void
}

function BacklogToolbar({
  search,
  setSearch,
  filterType,
  setFilterType,
  filterState,
  setFilterState,
  filterOwner,
  setFilterOwner,
  filterRelease,
  setFilterRelease,
  filterIteration,
  setFilterIteration,
  members,
  releases,
  iterations,
  canCreate,
  onCreate,
  columns,
  order,
  hidden,
  toggleVisible,
  reorder,
}: BacklogToolbarProps) {
  const { t } = useTranslation('backlog')
  const activeFilterCount =
    (filterType ? 1 : 0) +
    (filterState ? 1 : 0) +
    (filterOwner ? 1 : 0) +
    (filterRelease ? 1 : 0) +
    (filterIteration ? 1 : 0)

  return (
    <PageToolbar
      search={{
        value: search,
        onChange: setSearch,
        placeholder: 'Search…',
        ariaLabel: 'Search backlog',
        width: 160,
      }}
      actions={
        <Button
          size="sm"
          onClick={onCreate}
          disabled={!canCreate}
          title={!canCreate ? 'You do not have permission to create work items' : undefined}
        >
          <Plus size={12} />
          {t('common:addNew')}
        </Button>
      }
      activeFilterCount={activeFilterCount}
      defaultFiltersOpen={activeFilterCount > 0}
      filters={
        <>
          {/* Type filter */}
          <InlineSelect
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as '' | 'story' | 'defect')}
            aria-label="Filter by type"
            className="w-auto"
          >
            <option value="">{t('filters.allTypes')}</option>
            <option value="story">{t('typeStory')}</option>
            <option value="defect">{t('typeDefect')}</option>
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
            <option value="">{t('filters.allOwners')}</option>
            <option value="unassigned">{t('filters.unassigned')}</option>
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
            <option value="">{t('filters.allReleases')}</option>
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
            <option value="">{t('filters.allIterations')}</option>
            {iterations.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </InlineSelect>
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

// ── Backlog row with inline editing (P2-BL-07) ──────────────────────────────────

interface BacklogRowProps {
  item: WorkItem
  rowNum: number
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  colStyles: Record<ColumnKey, React.CSSProperties>
  canEdit: boolean
  members: Array<{ userId: string; displayName?: string; email?: string }>
  releases: Array<{ id: string; name: string; releaseKey?: string | null }>
  iterations: Array<{ id: string; name: string; iterationKey?: string | null }>
  allIterations: Array<{ id: string; name: string; iterationKey?: string | null }>
}

// inline table selects use <InlineSelect> component directly

function BacklogRow({
  item,
  rowNum,
  selected,
  onToggleSelect,
  onOpen,
  colStyles,
  canEdit,
  members,
  releases,
  iterations,
  allIterations,
}: BacklogRowProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })
  const update = useUpdateWorkItem(item.id)

  // Fire a PATCH only when the value actually changed; errors surface via the
  // mutation cache (the list re-reads the source of truth on invalidate).
  function patch(body: Parameters<typeof update.mutate>[0]) {
    update.mutate(body)
  }

  function commitTitle(next: string) {
    const trimmed = next.trim()
    if (trimmed && trimmed !== item.title) patch({ title: trimmed })
  }

  const ownerName = (() => {
    const m = members.find((m) => m.userId === item.assigneeId)
    return m?.displayName ?? m?.email
  })()

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      ref={setNodeRef}
      className="group flex min-h-[34px] items-center gap-2 border-b border-border-inner px-3 transition-colors duration-100 hover:bg-primary-lighter"
      style={{
        minWidth: 'max-content',
        backgroundColor: isDragging
          ? BRAND.primaryLighter
          : selected
            ? BRAND.surfaceSubtle
            : undefined,
        opacity: isDragging ? 0.6 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
        position: isDragging ? 'relative' : undefined,
      }}
      {...attributes}
    >
      {/* Leading gutter (rank grip + selection checkbox) — shared component so
          the header, rows and any nested rows stay column-aligned. */}
      <RowGutter
        ref={setActivatorNodeRef}
        dragListeners={listeners}
        stopPropagation
        checkbox={{
          checked: selected,
          onChange: onToggleSelect,
          ariaLabel: `Select ${item.itemKey}`,
        }}
      />

      {/* Row number */}
      <div className="w-12 shrink-0 px-2 text-right font-mono text-ui-xs text-foreground-subtle tabular-nums">
        {rowNum}
      </div>

      {/* ID — type glyph + key link (shared cell; the only nav affordance) */}
      <div className="shrink-0 overflow-hidden px-2" style={colStyles.id} onClick={stop}>
        <IdCell type={item.type} itemKey={item.itemKey} onOpen={onOpen} />
      </div>

      {/* Title — inline edit */}
      <div className="min-w-0 shrink-0 px-2" style={colStyles.name} onClick={stop}>
        {canEdit ? (
          <InlineEditableCell
            value={item.title}
            canEdit
            onCommit={commitTitle}
            className="block w-full break-words whitespace-normal text-foreground"
            style={{ cursor: 'text', fontSize: 12 }}
            inputClassName="w-full rounded border border-accent-border-strong px-1 py-0.5 text-ui-sm text-foreground focus:outline-none"
            ariaLabel="Title"
            title={item.title}
          />
        ) : (
          <span
            className="block break-words whitespace-normal text-foreground"
            style={{ cursor: 'pointer', fontSize: 12 }}
            onClick={onOpen}
            title={item.title}
          >
            {item.title}
          </span>
        )}
      </div>

      {/* Schedule State — Rally-style segmented stepper (shared control) */}
      <div className="shrink-0 overflow-hidden px-2" style={colStyles.scheduleState} onClick={stop}>
        <StateStepper
          steps={SCHEDULE_STATE_STEPS}
          value={item.scheduleState as ScheduleState}
          canEdit={canEdit}
          onChange={(next) => patch({ scheduleState: next as UpdateWorkItemInput['scheduleState'] })}
          ariaLabel="Schedule state"
        />
      </div>

      {/* Flow State — shared SearchableSelect (enum dropdown) */}
      <div className="shrink-0 overflow-hidden px-2" style={colStyles.flowState} onClick={stop}>
        <SearchableSelect
          value={item.flowState ?? item.scheduleState ?? ''}
          readOnly={!canEdit}
          ariaLabel="Flow state"
          options={SCHEDULE_STATE_VALUES.map((s) => ({ value: s, label: SCHEDULE_STATE_LABEL[s] }))}
          onChange={(v) => patch({ flowState: v as UpdateWorkItemInput['flowState'] })}
        />
      </div>

      {/* Priority — defects only */}
      <div className="shrink-0 overflow-hidden px-2" style={colStyles.priority} onClick={stop}>
        {item.type === 'defect' ? (
          <SearchableSelect
            value={item.priority ?? ''}
            readOnly={!canEdit}
            ariaLabel="Priority"
            options={PRIORITY_VALUES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            onChange={(v) => patch({ priority: v as UpdateWorkItemInput['priority'] })}
          />
        ) : (
          <span className="font-mono text-ui-xs text-foreground-disabled">—</span>
        )}
      </div>

      {/* Plan Estimate — shared InlineEditableCell */}
      <div className="shrink-0 px-2 text-center" style={colStyles.estimate} onClick={stop}>
        <InlineEditableCell
          value={item.storyPoints != null ? String(item.storyPoints) : ''}
          canEdit={canEdit}
          ariaLabel="Plan estimate"
          onCommit={(raw) => {
            const next = raw === '' ? null : Number(raw)
            // Plan Estimate = story points only. (Previously also wrote todoHours,
            // conflating story points with task To-Do hours — no SRS FR calls for
            // that, and it corrupted task-hour roll-ups.)
            if (next !== (item.storyPoints ?? null)) patch({ storyPoints: next })
          }}
          displayValue={item.storyPoints ?? '—'}
          className="block text-center font-mono text-muted-foreground"
          style={{ fontSize: 12 }}
          inputClassName="w-full rounded border border-primary bg-transparent px-0.5 text-center font-mono text-ui-xs text-foreground focus:outline-none"
        />
      </div>

      {/* Owner — inline select */}
      <div className="shrink-0 overflow-hidden px-2" style={colStyles.owner} onClick={stop}>
        <OwnerSelectCell
          ownerName={ownerName}
          assigneeId={item.assigneeId}
          members={members}
          canEdit={canEdit}
          onChange={(id) => patch({ assigneeId: id })}
        />
      </div>

      {/* Release — shared SearchableSelect */}
      <div className="shrink-0 overflow-hidden px-2" style={colStyles.release} onClick={stop}>
        <SearchableSelect
          value={item.releaseId ?? ''}
          readOnly={!canEdit}
          ariaLabel="Release"
          placeholder="—"
          options={[
            { value: '', label: '—' },
            ...releases.map((r) => ({
              value: r.id,
              label: r.releaseKey ? `${r.releaseKey}: ${r.name}` : r.name,
              searchText: `${r.releaseKey ?? ''} ${r.name}`,
              icon: <TypeBadge type="release" size={16} />,
            })),
          ]}
          onChange={(v) => patch({ releaseId: v || null })}
        />
      </div>

      {/* Iteration — shared SearchableSelect */}
      <div className="shrink-0 overflow-hidden px-2" style={colStyles.iteration} onClick={stop}>
        <SearchableSelect
          value={item.iterationId ?? ''}
          readOnly={!canEdit}
          ariaLabel="Iteration"
          placeholder="—"
          options={[
            { value: '', label: '—' },
            // Keep the current (possibly Accepted) iteration selectable even when
            // it's absent from the assignable `iterations` list.
            ...(item.iterationId && !iterations.some((it) => it.id === item.iterationId)
              ? [
                  (() => {
                    const cur = allIterations.find((it) => it.id === item.iterationId)
                    return {
                      value: item.iterationId,
                      label: cur?.iterationKey ? `${cur.iterationKey}: ${cur.name}` : (cur?.name ?? '—'),
                      icon: <TypeBadge type="iteration" size={16} />,
                    }
                  })(),
                ]
              : []),
            ...iterations.map((it) => ({
              value: it.id,
              label: it.iterationKey ? `${it.iterationKey}: ${it.name}` : it.name,
              searchText: `${it.iterationKey ?? ''} ${it.name}`,
              icon: <TypeBadge type="iteration" size={16} />,
            })),
          ]}
          onChange={(v) => patch({ iterationId: v || null })}
        />
      </div>
    </div>
  )
}
