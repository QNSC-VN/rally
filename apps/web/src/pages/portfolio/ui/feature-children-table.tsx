import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { toast } from 'sonner'

import { useDataTable, useRowRerank, useDragRowStyle, SelectableTable } from '@/shared/ui/table'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { InlineSelect } from '@/shared/ui/native-select'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { RowGutter } from '@/shared/ui/row-gutter'
import { RowExpandToggle } from '@/shared/ui/row-expand-toggle'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { OwnerSelectCell } from '@/shared/ui/owner-cell'
import { NESTED_ROW_INDENT } from '@/shared/config/layout'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { NUMERIC_CELL_CLASS } from '@/shared/lib/utils'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS, SIMPLIFIED_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import {
  PRIORITY_LABEL,
  PRIORITY_VALUES,
  SCHEDULE_STATE_LABEL,
  SIMPLIFIED_STATE_TO_SCHEDULE_STATE,
  ScheduleState,
  getSimplifiedState,
} from '@/entities/work-item/model/types'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useTableSort, type SortDir } from '@/shared/lib/hooks/use-table-sort'
import { useReleases, type Release } from '@/features/releases/api'
import { useProjectMembers, type ProjectMember } from '@/features/teams/api'
import {
  useRankAnyWorkItem,
  useTasks,
  useUpdateWorkItem,
  type UpdateWorkItemInput,
  type WorkItem,
} from '@/features/work-items/api'
import type { PortfolioChild } from '@/features/portfolio/api'
import { PORTFOLIO_CHILD_COLUMNS, type ChildColKey } from '../model/children-columns'

/** Which field each sortable column compares on. */
type ChildSortField =
  | 'itemKey'
  | 'title'
  | 'priority'
  | 'estimate'
  | 'owner'
  | 'scheduleState'
  | 'iteration'
  | 'release'

const text = (value: string | null): string => value ?? ''

/**
 * The Stories and Defects linked to a Feature — the BA's Children tab.
 *
 * This was a flat run of `<div>`s carrying ID, name and schedule state, against a spec asking for a
 * "full Backlog-style table". So it is the shared grid: `useDataTable` for resizable, reorderable
 * columns, `SelectableTable` for the shell every complex grid uses — the select-all gutter, the bulk
 * bar and the scroll body — and `useTableSort` for the same click-to-sort semantics. None of that
 * is reimplemented here; the point of the BA calling it "Backlog-style" is that it IS the same
 * table.
 *
 * DRAG-TO-RANK through `PATCH /v1/work-items/{id}/rank`, the work item's own rank endpoint — not
 * the portfolio one, which ranks Features among Features. An earlier revision left drag out on the
 * reasoning that a Story's rank "lives on the Backlog"; that was wrong twice over. The children
 * query already orders by `workItems.rank`, so the rows arrive in rank order, and `useRankAnyWorkItem`
 * writes exactly that column. The list was orderable all along and simply had no grip.
 *
 * `rank` had to be added to the child response for it: the repository already selected it for its
 * own ORDER BY and then dropped it in the row mapping, so the client received an ordered list it
 * had no way to reorder.
 *
 * Search is client-side over the loaded rows: the children of one Feature are a bounded set (the
 * endpoint returns them for that Feature alone), so there is no page to re-fetch and a server round
 * trip per keystroke would be slower and no more correct.
 *
 * INLINE EDIT and EXPAND-TO-TASKS are §5.2, FR-011 and FR-012 — specified, and until now unbuilt.
 * The tab's earlier comment argued editing away as "a second editing surface for the same fields",
 * but the SRS asks for it by name and the wire was already built to serve it: `PortfolioChildSchema`
 * returns `projectId` / `releaseId` / `assigneeId` beside the display names, with the comment "IDs
 * alongside the names, so the disclosed child rows can edit in place". The scenario covering both
 * (P5-PI-013) was never run, so this was missing rather than deliberately dropped.
 *
 * Every editable cell is the SAME primitive the Backlog uses for that field — `InlineEditableCell`
 * for Name and Est, `SearchableSelect` for Priority and Release, `OwnerSelectCell`, `StateStepper` —
 * so the two surfaces cannot disagree about how a field is edited. Iteration stays read-only text,
 * which §5.2 calls a deliberate scope trim.
 *
 * The toolbar is the shared `PageToolbar` — search, `Add New`, Filters and Show Fields — laid out
 * as Iteration Status lays it out, minus the KPI strip, which this tab has no metrics for. `Add
 * New` opens the Backlog creation flow (§5.2) and links the new item to this Feature.
 *
 * NO totals row: Iteration Status foots nothing, and the one number this used to sum — Plan
 * Estimate — is a roll-up the Feature's own Details tab already reports through its progress bars.
 *
 * The pagination footer is the one remaining §5.2 item. It is a server decision, since these rows
 * arrive whole from one endpoint.
 */
