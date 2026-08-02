/**
 * The Release Tracking list (RT §5, RT-AC-04/05/07).
 *
 * `Rank`, `ID`, `Team`, `Issue`, `Name`, `Status` — one bucket at a time. Built on the shared
 * `useDataTable` engine, which is where the resizable columns and the two-directional sorting on
 * Rank/ID/Team come from; hand-rolling either would have been a fourth copy of that plumbing.
 *
 * Rank is the row's position INSIDE the active bucket (1, 2, 3…), not the stored lexorank — the
 * server numbers them, and the superseded `D` marker for Derived rows is deliberately absent.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'

import type {
  ChartUnit,
  ReleaseBucket,
  ReleaseTrackingReport,
  ReleaseTrackingRow,
} from '@/features/reporting/api'
import { CellLink } from '@/shared/ui/cell-link'
import { EmptyState } from '@/shared/ui/empty-state'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { RatioMeter } from '@/shared/ui/ratio-meter'
import { SearchInput } from '@/shared/ui/search-input'
import { DataTableFrame, useDataTable, type ColumnSpec } from '@/shared/ui/table'

import { IssuesPanel } from './issues-panel'

type ColKey = 'rank' | 'id' | 'team' | 'issue' | 'name' | 'status'

interface Ctx {
  unit: ChartUnit
  bucket: ReleaseBucket
  release: ReleaseTrackingReport['release']
  openItem: (row: ReleaseTrackingRow) => void
}

export function TrackingGrid({
  report,
  bucket,
  unit,
  isLoading,
  isError = false,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  report: ReleaseTrackingReport | undefined
  bucket: ReleaseBucket
  unit: ChartUnit
  isLoading: boolean
  isError?: boolean
  /** 1-based page, owned by the page component because it drives the query. */
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const { t } = useTranslation(['release-tracking', 'common'])
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>('rank')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const columns: ColumnSpec<ReleaseTrackingRow, Ctx, ColKey>[] = useMemo(
    () => [
      {
        key: 'rank',
        label: t('columns.rank'),
        // 72, not 56: at 56 the cell has 40px of content box after its padding, and "Rank" plus the
        // sort caret does not fit — the header truncated to "Ran…" on the column RT-AC-04 makes the
        // default sort. The values are single or double digits, so the extra 16px costs nothing.
        defaultWidth: 72,
        align: 'right',
        sortCol: 'rank',
        locked: true,
        cell: (row) => <span className="text-ui-md tabular-nums">{row.rank}</span>,
      },
      {
        key: 'id',
        label: t('columns.id'),
        defaultWidth: 90,
        sortCol: 'id',
        locked: true,
        cell: (row, ctx) => <CellLink onClick={() => ctx.openItem(row)}>{row.itemKey}</CellLink>,
      },
      {
        key: 'team',
        label: t('columns.team'),
        defaultWidth: 130,
        sortCol: 'team',
        // Derived rows can list more than one Team: the scoped children that caused inclusion
        // (§5), which is why this is a joined list rather than a single Team cell.
        cell: (row) => (
          <span className="truncate text-ui-md text-muted-foreground">
            {/* An Unparented Story with no Team rendered as an empty cell, which reads as a value
                that failed to load. Every other grid in the app names it. */}
            {row.teams.length > 0
              ? row.teams.map((team) => team.name).join(', ')
              : t('common:unassigned')}
          </span>
        ),
      },
      {
        key: 'issue',
        label: t('columns.issue'),
        defaultWidth: 60,
        align: 'center',
        cell: (row, ctx) => (
          <IssuesPanel
            row={row}
            releaseName={ctx.release.name}
            releaseStart={ctx.release.startDate}
            releaseEnd={ctx.release.releaseDate}
          />
        ),
      },
      {
        key: 'name',
        label: t('columns.name'),
        defaultWidth: 200,
        grow: true,
        locked: true,
        cell: (row, ctx) => (
          <div className="min-w-0">
            <CellLink wrap onClick={() => ctx.openItem(row)}>
              {row.name}
            </CellLink>
            <p className="text-ui-xs text-foreground-subtle">
              {ctx.bucket === 'unparented'
                ? t('subtitle.unparented', { type: t(`type.${row.issueType}`), state: row.state })
                : t(`subtitle.${ctx.bucket}`, { count: row.childCount, state: row.state })}
            </p>
          </div>
        ),
      },
      {
        key: 'status',
        label: t('columns.status'),
        defaultWidth: 170,
        cell: (row, ctx) => <StatusCell row={row} unit={ctx.unit} />,
      },
    ],
    [t],
  )

  const table = useDataTable<ReleaseTrackingRow, Ctx, ColKey>(columns, {
    storageKey: 'release-tracking:columns',
    sort: {
      col: sortCol,
      dir: sortDir,
      onSort: (col) => {
        setSortDir((dir) => (sortCol === col && dir === 'asc' ? 'desc' : 'asc'))
        setSortCol(col)
      },
    },
  })

  /**
   * `report.rows` is ONE SERVER PAGE of the active bucket, not the whole bucket.
   *
   * The endpoint classifies Direct/Derived/Unparented and computes every total over the full
   * population, then slices — so `summary` and `totals` are unaffected by which page arrived,
   * while the rows that travel are bounded. That matters because the population grows with the
   * PROJECT's feature count: a Derived Feature is by definition one OUTSIDE the release, so the
   * query cannot be narrowed by the release, and this grid previously mounted every row of it.
   *
   * Search and sort therefore operate on the LOADED PAGE only. Both are page-local refinements,
   * which is why the search box says so — silently searching one page while looking like it
   * searches the bucket is the failure worth avoiding. Pushing either into the query is the
   * natural next step and needs a BA decision, since §5 specifies neither.
   */
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    // Search applies WITHIN the active bucket (§5), never across all three.
    const filtered = term
      ? (report?.rows ?? []).filter(
          (row) =>
            row.name.toLowerCase().includes(term) || row.itemKey.toLowerCase().includes(term),
        )
      : (report?.rows ?? [])

    const direction = sortDir === 'asc' ? 1 : -1
    const compare = (a: ReleaseTrackingRow, b: ReleaseTrackingRow) => {
      if (sortCol === 'id') return a.itemKey.localeCompare(b.itemKey) * direction
      if (sortCol === 'team') {
        const left = a.teams.map((team) => team.name).join(', ')
        const right = b.teams.map((team) => team.name).join(', ')
        return left.localeCompare(right) * direction
      }
      return (a.rank - b.rank) * direction
    }
    return [...filtered].sort(compare)
  }, [report, search, sortCol, sortDir])

  // The server's own account of the slice. `total` is the whole bucket, so the footer reports
  // the population even though only one page of rows is in memory.
  const total = report?.page.total ?? 0
  const pageCount = report?.page.pageCount ?? 1
  const currentPage = report?.page.page ?? page
  const rangeStart = (currentPage - 1) * pageSize + 1
  const goPrevPage = useCallback(
    () => onPageChange(Math.max(1, currentPage - 1)),
    [currentPage, onPageChange],
  )
  const goNextPage = useCallback(
    () => onPageChange(Math.min(pageCount, currentPage + 1)),
    [currentPage, pageCount, onPageChange],
  )

  const ctx: Ctx = {
    unit,
    bucket,
    release: report?.release ?? { id: '', name: '', startDate: null, releaseDate: null },
    openItem: (row) => {
      // A Feature opens its portfolio detail; an Unparented row IS a work item (§5).
      if (row.issueType === 'feature') {
        void navigate({ to: '/portfolio/$itemId', params: { itemId: row.id } })
      } else {
        void navigate({ to: '/item/$itemKey', params: { itemKey: row.itemKey } })
      }
    },
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('searchPlaceholder')}
          className="max-w-[280px]"
        />
      </div>
      <DataTableFrame<ColKey>
        header={table.headerProps}
        loading={isLoading && !report}
        // Without this a failed request fell through to the bucket's empty state, which asserts
        // something about the release's contents ("no Features are directly assigned…") on the
        // strength of a network fault.
        error={
          isError ? (
            <EmptyState title={t('error.title')} description={t('error.description')} size="sm" />
          ) : undefined
        }
        empty={
          rows.length === 0 ? (
            <EmptyState
              title={t(`empty.${bucket}.title`)}
              description={t(`empty.${bucket}.description`)}
              size="sm"
            />
          ) : undefined
        }
        footer={
          report && total > 0 ? (
            <PaginationFooter
              pageSize={pageSize}
              setPageSize={onPageSizeChange}
              currentPage={currentPage}
              rangeStart={rangeStart}
              // The page's own length, so a search that hides rows on this page narrows the
              // range rather than claiming rows that are not on screen.
              rangeEnd={rangeStart + rows.length - 1}
              total={total}
              pageCount={pageCount}
              hasPrevPage={currentPage > 1}
              hasNextPage={currentPage < pageCount}
              onPrevPage={goPrevPage}
              onNextPage={goNextPage}
            />
          ) : undefined
        }
      >
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center border-b border-border-inner py-1.5 hover:bg-surface-hover"
          >
            {table.renderCells(row, ctx)}
          </div>
        ))}
      </DataTableFrame>
    </div>
  )
}

