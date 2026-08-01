import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'

import { DataTableFrame } from '@/shared/ui/table/data-table-frame'
import { useDataTable } from '@/shared/ui/table'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'
import { SearchInput } from '@/shared/ui/search-input'
import { EmptyState } from '@/shared/ui/empty-state'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { TypeBadge } from '@/entities/work-item/ui/badges'
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
 * columns, `DataTableFrame` for the header and scroll body, `TableTotalsRow` for the footed `Est`
 * column, and `useTableSort` for the same click-to-sort semantics every other grid has. None of that
 * is reimplemented here — the point of the BA calling it "Backlog-style" is that it IS the same table.
 *
 * Search is client-side over the loaded rows: the children of one Feature are a bounded set (the
 * endpoint returns them for that Feature alone), so there is no page to re-fetch and a server round
 * trip per keystroke would be slower and no more correct.
 *
 * Rows navigate to the work item, they are NOT editable here. The BA's inline editing lives on the
 * Backlog and on the item's own detail; a second editing surface for the same fields would be two
 * places to keep in step, and the disclosure rows on the Portfolio list already made that mistake
 * once.
 */
export function FeatureChildrenTable({ children }: { children: PortfolioChild[] }) {
  // Two namespaces: the tab's own copy, and `work-items` for the priority labels — those already
  // exist there and a portfolio-local copy would be a second vocabulary for one enum.
  const { t } = useTranslation(['portfolio', 'work-items'])
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const { sortField, sortDir, toggle } = useTableSort<ChildSortField>()

  const table = useDataTable<PortfolioChild, unknown, ChildColKey>(PORTFOLIO_CHILD_COLUMNS, {
    storageKey: 'rally-portfolio-children-columns',
    sort: {
      col: sortField ?? '',
      dir: sortDir ?? 'asc',
      onSort: (c) => toggle(c as ChildSortField),
    },
  })

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SearchInput
        value={search}
        onChange={setSearch}
        ariaLabel={t('detail.children.search')}
        placeholder={t('detail.children.search')}
        width={240}
      />

      <DataTableFrame
        header={table.headerProps}
        padClassName="px-3"
        empty={
          visible.length === 0 ? (
            <EmptyState
              title={
                children.length === 0 ? t('detail.children.empty') : t('detail.children.noMatches')
              }
            />
          ) : undefined
        }
      >
        {visible.map((child) => (
          <div
            key={child.id}
            className="group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter"
          >
            <div
              style={table.styleFor('type', { flexShrink: 0 })}
              className="flex items-center justify-center px-1"
            >
              <TypeBadge type={child.type} size={16} />
            </div>
            <div style={table.styleFor('id', { flexShrink: 0 })} className="flex items-center px-2">
              <IdCell
                type={child.type}
                itemKey={child.itemKey}
                onOpen={() =>
                  void navigate({ to: '/item/$itemKey', params: { itemKey: child.itemKey } })
                }
              />
            </div>
            <div
              style={table.styleFor('name', { flexShrink: 0 })}
              className="min-w-0 px-2"
              title={child.title}
            >
              <span className="break-words whitespace-normal text-foreground">{child.title}</span>
            </div>
            <div style={table.styleFor('priority', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {t(`work-items:priority.${child.priority}`, { defaultValue: child.priority })}
              </span>
            </div>
            <div
              style={table.styleFor('estimate', { flexShrink: 0 })}
              className="px-2 text-right text-muted-foreground tabular-nums"
            >
              {/* A dash, not 0: an unestimated Story is not a Story worth zero points. */}
              {child.storyPoints ?? '—'}
            </div>
            <div style={table.styleFor('owner', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {child.ownerName ?? '—'}
              </span>
            </div>
            <div
              style={table.styleFor('scheduleState', { flexShrink: 0 })}
              className="min-w-0 px-2"
            >
              <span className="break-words whitespace-normal text-muted-foreground">
                {child.scheduleState}
              </span>
            </div>
            <div style={table.styleFor('iteration', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {child.iterationName ?? '—'}
              </span>
            </div>
            <div style={table.styleFor('release', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {child.releaseName ?? '—'}
              </span>
            </div>
          </div>
        ))}
      </DataTableFrame>

      {visible.length > 0 && (
        <TableTotalsRow
          columns={table.headerProps.columns}
          colStyles={table.colStyles}
          label={t('detail.children.totals', { count: visible.length })}
          labelColKey="name"
          values={{ estimate: String(totalEstimate) }}
        />
      )}
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
