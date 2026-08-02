import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'

import { useDataTable, SelectableTable } from '@/shared/ui/table'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'
import { SearchInput } from '@/shared/ui/search-input'
import { EmptyState } from '@/shared/ui/empty-state'
import { RowGutter } from '@/shared/ui/row-gutter'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { useTableSort, type SortDir } from '@/shared/lib/hooks/use-table-sort'
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
 * Rows navigate to the work item, they are NOT editable here — a gap against §5.2, which asks for
 * inline edit on Name/Priority/Est/Owner/Schedule State/Release plus expand-to-Tasks and `Add Item`.
 * That is tracked separately rather than smuggled into a consistency pass.
 */
export function FeatureChildrenTable({
  children,
  isLoading = false,
}: {
  children: PortfolioChild[]
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
          <div
            key={child.id}
            // `min-w-max` (not an inline style) so the row is as wide as its columns and the
            // horizontal scroll region covers all of them.
            className="group flex min-h-[34px] min-w-max items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter"
          >
            {/* `dragDisabled` always: a Story's rank is not a portfolio rank (see the note above),
                so the grip would be a control with nothing to persist. The gutter still renders so
                the checkbox column lines up with the header's select-all and the totals row. */}
            <RowGutter
              dragDisabled
              stopPropagation
              checkbox={{
                checked: selected,
                onChange: onToggleSelect,
                ariaLabel: t('detail.children.selectChild', { key: child.itemKey }),
              }}
            />
            <div style={colStyles.type} className="flex items-center justify-center px-1">
              <TypeBadge type={child.type} size={16} />
            </div>
            <div style={colStyles.id} className="flex items-center px-2">
              <IdCell
                type={child.type}
                itemKey={child.itemKey}
                onOpen={() =>
                  void navigate({ to: '/item/$itemKey', params: { itemKey: child.itemKey } })
                }
              />
            </div>
            <div style={colStyles.name} className="min-w-0 px-2" title={child.title}>
              <span className="break-words whitespace-normal text-foreground">{child.title}</span>
            </div>
            <div style={colStyles.priority} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {t(`work-items:priority.${child.priority}`, { defaultValue: child.priority })}
              </span>
            </div>
            <div
              style={colStyles.estimate}
              className="px-2 text-right text-muted-foreground tabular-nums"
            >
              {/* A dash, not 0: an unestimated Story is not a Story worth zero points. */}
              {child.storyPoints ?? '—'}
            </div>
            <div style={colStyles.owner} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {child.ownerName ?? '—'}
              </span>
            </div>
            <div style={colStyles.scheduleState} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {child.scheduleState}
              </span>
            </div>
            <div style={colStyles.iteration} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {child.iterationName ?? '—'}
              </span>
            </div>
            <div style={colStyles.release} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {child.releaseName ?? '—'}
              </span>
            </div>
          </div>
        )}
      />
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