/**
 * `50%  5/10 points accepted` for a Direct row; `5/10 points accepted` for a Derived one.
 *
 * The missing percentage on Derived is the contract, not an omission: its denominator is a slice
 * of the Feature (only the children in this release and scope), so a percentage would read as the
 * Feature's own progress (RT-BR-05).
 */
function StatusCell({ row, unit }: { row: ReleaseTrackingRow; unit: ChartUnit }) {
  const { t } = useTranslation('release-tracking')
  const ratio = row.status.total > 0 ? row.status.accepted / row.status.total : null
  const label = t(unit === 'points' ? 'status.points' : 'status.count', {
    accepted: row.status.accepted,
    total: row.status.total,
  })

  /**
   * `RatioMeter`, the shared percentage-over-bar primitive, rather than a fourth hand-rolled copy of
   * it. This cell had assembled its own — percentage and ratio on one line, thin bar under — with two
   * differences that were bugs rather than choices:
   *
   *   • the percentage was ALWAYS `text-primary-light`, the colour this product reserves for done, so
   *     a Feature at 0% was printed in the same blue as one at 100%;
   *   • `percent` came from the server (floored, RT-BR-05) while nothing tied the bar to it.
   *
   * `percent` is passed through explicitly so the floor survives — the meter would otherwise round,
   * and 99.6% must read 99, not 100.
   */
  return (
    <RatioMeter
      ratio={ratio}
      percent={row.status.percent}
      hidePercent={row.status.percent === null}
      accepted={row.status.accepted}
      total={row.status.total}
      label={label}
      title={label}
    />
  )
}