export function FeatureChildrenTable({
  children,
  projectId,
  canEdit = false,
  isLoading = false,
  onAddItem,
}: {
  children: PortfolioChild[]
  /** The Feature's project — scopes the Release and Owner option lists. */
  projectId: string | undefined
  /** `portfolio:edit`. FR-011 gates inline editing on it. */
  canEdit?: boolean
  isLoading?: boolean
  /** §5.2's `Add Item` — opens the Backlog creation flow. Absent = the button is not rendered. */
  onAddItem?: () => void
}) {
  // Two namespaces: the tab's own copy, and `work-items` for the priority labels — those already
  // exist there and a portfolio-local copy would be a second vocabulary for one enum.
  const { t } = useTranslation(['portfolio', 'work-items'])
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  // Filters live in the toolbar's collapsible panel, as they do on Iteration Status. Type is the
  // useful one here: a Feature's children are Stories AND Defects, and the Type column is gone.
  const [typeFilter, setTypeFilter] = useState<'all' | 'story' | 'defect'>('all')
  const [stateFilter, setStateFilter] = useState<string>('all')
  const { sortField, sortDir, toggle } = useTableSort<ChildSortField>()

  const table = useDataTable<PortfolioChild, unknown, ChildColKey>(PORTFOLIO_CHILD_COLUMNS, {
    storageKey: 'rally-portfolio-children-columns',
    // The select gutter is 48px and precedes every column; without it the computed table width is
    // short by exactly that and the horizontal scroll region ends early.
    leadingWidth: 48,
    sort: {
      col: sortField ?? '',
      dir: sortDir ?? 'asc',
      onSort: (c) => toggle(c as ChildSortField),
    },
  })

  // Column sizing comes straight from the shared engine — see `useDataTable().colStyles`. This
  // page used to rebuild the map with a `{ flex: 1, minWidth }` base that `styleFor` discarded.
  const colStyles = table.colStyles

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = children.filter(
      (child) =>
        (needle === '' ||
          child.itemKey.toLowerCase().includes(needle) ||
          child.title.toLowerCase().includes(needle)) &&
        (typeFilter === 'all' || child.type === typeFilter) &&
        (stateFilter === 'all' || child.scheduleState === stateFilter),
    )
    return sortChildren(rows, sortField, sortDir)
  }, [children, search, typeFilter, stateFilter, sortField, sortDir])

  const selection = useRowSelection(visible)

  // Option lists for the editable cells, scoped to the Feature's own project — the same two
  // queries the Backlog row uses, so the choices offered here are the choices offered there.
  const { data: releases = [] } = useReleases(projectId)
  const { data: members = [] } = useProjectMembers(projectId)

  /**
   * Drag-to-rank over the WORK ITEM's rank, through the endpoint the Backlog uses.
   *
   * Disabled while a column sort or a filter is active: in either case the visible order is not
   * rank, so the neighbours a drop computes would not be the neighbours the server has. Also
   * disabled without `portfolio:edit`, matching the inline edits beside it.
   */
  const rank = useRankAnyWorkItem()
  const listIsRankOrdered = sortField === null && typeFilter === 'all' && stateFilter === 'all'
  const dragDisabled = !canEdit || !listIsRankOrdered
  const rerank = useRowRerank({
    items: visible,
    disabled: dragDisabled,
    onReorder: ({ id, beforeId, afterId }) =>
      rank.mutate(
        {
          id,
          projectId: projectId ?? '',
          beforeId: beforeId ?? undefined,
          afterId: afterId ?? undefined,
        },
        { onError: (err) => toast.error(err.message) },
      ),
  })

  // FR-012: which rows have their Tasks disclosed. A Set rather than a per-row flag so collapsing
  // one row cannot disturb another, and so the state survives a re-sort.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const toggleExpanded = (id: string) =>
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const activeFilterCount = (typeFilter !== 'all' ? 1 : 0) + (stateFilter !== 'all' ? 1 : 0)

  // The states this Feature's children are actually in, so the filter never offers a value that
  // would empty the list. Derived from the unfiltered set, or selecting one would shrink its own
  // option list to a single entry.
  const childStates = useMemo(
    () => [...new Set(children.map((c) => c.scheduleState))].sort(),
    [children],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The same chrome Iteration Status puts above its grid: search, Add New, Filters and Show
          Fields in one shared `PageToolbar`. This tab had a bare `SearchInput` and no way to reach
          the other three, so the two surfaces looked unrelated above the table as well as in it. */}
      <PageToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('detail.children.search'),
          ariaLabel: t('detail.children.search'),
          width: 220,
        }}
        actions={
          canEdit && onAddItem ? (
            <Button size="sm" onClick={onAddItem}>
              <Plus size={14} /> {t('detail.children.addItem')}
            </Button>
          ) : undefined
        }
        activeFilterCount={activeFilterCount}
        defaultFiltersOpen={activeFilterCount > 0}
        filters={
          <>
            <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
              {t('detail.children.filterType')}
              <InlineSelect
                value={typeFilter}
                aria-label={t('detail.children.filterType')}
                onChange={(e) => setTypeFilter(e.target.value as 'all' | 'story' | 'defect')}
                className="w-auto"
              >
                <option value="all">{t('detail.children.allTypes')}</option>
                <option value="story">
                  {t('work-items:type.story', { defaultValue: 'Story' })}
                </option>
                <option value="defect">
                  {t('work-items:type.defect', { defaultValue: 'Defect' })}
                </option>
              </InlineSelect>
            </label>
            <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
              {t('detail.children.filterState')}
              <InlineSelect
                value={stateFilter}
                aria-label={t('detail.children.filterState')}
                onChange={(e) => setStateFilter(e.target.value)}
                className="w-auto"
              >
                <option value="all">{t('detail.children.allStates')}</option>
                {childStates.map((s) => (
                  <option key={s} value={s}>
                    {SCHEDULE_STATE_LABEL[s as ScheduleState] ?? s}
                  </option>
                ))}
              </InlineSelect>
            </label>
          </>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      <SelectableTable
        className="rounded border border-border-strong"
        rows={rerank.items}
        selection={selection}
        selectAllAriaLabel={t('detail.children.selectAll')}
        headerProps={{ ...table.headerProps, colStyles }}
        sort={{
          col: sortField ?? '',
          dir: sortDir ?? 'asc',
          onSort: (c) => toggle(c as ChildSortField),
        }}
        dnd={{
          dndContextProps: rerank.dndContextProps,
          sortableContextProps: rerank.sortableContextProps,
        }}
        loading={isLoading}
        skeleton={{ rows: 4, cols: PORTFOLIO_CHILD_COLUMNS.length }}
        // No totals row. Iteration Status — the grid this tab is modelled on — has none, and the
        // one number it footed (summed Plan Estimate) is a roll-up the Feature's own Details tab
        // already reports through its progress bars and Accepted-Children meter.
        empty={
          visible.length === 0 ? (
            <EmptyState
              title={
                children.length === 0 ? t('detail.children.empty') : t('detail.children.noMatches')
              }
            />
          ) : undefined
        }
        renderRow={(child, { selected, onToggleSelect }) => (
          <ChildRow
            key={child.id}
            child={child}
            colStyles={colStyles}
            canEdit={canEdit}
            dragDisabled={dragDisabled}
            selected={selected}
            onToggleSelect={onToggleSelect}
            selectLabel={t('detail.children.selectChild', { key: child.itemKey })}
            expanded={expandedIds.has(child.id)}
            onToggleExpand={() => toggleExpanded(child.id)}
            expandLabel={t('detail.children.expandTasks', { key: child.itemKey })}
            releases={releases}
            members={members}
            onOpen={() =>
              void navigate({ to: '/item/$itemKey', params: { itemKey: child.itemKey } })
            }
            onOpenTask={(itemKey) => void navigate({ to: '/item/$itemKey', params: { itemKey } })}
          />
        )}
      />
    </div>
  )
}

