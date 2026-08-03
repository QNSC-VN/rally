import { EMPTY_VALUE } from '@/shared/lib/utils'
import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useSortable } from '@dnd-kit/sortable'
import { toast } from 'sonner'

import {
  useDataTable,
  useRowRerank,
  useDragRowStyle,
  SelectableTable,
  RankCell,
} from '@/shared/ui/table'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'
import { Plus } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { InlineSelect } from '@/shared/ui/native-select'
import { EmptyState } from '@/shared/ui/empty-state'
import { RowGutter } from '@/shared/ui/row-gutter'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useTableSort, type SortDir } from '@/shared/lib/hooks/use-table-sort'
import { useRankPortfolioItem, type PortfolioItem } from '@/features/portfolio/api'
import { EPIC_CHILD_COLUMNS, type EpicChildColKey } from '../model/children-columns'

type EpicSortField = 'itemKey' | 'name' | 'team' | 'state' | 'owner'

const text = (value: string | null): string => value ?? ''

/**
 * An Epic's child FEATURES, with the roll-ups the BA lists: Rank, ID, Name, Team, State, Complete,
 * Rollup, Estimated, Owner.
 *
 * A different question from a Feature's Children, which are Stories and Defects — so a different
 * column set, not a parameter on one table. An Epic owns no story-level work directly; its numbers are
 * its Features' roll-ups, which is why Complete/Rollup/Estimated appear here where the Feature's tab
 * shows Priority/Iteration.
 *
 * The SHELL, though, is the one every complex grid uses: `SelectableTable` owns the select-all
 * gutter, the bulk bar and the dnd wrapper, exactly as it does for Backlog, Iteration Status and the
 * Work Item Tasks tab. This tab used a bare `DataTableFrame` instead, so it had no selection, no
 * drag and no skeleton — while the Portfolio LIST, rendering the same entity through the same rank
 * endpoint, had all three.
 *
 * `Complete` is `completedPoints` (COMPLETED_SCHEDULE_STATES) rather than `acceptedPoints`: on a
 * capacity-shaped reading, Complete means the team FINISHED it. The Portfolio's own Percent Done
 * columns use the accepted-only rule, and the two are documented as the D1 distinction — mixing them
 * in one grid would put two different meanings under one heading.
 *
 * `Rank` is the row's position in the list, not the LexoRank string, which sorts as text and means
 * nothing to a reader.
 */
