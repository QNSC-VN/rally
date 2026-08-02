import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'

import { useDataTable, SelectableTable } from '@/shared/ui/table'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'
import { SearchInput } from '@/shared/ui/search-input'
import { EmptyState } from '@/shared/ui/empty-state'
import { RowGutter } from '@/shared/ui/row-gutter'
import { RowExpandToggle } from '@/shared/ui/row-expand-toggle'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { OwnerSelectCell } from '@/shared/ui/owner-cell'
import { NESTED_ROW_INDENT } from '@/shared/config/layout'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { StateStepper } from '@/entities/work-item/ui/state-stepper'
import { SCHEDULE_STATE_STEPS } from '@/entities/work-item/ui/state-steps'
import { ScheduleState } from '@/entities/work-item/model/types'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useTableSort, type SortDir } from '@/shared/lib/hooks/use-table-sort'
import { useReleases } from '@/features/releases/api'
import { useProjectMembers } from '@/features/teams/api'
import {
  useTasks,
  useUpdateWorkItem,
  type UpdateWorkItemInput,
  type WorkItem,
} from '@/features/work-items/api'
import type { PortfolioChild } from '@/features/portfolio/api'
import { PORTFOLIO_CHILD_COLUMNS, type ChildColKey } from '../model/children-columns'

/** The BA's Priority column is Defect-only (§5.2); these are the values it offers. */
const PRIORITY_VALUES = ['none', 'low', 'normal', 'high', 'urgent'] as const

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
 * bar and the scroll body — `TableTotalsRow` for the footed `Est` column, and `useTableSort` for the
 * same click-to-sort semantics. None of that is reimplemented here; the point of the BA calling it
 * "Backlog-style" is that it IS the same table.
 *
 * NO drag-to-rank, unlike the Epic tab beside it and the Tasks tab it otherwise matches. That is the
 * data model, not an omission: a `PortfolioChild` is a Story or Defect, whose rank lives on the work
 * item and is reordered from the Backlog — `/v1/portfolio-items/{id}/rank` ranks Features among
 * Features. The column set carries no Rank column for the same reason, so there is no order here for
 * a drag to express.
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
 * `Add Item` and the pagination footer are the remaining §5.2 items and are NOT here: the first
 * needs the Backlog creation flow's contract for a pre-linked child, and the second is a server
 * decision, since these rows arrive whole from one endpoint.
 */