/**
 * One linked Story/Defect, editable in place (FR-011) and expandable to its Tasks (FR-012).
 *
 * Each control is the primitive the Backlog uses for that same field, so a reader who learns to
 * edit an estimate on one screen already knows how to do it on the other. Every cell stops click
 * propagation: the row itself opens the full Work Item Detail (§5.2), and an edit must not
 * navigate away mid-keystroke.
 */
function ChildRow({
  child,
  colStyles,
  canEdit,
  dragDisabled,
  selected,
  onToggleSelect,
  selectLabel,
  expanded,
  onToggleExpand,
  expandLabel,
  releases,
  members,
  onOpen,
  onOpenTask,
}: {
  child: PortfolioChild
  colStyles: Record<ChildColKey, CSSProperties>
  canEdit: boolean
  dragDisabled: boolean
  selected: boolean
  onToggleSelect: () => void
  selectLabel: string
  expanded: boolean
  onToggleExpand: () => void
  expandLabel: string
  // The real query types, not structural stand-ins: `OwnerSelectCell` takes `ProjectMember[]`, and
  // a hand-written `{ userId; displayName?; email? }` would silently accept a roster missing the
  // fields that component reads.
  releases: Release[]
  members: ProjectMember[]
  onOpen: () => void
  /** Opens a disclosed Task's own detail — same destination as any other ID cell in the app. */
  onOpenTask: (itemKey: string) => void
}) {
  const { t } = useTranslation(['portfolio', 'work-items'])
  const update = useUpdateWorkItem(child.id)
  const patch = (body: UpdateWorkItemInput) => update.mutate(body)
  const stop = (event: React.MouseEvent) => event.stopPropagation()
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: child.id, disabled: dragDisabled })
  const dragStyle = useDragRowStyle({ transform, transition, isDragging })

  const ownerName = (() => {
    const member = members.find((m) => m.userId === child.assigneeId)
    return member?.displayName ?? member?.email ?? null
  })()

  return (
    <div ref={setNodeRef} style={dragStyle} {...(dragDisabled ? {} : attributes)}>
      <div
        // `min-w-max` (not an inline style) so the row is as wide as its columns and the
        // horizontal scroll region covers all of them.
        // `min-h-[34px]` with `items-center`, exactly as Iteration Status sizes its rows: a
        // MINIMUM, not a fixed height, so the row grows when a long Name or ID wraps, and the
        // cells stay vertically centred within whatever height that produces.
        className="group flex min-h-[34px] min-w-max cursor-pointer items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter"
        onClick={onOpen}
      >
        {/* Grip + checkbox, the same gutter every drag grid renders — the grip was missing here
            entirely, so the list arrived in rank order with no way to change it. */}
        <RowGutter
          ref={setActivatorNodeRef}
          dragListeners={dragDisabled ? undefined : listeners}
          dragDisabled={dragDisabled}
          stopPropagation
          checkbox={{ checked: selected, onChange: onToggleSelect, ariaLabel: selectLabel }}
        />
        {/* The expand chevron sits with the ID, where the removed Type column used to hold it.
            `IdCell` already renders the type badge, which is what that column duplicated. */}
        {/* The expand chevron sits with the ID, where the removed Type column used to hold it. */}
        <div style={colStyles.id} className="flex min-w-0 items-center gap-1 px-2" onClick={stop}>
          <RowExpandToggle expanded={expanded} onToggle={onToggleExpand} label={expandLabel} />
          <IdCell type={child.type} itemKey={child.itemKey} onOpen={onOpen} />
        </div>
        {/* `overflow-hidden`, as Iteration Status's Name cell has: it is what CONTAINS the
            editor. A flex child's `w-full` resolves against its parent, and without this the
            parent could be widened by its own content, so a long Name opened an input wider
            than the column and spilled across the cells beside it. */}
        <div style={colStyles.name} className="min-w-0 overflow-hidden px-0" onClick={stop}>
          <InlineEditableCell
            value={child.title}
            canEdit={canEdit}
            fullCell
            ariaLabel={t('detail.children.editName', { key: child.itemKey })}
            onCommit={(raw) => {
              const next = raw.trim()
              if (next && next !== child.title) patch({ title: next })
            }}
            className="block break-words whitespace-normal text-foreground"
            // No `inputClassName`: the shared `FULL_CELL_INPUT` already sizes the editor to the
            // cell. Overriding it dropped that `w-full`, so a long Name opened an input wider than
            // its column and spilled across the ones beside it.
            title={child.title}
          />
        </div>
        {/* Priority is Defect-only (§5.2); a Story shows the same `--` the Backlog shows. */}
        <div
          style={colStyles.priority}
          className="flex min-w-0 items-center overflow-hidden px-0"
          onClick={stop}
        >
          {child.type === 'defect' ? (
            <SearchableSelect
              value={child.priority ?? ''}
              readOnly={!canEdit}
              ariaLabel={t('detail.children.editPriority', { key: child.itemKey })}
              // `PRIORITY_VALUES` / `PRIORITY_LABEL` from the entity layer — the SAME source the
              // Backlog's priority cell uses. A local list here would be a second enum to keep in
              // step with `work_item_priority`, and the `work-items:priority.*` i18n block is not
              // that source: it still carries a `critical` key that migration 0011 remapped to
              // `urgent`, so it would have offered a value the column no longer has.
              options={PRIORITY_VALUES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
              // Cast to the UPDATE input's union, not to `WorkItem['priority']`: the read model
              // types this field as a bare `string` (the response DTO does not narrow it), so
              // `WiPriority` would not constrain anything. Same cast the Backlog cell uses.
              onChange={(v) => patch({ priority: v as UpdateWorkItemInput['priority'] })}
            />
          ) : (
            <span className="px-2 font-mono text-ui-xs text-foreground-disabled">--</span>
          )}
        </div>
        <div
          style={colStyles.estimate}
          className="flex items-center px-0 [&>*]:w-full"
          onClick={stop}
        >
          <InlineEditableCell
            value={child.storyPoints != null ? String(child.storyPoints) : ''}
            canEdit={canEdit}
            fullCell
            ariaLabel={t('detail.children.editEstimate', { key: child.itemKey })}
            onCommit={(raw) => {
              const next = raw.trim() === '' ? null : Number(raw)
              if (next !== null && (Number.isNaN(next) || next < 0)) return
              if (next !== (child.storyPoints ?? null)) patch({ storyPoints: next })
            }}
            // A dash, not 0: an unestimated Story is not a Story worth zero points.
            displayValue={child.storyPoints ?? '—'}
            className="block text-right font-mono text-muted-foreground tabular-nums"
            inputClassName="w-full rounded border border-primary bg-transparent px-0.5 text-right font-mono text-ui-xs text-foreground focus:outline-none"
          />
        </div>
        <div
          style={colStyles.owner}
          className="flex min-w-0 items-center overflow-hidden px-0"
          onClick={stop}
        >
          <OwnerSelectCell
            ownerName={ownerName}
            assigneeId={child.assigneeId}
            members={members}
            canEdit={canEdit}
            onChange={(userId) => patch({ assigneeId: userId })}
          />
        </div>
        <div
          style={colStyles.scheduleState}
          className="flex min-w-0 items-center overflow-hidden px-2"
          onClick={stop}
        >
          <StateStepper
            steps={SCHEDULE_STATE_STEPS}
            value={child.scheduleState as ScheduleState}
            canEdit={canEdit}
            onChange={(next) =>
              patch({ scheduleState: next as UpdateWorkItemInput['scheduleState'] })
            }
            ariaLabel={t('detail.children.editState', { key: child.itemKey })}
          />
        </div>
        {/* Iteration stays READ-ONLY text — §5.2 calls that a deliberate scope trim. */}
        {/* Read-only text that WRAPS, like the Name beside it — an iteration name is user-typed
            and can be long, and truncating it hid the end behind a tooltip nobody opens. */}
        <div style={colStyles.iteration} className="min-w-0 px-2">
          <span className="break-words whitespace-normal text-muted-foreground">
            {child.iterationName ?? '—'}
          </span>
        </div>
        <div
          style={colStyles.release}
          className="flex min-w-0 items-center overflow-hidden px-0"
          onClick={stop}
        >
          <SearchableSelect
            value={child.releaseId ?? ''}
            readOnly={!canEdit}
            ariaLabel={t('detail.children.editRelease', { key: child.itemKey })}
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
        {/* Task hours belong to Tasks, not to the Story/Defect — blank here, filled on the
            disclosed rows below. The cells still render: every row must carry one cell per column
            or the two fall out of step, which is exactly what happened when these three columns
            were added to the header and only the sub-row was given cells for them. */}
        <div style={colStyles.taskEstimate} className="px-2" />
        <div style={colStyles.toDo} className="px-2" />
        <div style={colStyles.actual} className="px-2" />
      </div>

      {expanded && (
        <ChildTaskRows
          workItemId={child.id}
          colStyles={colStyles}
          members={members}
          canEdit={canEdit}
          onOpenTask={onOpenTask}
        />
      )}
    </div>
  )
}