export function EpicChildrenTable({
  features,
  canEdit = false,
  isLoading = false,
  onAddFeature,
}: {
  features: PortfolioItem[]
  canEdit?: boolean
  isLoading?: boolean
  /**
   * Create a Feature under THIS Epic. Omitted when the caller cannot create.
   *
   * An Epic's children are Features, so this tab's Add New makes a Feature — the same rule
   * the Feature Children tab follows for its own Story/Defect children.
   */
  onAddFeature?: () => void
}) {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<string>('all')
  const { sortField, sortDir, toggle } = useTableSort<EpicSortField>()

  const table = useDataTable<PortfolioItem, unknown, EpicChildColKey>(EPIC_CHILD_COLUMNS, {
    storageKey: 'rally-portfolio-epic-children-columns',
    // The select/drag gutter is 48px wide and sits before every column; without it the computed
    // table width is short by exactly that, and the horizontal scroll region ends early.
    leadingWidth: 48,
    sort: {
      col: sortField ?? '',
      dir: sortDir ?? 'asc',
      onSort: (c) => toggle(c as EpicSortField),
    },
  })

  // Column sizing comes straight from the shared engine — see `useDataTable().colStyles`.
  const colStyles = table.colStyles

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = features.filter(
      (feature) =>
        (needle === '' ||
          feature.itemKey.toLowerCase().includes(needle) ||
          feature.name.toLowerCase().includes(needle)) &&
        (stateFilter === 'all' || feature.state === stateFilter),
    )
    return sortFeatures(rows, sortField, sortDir)
  }, [features, search, stateFilter, sortField, sortDir])

  /** The states these Features are actually in, so the filter never offers an empty result. */
  const featureStates = useMemo(() => [...new Set(features.map((f) => f.state))].sort(), [features])

  const selection = useRowSelection(visible)

  /**
   * Drag-to-rank, through the same endpoint the Portfolio list uses.
   *
   * Disabled while a column sort is active — the visible order would no longer be rank, so a drop
   * would compute neighbours from a list the server does not share — and disabled without
   * `portfolio:edit`. The Rank column numbers rows 1..N; before this it numbered an order the
   * reader could not change from here.
   */
  const rank = useRankPortfolioItem()
  const dragDisabled = sortField !== null || !canEdit
  const rerank = useRowRerank({
    items: visible,
    disabled: dragDisabled,
    onReorder: ({ id, beforeId, afterId }) =>
      rank.mutate({ id, beforeId, afterId }, { onError: (err) => toast.error(err.message) }),
  })

  /** Footed over the VISIBLE rows, so the totals cannot disagree with the rows above them. */
  const totals = visible.reduce(
    (acc, feature) => ({
      complete: acc.complete + feature.rollup.completedPoints,
      rollup: acc.rollup + feature.rollup.rollupPoints,
      estimated: acc.estimated + feature.estimate.points.value,
    }),
    { complete: 0, rollup: 0, estimated: 0 },
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* The same toolbar the Feature Children tab uses — search, Add New, Filters, Show Fields.
          Add New creates a FEATURE, because that is what an Epic's children are; the Feature
          Children tab's own Add New creates a Story/Defect for the same reason. This tab
          previously had no Add New at all, on the reasoning that a child Feature is made from
          the Portfolio list — but that is one more navigation for the level the user is already
          looking at, and P5-PI-FR-032 puts Epic Detail on the Feature detail template, which
          has one. */}
      <PageToolbar
        actions={
          canEdit && onAddFeature ? (
            <Button size="sm" onClick={onAddFeature}>
              <Plus size={14} /> {t('create.titleFeature')}
            </Button>
          ) : undefined
        }
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('detail.children.searchFeatures'),
          ariaLabel: t('detail.children.searchFeatures'),
          width: 220,
        }}
        activeFilterCount={stateFilter !== 'all' ? 1 : 0}
        defaultFiltersOpen={stateFilter !== 'all'}
        filters={
          <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
            {t('detail.children.filterState')}
            <InlineSelect
              value={stateFilter}
              aria-label={t('detail.children.filterState')}
              onChange={(e) => setStateFilter(e.target.value)}
              className="w-auto"
            >
              <option value="all">{t('detail.children.allStates')}</option>
              {featureStates.map((state) => (
                <option key={state} value={state}>
                  {t(`states.${state}`, { defaultValue: state })}
                </option>
              ))}
            </InlineSelect>
          </label>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      <SelectableTable
        className="rounded border border-border-strong"
        rows={rerank.items}
        selection={selection}
        selectAllAriaLabel={t('detail.children.selectAllFeatures')}
        headerProps={{ ...table.headerProps, colStyles }}
        sort={{
          col: sortField ?? '',
          dir: sortDir ?? 'asc',
          onSort: (c) => toggle(c as EpicSortField),
        }}
        dnd={{
          dndContextProps: rerank.dndContextProps,
          sortableContextProps: rerank.sortableContextProps,
        }}
        loading={isLoading}
        skeleton={{ rows: 4, cols: EPIC_CHILD_COLUMNS.length }}
        // Inside the frame, not after it: rendered as a sibling the row scrolled horizontally
        // while the totals stayed put, so the numbers drifted out from under their columns.
        totals={
          visible.length > 0 ? (
            <TableTotalsRow
              columns={EPIC_CHILD_COLUMNS}
              colStyles={colStyles}
              leading={<RowGutter dragDisabled />}
              label={t('detail.children.totals', { count: visible.length })}
              labelColKey="name"
              values={{
                complete: String(totals.complete),
                rollup: String(totals.rollup),
                estimated: String(totals.estimated),
              }}
            />
          ) : undefined
        }
        empty={
          visible.length === 0 ? (
            <EmptyState
              title={
                features.length === 0 ? t('detail.children.empty') : t('detail.children.noMatches')
              }
            />
          ) : undefined
        }
        renderRow={(feature, { selected, onToggleSelect }) => (
          <EpicChildRow
            key={feature.id}
            feature={feature}
            rowNum={rerank.items.indexOf(feature) + 1}
            colStyles={colStyles}
            dragDisabled={dragDisabled}
            selected={selected}
            onToggleSelect={onToggleSelect}
            onOpen={() =>
              void navigate({ to: '/portfolio/$itemId', params: { itemId: feature.id } })
            }
            stateLabel={t(`states.${feature.state}`, { defaultValue: feature.state })}
            selectLabel={t('detail.children.selectFeature', { key: feature.itemKey })}
          />
        )}
      />
    </div>
  )
}

