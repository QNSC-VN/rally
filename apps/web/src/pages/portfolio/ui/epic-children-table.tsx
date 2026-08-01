import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'

import { DataTableFrame } from '@/shared/ui/table/data-table-frame'
import { useDataTable } from '@/shared/ui/table'
import { TableTotalsRow } from '@/shared/ui/table-totals-row'
import { SearchInput } from '@/shared/ui/search-input'
import { EmptyState } from '@/shared/ui/empty-state'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { useTableSort, type SortDir } from '@/shared/lib/hooks/use-table-sort'
import type { PortfolioItem } from '@/features/portfolio/api'
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
 * `Complete` is `completedPoints` (COMPLETED_SCHEDULE_STATES) rather than `acceptedPoints`: on a
 * capacity-shaped reading, Complete means the team FINISHED it. The Portfolio's own Percent Done
 * columns use the accepted-only rule, and the two are documented as the D1 distinction — mixing them
 * in one grid would put two different meanings under one heading.
 *
 * `Rank` is the row's position in the list, not the LexoRank string, which sorts as text and means
 * nothing to a reader.
 */
export function EpicChildrenTable({ features }: { features: PortfolioItem[] }) {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const { sortField, sortDir, toggle } = useTableSort<EpicSortField>()

  const table = useDataTable<PortfolioItem, unknown, EpicChildColKey>(EPIC_CHILD_COLUMNS, {
    storageKey: 'rally-portfolio-epic-children-columns',
    sort: {
      col: sortField ?? '',
      dir: sortDir ?? 'asc',
      onSort: (c) => toggle(c as EpicSortField),
    },
  })

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const rows = features.filter(
      (feature) =>
        needle === '' ||
        feature.itemKey.toLowerCase().includes(needle) ||
        feature.name.toLowerCase().includes(needle),
    )
    return sortFeatures(rows, sortField, sortDir)
  }, [features, search, sortField, sortDir])

  /** Footed over the VISIBLE rows, so the totals cannot disagree with the rows above them. */
  const totals = visible.reduce(
    (acc, feature) => ({
      complete: acc.complete + feature.rollup.completedPoints,
      rollup: acc.rollup + feature.rollup.rollupPoints,
      estimated: acc.estimated + feature.refinedEstimate,
    }),
    { complete: 0, rollup: 0, estimated: 0 },
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SearchInput
        value={search}
        onChange={setSearch}
        ariaLabel={t('detail.children.searchFeatures')}
        placeholder={t('detail.children.searchFeatures')}
        width={240}
      />

      <DataTableFrame
        header={table.headerProps}
        padClassName="px-3"
        empty={
          visible.length === 0 ? (
            <EmptyState
              title={
                features.length === 0 ? t('detail.children.empty') : t('detail.children.noMatches')
              }
            />
          ) : undefined
        }
      >
        {visible.map((feature, index) => (
          <div
            key={feature.id}
            className="group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter"
          >
            <div
              style={table.styleFor('rank', { flexShrink: 0 })}
              className="px-2 text-right text-muted-foreground tabular-nums"
            >
              {index + 1}
            </div>
            <div style={table.styleFor('id', { flexShrink: 0 })} className="flex items-center px-2">
              <IdCell
                type={feature.type}
                itemKey={feature.itemKey}
                onOpen={() =>
                  void navigate({ to: '/portfolio/$itemId', params: { itemId: feature.id } })
                }
              />
            </div>
            <div
              style={table.styleFor('name', { flexShrink: 0 })}
              className="min-w-0 px-2"
              title={feature.name}
            >
              <span className="break-words whitespace-normal text-foreground">{feature.name}</span>
            </div>
            <div style={table.styleFor('team', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {feature.teamName ?? '—'}
              </span>
            </div>
            <div style={table.styleFor('state', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {t(`states.${feature.state}`, { defaultValue: feature.state })}
              </span>
            </div>
            <div
              style={table.styleFor('complete', { flexShrink: 0 })}
              className="px-2 text-right text-muted-foreground tabular-nums"
            >
              {feature.rollup.completedPoints}
            </div>
            <div
              style={table.styleFor('rollup', { flexShrink: 0 })}
              className="px-2 text-right text-muted-foreground tabular-nums"
            >
              {feature.rollup.rollupPoints}
            </div>
            <div
              style={table.styleFor('estimated', { flexShrink: 0 })}
              className="px-2 text-right text-muted-foreground tabular-nums"
            >
              {feature.refinedEstimate}
            </div>
            <div style={table.styleFor('owner', { flexShrink: 0 })} className="min-w-0 px-2">
              <span className="break-words whitespace-normal text-muted-foreground">
                {feature.ownerName ?? '—'}
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
          values={{
            complete: String(totals.complete),
            rollup: String(totals.rollup),
            estimated: String(totals.estimated),
          }}
        />
      )}
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