/**
 * A disclosed child's Tasks, READ-ONLY (FR-012).
 *
 * Fetched per expanded row rather than up front: a Feature can link many children and each of them
 * has its own task list, so loading all of them to render none would be the expensive default.
 *
 * Read-only is the spec, and it is also the honest boundary — a Task's hours belong to the Work
 * Item Detail's Tasks tab, which owns the totals that roll up from them.
 */
function ChildTaskRows({
  workItemId,
  colStyles,
  members,
  canEdit,
  onOpenTask,
}: {
  workItemId: string
  colStyles: Record<ChildColKey, CSSProperties>
  /** A task carries `assigneeId`, not a name — the roster resolves it, as the Tasks tab does. */
  members: ProjectMember[]
  canEdit: boolean
  onOpenTask: (itemKey: string) => void
}) {
  const { t } = useTranslation('portfolio')
  const { data: tasks = [], isLoading } = useTasks(workItemId)

  if (isLoading) {
    return (
      <div className="border-b border-border-inner bg-surface-subtle px-3 py-2">
        <span className={`text-ui-xs text-foreground-subtle ${NESTED_ROW_INDENT}`}>
          {t('detail.children.tasksLoading')}
        </span>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="border-b border-border-inner bg-surface-subtle px-3 py-2">
        <span className={`text-ui-xs text-foreground-subtle ${NESTED_ROW_INDENT}`}>
          {t('detail.children.noTasks')}
        </span>
      </div>
    )
  }

  return (
    <>
      {tasks.map((task: WorkItem) => (
        <ChildTaskRow
          key={task.id}
          task={task}
          colStyles={colStyles}
          members={members}
          canEdit={canEdit}
          onOpen={() => onOpenTask(task.itemKey)}
        />
      ))}
    </>
  )
}