export function FeatureChildrenTable({
  children,
  projectId,
  canEdit = false,
  isLoading = false,
}: {
  children: PortfolioChild[]
  /** The Feature's project — scopes the Release and Owner option lists. */
  projectId: string | undefined
  /** `portfolio:edit`. FR-011 gates inline editing on it. */
  canEdit?: boolean
  isLoading?: boolean
}) {
  // Two namespaces: the tab's own copy, and `work-items` for the priority labels — those already
  // exist there and a portfolio-local copy would be a second vocabulary for one enum.
  const { t } = useTranslation(['portfolio', 'work-items'])
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
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

  /**
   * Column styles computed ONCE per layout change, not per cell.
   *
   * Every cell used to call `table.styleFor(key, { flexShrink: 0 })` inline, allocating a fresh style
   * object per cell per render and pinning every column — including `name`, which the column spec
   * declares as `grow`. It now flexes to fill, like the Tasks tab's Name column.
   */
  const colStyles = useMemo(
    () =>
      Object.fromEntries(
        PORTFOLIO_CHILD_COLUMNS.map((c) => [
          c.key,
          table.styleFor(c.key, c.key === 'name' ? { flex: 1, minWidth: 160 } : { flexShrink: 0 }),
        ]),
      ) as Record<ChildColKey, CSSProperties>,
    [table],
  )

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = children.filter(
      (child) =>
        needle === '' ||
        child.itemKey.toLowerCase().includes(needle) ||
        child.title.toLowerCase().includes(needle),
    )
    return sortChildren(rows, sortField, sortDir)
  }, [children, search, sortField, sortDir])

  /**
   * The BA's Totals row, summing Plan Estimate.
   *
   * Over the VISIBLE rows, not all of them: a total that ignored the search would disagree with the
   * rows above it, and the reader would have no way to tell which set it described.
   */
  const totalEstimate = visible.reduce((sum, child) => sum + (child.storyPoints ?? 0), 0)

  const selection = useRowSelection(visible)

  // Option lists for the editable cells, scoped to the Feature's own project — the same two
  // queries the Backlog row uses, so the choices offered here are the choices offered there.
  const { data: releases = [] } = useReleases(projectId)
  const { data: members = [] } = useProjectMembers(projectId)

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SearchInput
        value={search}
        onChange={setSearch}
        ariaLabel={t('detail.children.search')}
        placeholder={t('detail.children.search')}
        width={240}
      />

      <SelectableTable
        className="rounded border border-border-strong"
        rows={visible}
        selection={selection}
        selectAllAriaLabel={t('detail.children.selectAll')}
        headerProps={{ ...table.headerProps, colStyles }}
        sort={{
          col: sortField ?? '',
          dir: sortDir ?? 'asc',
          onSort: (c) => toggle(c as ChildSortField),
        }}
        loading={isLoading}
        skeleton={{ rows: 4, cols: PORTFOLIO_CHILD_COLUMNS.length }}
        // Inside the frame, not after it: rendered as a sibling the rows scrolled horizontally
        // while the totals stayed put, so the sum drifted out from under the `Est` column.
        totals={
          visible.length > 0 ? (
            <TableTotalsRow
              columns={PORTFOLIO_CHILD_COLUMNS}
              colStyles={colStyles}
              leading={<RowGutter dragDisabled />}
              label={t('detail.children.totals', { count: visible.length })}
              labelColKey="name"
              values={{ estimate: String(totalEstimate) }}
            />
          ) : undefined
        }
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
  selected,
  onToggleSelect,
  selectLabel,
  expanded,
  onToggleExpand,
  expandLabel,
  releases,
  members,
  onOpen,
}: {
  child: PortfolioChild
  colStyles: Record<ChildColKey, CSSProperties>
  canEdit: boolean
  selected: boolean
  onToggleSelect: () => void
  selectLabel: string
  expanded: boolean
  onToggleExpand: () => void
  expandLabel: string
  releases: { id: string; name: string; releaseKey?: string | null }[]
  members: { userId: string; displayName?: string | null; email?: string | null }[]
  onOpen: () => void
}) {
  const { t } = useTranslation(['portfolio', 'work-items'])
  const update = useUpdateWorkItem(child.id)
  const patch = (body: UpdateWorkItemInput) => update.mutate(body)
  const stop = (event: React.MouseEvent) => event.stopPropagation()

  const ownerName = (() => {
    const member = members.find((m) => m.userId === child.assigneeId)
    return member?.displayName ?? member?.email ?? null
  })()

  return (
    <div>
      <div
        // `min-w-max` (not an inline style) so the row is as wide as its columns and the
        // horizontal scroll region covers all of them.
        className="group flex min-h-[34px] min-w-max cursor-pointer items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter"
        onClick={onOpen}
      >
        {/* `dragDisabled` always: a Story's rank is not a portfolio rank (see the note above),
            so the grip would be a control with nothing to persist. The gutter still renders so
            the checkbox column lines up with the header's select-all and the totals row. */}
        <RowGutter
          dragDisabled
          stopPropagation
          checkbox={{ checked: selected, onChange: onToggleSelect, ariaLabel: selectLabel }}
        />
        <div
          style={colStyles.type}
          className="flex items-center justify-center gap-1 px-1"
          onClick={stop}
        >
          <RowExpandToggle expanded={expanded} onToggle={onToggleExpand} label={expandLabel} />
          <TypeBadge type={child.type} size={16} />
        </div>
        <div style={colStyles.id} className="flex items-center px-2" onClick={stop}>
          <IdCell type={child.type} itemKey={child.itemKey} onOpen={onOpen} />
        </div>
        <div style={colStyles.name} className="min-w-0 px-0" onClick={stop}>
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
            inputClassName="w-full rounded border border-primary bg-transparent px-1 text-ui-md text-foreground focus:outline-none"
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
              options={PRIORITY_VALUES.map((p) => ({
                value: p,
                label: t(`work-items:priority.${p}`, { defaultValue: p }),
              }))}
              onChange={(v) => patch({ priority: v as UpdateWorkItemInput['priority'] })}
            />
          ) : (
            <span className="px-2 font-mono text-ui-xs text-foreground-disabled">--</span>
          )}
        </div>
        <div style={colStyles.estimate} className="px-0 text-right" onClick={stop}>
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
          className="min-w-0 overflow-hidden px-2"
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
      </div>

      {expanded && <ChildTaskRows workItemId={child.id} colStyles={colStyles} members={members} />}
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
}: {
  workItemId: string
  colStyles: Record<ChildColKey, CSSProperties>
  /** A task carries `assigneeId`, not a name — the roster resolves it, as the Tasks tab does. */
  members: { userId: string; displayName?: string | null; email?: string | null }[]
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
      {tasks.map((task: WorkItem) => {
        const owner = members.find((m) => m.userId === task.assigneeId)
        return (
          <div
            key={task.id}
            className="flex min-h-[30px] min-w-max items-center border-b border-border-inner bg-surface-subtle px-3 text-ui-sm"
          >
            <div className="w-12 shrink-0" />
            <div style={colStyles.id} className={`truncate px-2 ${NESTED_ROW_INDENT}`}>
              <span className="font-mono text-ui-xs text-foreground-subtle">{task.itemKey}</span>
            </div>
            <div style={colStyles.name} className="min-w-0 px-2" title={task.title}>
              <span className="break-words whitespace-normal text-muted-foreground">
                {task.title}
              </span>
            </div>
            <div style={colStyles.priority} className="min-w-0 px-2">
              <span className="truncate text-ui-xs text-foreground-subtle">
                {task.scheduleState}
              </span>
            </div>
            <div
              style={colStyles.estimate}
              className="px-2 text-right font-mono text-muted-foreground tabular-nums"
            >
              {task.estimateHours ?? '—'}
            </div>
            <div style={colStyles.owner} className="min-w-0 truncate px-2">
              <span className="text-ui-xs text-muted-foreground">
                {owner?.displayName ?? owner?.email ?? '—'}
              </span>
            </div>
            {/* To Do and Actual share the remaining span, as the mockup renders them. */}
            <div style={colStyles.scheduleState} className="min-w-0 px-2">
              <span className="text-ui-xs text-foreground-subtle">
                {t('detail.children.taskHours', {
                  todo: task.todoHours ?? 0,
                  actual: task.actualHours ?? 0,
                })}
              </span>
            </div>
          </div>
        )
      })}
    </>
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