/**
 * One child Feature.
 *
 * Owns its `useSortable` + `<RowGutter>` the way every other `SelectableTable` row does, so the grip
 * and checkbox line up with the header's select-all across all of them.
 */
function EpicChildRow({
  feature,
  rowNum,
  colStyles,
  dragDisabled,
  selected,
  onToggleSelect,
  onOpen,
  stateLabel,
  selectLabel,
}: {
  feature: PortfolioItem
  rowNum: number
  colStyles: Record<EpicChildColKey, CSSProperties>
  dragDisabled: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  stateLabel: string
  selectLabel: string
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: feature.id, disabled: dragDisabled })
  const dragStyle = useDragRowStyle({ transform, transition, isDragging })

  return (
    <div
      ref={setNodeRef}
      // `min-w-max` is a class; the drag style is genuinely dynamic and comes from the shared
      // `useDragRowStyle`, so this row cannot drift from the other six drag grids.
      className="group flex min-h-[34px] min-w-max items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter"
      style={dragStyle}
    >
      <RowGutter
        ref={setActivatorNodeRef}
        dragListeners={dragDisabled ? undefined : listeners}
        dragAttributes={dragDisabled ? undefined : attributes}
        dragDisabled={dragDisabled}
        stopPropagation
        checkbox={{ checked: selected, onChange: onToggleSelect, ariaLabel: selectLabel }}
      />
      <RankCell rowNum={rowNum} style={colStyles.rank} />
      <div style={colStyles.id} className="flex items-center px-2">
        <IdCell type={feature.type} itemKey={feature.itemKey} onOpen={onOpen} />
      </div>
      <div style={colStyles.name} className="min-w-0 px-2" title={feature.name}>
        <span className="break-words whitespace-normal text-foreground">{feature.name}</span>
      </div>
      <div style={colStyles.team} className="min-w-0 px-2">
        <span className="break-words whitespace-normal text-muted-foreground">
          {feature.teamName ?? EMPTY_VALUE}
        </span>
      </div>
      <div style={colStyles.state} className="min-w-0 px-2">
        <span className="break-words whitespace-normal text-muted-foreground">{stateLabel}</span>
      </div>
      <div
        style={colStyles.complete}
        className="px-2 text-right text-muted-foreground tabular-nums"
      >
        {feature.rollup.completedPoints}
      </div>
      <div style={colStyles.rollup} className="px-2 text-right text-muted-foreground tabular-nums">
        {feature.rollup.rollupPoints}
      </div>
      {/* The RESOLVED estimate, not the raw `refinedEstimate` column.
          That column is NOT NULL DEFAULT 0 and 0 means "not forecast" — it falls through to the
          Preliminary size mapping everywhere else — so a Feature sized only by a T-shirt read 0 here
          and in the totals row below, while its own detail page showed the mapped number. The API
          resolves the tier once and ships both units. */}
      <div
        style={colStyles.estimated}
        className="px-2 text-right text-muted-foreground tabular-nums"
      >
        {feature.estimate.points.tier === 'none' ? EMPTY_VALUE : feature.estimate.points.value}
      </div>
      <div style={colStyles.owner} className="min-w-0 px-2">
        <span className="break-words whitespace-normal text-muted-foreground">
          {feature.ownerName ?? EMPTY_VALUE}
        </span>
      </div>
    </div>
  )
}

function sortFeatures(
  rows: PortfolioItem[],
  field: EpicSortField | null,
  dir: SortDir | null,
): PortfolioItem[] {
  // No sort = the API's RANK order, which is what the `Rank` column numbers.
  if (field === null) return rows
  const sign = (dir ?? 'asc') === 'asc' ? 1 : -1
  const byText = (a: string, b: string) => sign * a.localeCompare(b)

  return [...rows].sort((a, b) => {
    switch (field) {
      case 'itemKey':
        return byText(a.itemKey, b.itemKey)
      case 'name':
        return byText(a.name, b.name)
      case 'team':
        return byText(text(a.teamName), text(b.teamName))
      case 'state':
        return byText(a.state, b.state)
      case 'owner':
        return byText(text(a.ownerName), text(b.ownerName))
    }
  })
}