/**
 * One disclosed Task.
 *
 * ONE CELL PER COLUMN in the parent's order, and every control is the one Iteration Status uses on
 * its own Task sub-rows: `StateStepper` over `SIMPLIFIED_STATE_STEPS` for state (a Task moves
 * through Defined/In-Progress/Completed, not the full I/D/P/C/A/R bar), `OwnerSelectCell` for
 * owner, and `InlineEditableCell` for each of the three hour fields.
 *
 * Editable, not read-only. §5.2 says the disclosed Tasks are read-only — but that predates Task
 * hours being editable from every other grid in the app, and a row that renders a picker on the
 * Backlog and flat text here is the inconsistency this whole pass is about. Gated on the same
 * `canEdit` as the parent row, so a reader without `portfolio:edit` still sees flat values.
 *
 * `Estimate`, `To Do` and `Actual` are three INDEPENDENT fields (CLAUDE.md) — none derives from
 * another, so each commits on its own.
 */
function ChildTaskRow({
  task,
  colStyles,
  members,
  canEdit,
  onOpen,
}: {
  task: WorkItem
  colStyles: Record<ChildColKey, CSSProperties>
  members: ProjectMember[]
  canEdit: boolean
  onOpen: () => void
}) {
  const update = useUpdateWorkItem(task.id)
  const stop = (event: React.MouseEvent) => event.stopPropagation()
  const owner = members.find((m) => m.userId === task.assigneeId)

  /** Hours are numeric and non-negative; a cleared field is null, not zero. */
  const commitHours = (field: 'estimateHours' | 'todoHours' | 'actualHours', raw: string) => {
    const next = raw.trim() === '' ? null : Number(raw)
    if (next !== null && (Number.isNaN(next) || next < 0)) return
    const current = task[field] != null ? Number(task[field]) : null
    if (next !== current) update.mutate({ [field]: next })
  }

  const hourCell = (
    field: 'estimateHours' | 'todoHours' | 'actualHours',
    style: CSSProperties,
    label: string,
  ) => (
    // `[&>*]:w-full` so the editor still spans the cell inside this flex wrapper — `fullCell`
    // sets `w-full`, which a flex child ignores without a basis.
    <div style={style} className="flex items-center px-0 [&>*]:w-full" onClick={stop}>
      <InlineEditableCell
        value={task[field] != null ? String(task[field]) : ''}
        canEdit={canEdit}
        fullCell
        onCommit={(raw) => commitHours(field, raw)}
        displayValue={task[field] ?? '--'}
        className={`${NUMERIC_CELL_CLASS} text-muted-foreground`}
        inputClassName="w-full rounded border border-primary bg-transparent px-0.5 text-right font-mono text-ui-xs text-foreground focus:outline-none"
        ariaLabel={`${task.itemKey} ${label}`}
      />
    </div>
  )

  return (
    // Grows with a wrapped Name or ID, exactly as the parent row does.
    <div className="flex min-h-[30px] min-w-max items-center border-b border-border-inner bg-surface-subtle px-3 text-ui-sm">
      <RowGutter dragDisabled />
      <div style={colStyles.id} className={`flex min-w-0 items-center pr-2 ${NESTED_ROW_INDENT}`}>
        <IdCell type={task.type} itemKey={task.itemKey} onOpen={onOpen} />
      </div>
      <div style={colStyles.name} className="min-w-0 overflow-hidden px-2" title={task.title}>
        <span className="break-words whitespace-normal text-muted-foreground">{task.title}</span>
      </div>
      {/* A Task has no Priority, and no Plan Estimate — that is the parent's points value. */}
      <div style={colStyles.priority} className="px-2" />
      <div style={colStyles.estimate} className="px-2" />
      <div
        style={colStyles.owner}
        className="flex min-w-0 items-center overflow-hidden px-0"
        onClick={stop}
      >
        <OwnerSelectCell
          ownerName={owner ? (owner.displayName ?? owner.email ?? null) : null}
          assigneeId={task.assigneeId}
          members={members}
          canEdit={canEdit}
          onChange={(userId) => update.mutate({ assigneeId: userId })}
          ariaLabel={`${task.itemKey} owner`}
        />
      </div>
      <div style={colStyles.scheduleState} className="flex items-center px-2" onClick={stop}>
        <StateStepper
          steps={SIMPLIFIED_STATE_STEPS}
          value={
            SIMPLIFIED_STATE_TO_SCHEDULE_STATE[
              getSimplifiedState(task.scheduleState as ScheduleState)
            ]
          }
          canEdit={canEdit}
          onChange={(next) => update.mutate({ scheduleState: next })}
          ariaLabel={`${task.itemKey} state`}
        />
      </div>
      {/* A Task inherits its parent's Iteration and Release — not its own fields to show. */}
      <div style={colStyles.iteration} className="px-2" />
      <div style={colStyles.release} className="px-2" />
      {hourCell('estimateHours', colStyles.taskEstimate, 'task estimate')}
      {hourCell('todoHours', colStyles.toDo, 'to do hours')}
      {hourCell('actualHours', colStyles.actual, 'actual hours')}
    </div>
  )
}

/** Client-side sort: the children of one Feature arrive whole, so there is nothing to re-fetch. */
function sortChildren(
  rows: PortfolioChild[],
  field: ChildSortField | null,
  dir: SortDir | null,
): PortfolioChild[] {
  if (field === null) return rows
  const direction: SortDir = dir ?? 'asc'
  const sign = direction === 'asc' ? 1 : -1
  const byText = (a: string, b: string) => sign * a.localeCompare(b)

  return [...rows].sort((a, b) => {
    switch (field) {
      case 'itemKey':
        return byText(a.itemKey, b.itemKey)
      case 'title':
        return byText(a.title, b.title)
      case 'priority':
        return byText(a.priority, b.priority)
      case 'estimate':
        return sign * ((a.storyPoints ?? 0) - (b.storyPoints ?? 0))
      case 'owner':
        return byText(text(a.ownerName), text(b.ownerName))
      case 'scheduleState':
        return byText(a.scheduleState, b.scheduleState)
      case 'iteration':
        return byText(text(a.iterationName), text(b.iterationName))
      case 'release':
        return byText(text(a.releaseName), text(b.releaseName))
    }
  })
}
