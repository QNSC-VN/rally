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

import { useTableSort } from '@/shared/lib/hooks/use-table-sort'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'

import type {
  ChartUnit,
  ReleaseBucket,
  ReleaseTrackingReport,
  ReleaseTrackingRow,
} from '@/features/reporting/api'
import { EmptyState } from '@/shared/ui/empty-state'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { RatioMeter } from '@/shared/ui/ratio-meter'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { DataTableFrame, RankCell, useDataTable, type ColumnSpec } from '@/shared/ui/table'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { TeamCell } from '@/shared/ui/team-cell'

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
  teamKeyOf = () => null,
  bucket,
  unit,
  bucketPicker,
  isLoading,
  isError = false,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  report: ReleaseTrackingReport | undefined
  /**
   * Team id → key, for the chip behind each row's team.
   *
   * The report names a row's teams but carries no keys, and `TeamAvatar` falls back to the name's
   * initials — so one team drew two different glyphs depending on which page you read it from. Resolved
   * by the PAGE, which owns the queries: this grid stays presentational, as the capacity grids are.
   */
  teamKeyOf?: (teamId: string | null | undefined) => string | null
  bucket: ReleaseBucket
  unit: ChartUnit
  /**
   * The bucket selector, rendered as the first thing in this grid's toolbar.
   *
   * Owned by the page (it drives the query) but PLACED here, because it selects what this list shows —
   * Rally puts it on the list's own row, opposite the search.
   */
  bucketPicker?: React.ReactNode
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
  /**
   * `useTableSort`, seeded with RT-AC-04's default (`rank`, ascending).
   *
   * The local pair it replaces also behaved differently from every other grid: `setSortDir((dir) =>
   * sortCol === col && dir === 'asc' ? 'desc' : 'asc')` kept the PREVIOUS direction when a new column
   * was clicked, so clicking Team after descending Rank sorted Team descending — the header's caret and
   * the rows agreed with each other and disagreed with the rest of the app, where a new column always
   * starts ascending.
   */
  const {
    sortField: sortCol,
    sortDir,
    toggle: toggleSort,
  } = useTableSort<string>({ field: 'rank', dir: 'asc' })

  /**
   * Rank, ID, NAME, Team, Issue, Status.
   *
   * DECLARED DIVERGENCE from §246, which enumerates them as "`Rank`, `ID`, `Team`, `Issue`, `Name`, and
   * `Status`". Rally puts Name immediately after ID — the name is what a reader scans for, and pushing
   * it behind two narrow columns buries it — and the SRS sentence is a set as much as a sequence. The
   * column SET is unchanged, which is the part §246 is really fixing; the order follows the product.
   * Readers can reorder anyway (`useDataTable`'s column drag persists per user), so this is the default
   * rather than a constraint.
   */
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
        // `RankCell`, like every other rank column: right-aligned, mono, tabular. `row.rank` is already
        // the 1-based position within the bucket (RT-AC-04), not the stored lexorank.
        cell: (row) => <RankCell rowNum={row.rank} />,
      },
      {
        key: 'id',
        label: t('columns.id'),
        defaultWidth: 90,
        sortCol: 'id',
        locked: true,
        /**
         * `IdCell` — the type glyph plus the key, as every other grid's ID column renders it.
         *
         * It was a bare `CellLink`, so this was the one ID column in the app with no `TypeBadge`: a
         * Feature, a Story and an Unparented Defect all read as identical blue text, on a page whose
         * three buckets are precisely about which KIND of thing is in the release. `issueType` was
         * already on the wire.
         */
        cell: (row, ctx) => (
          <IdCell type={row.issueType} itemKey={row.itemKey} onOpen={() => ctx.openItem(row)} />
        ),
      },
      {
        key: 'name',
        label: t('columns.name'),
        defaultWidth: 200,
        grow: true,
        locked: true,
        /**
         * JUST the name — plain wrapped text, the treatment Iteration Status gives its Name and the one
         * Rally uses: the ID is the link, the name is read as content.
         *
         * Two things were removed. It was a `CellLink`, so every name was blue and looked like a second
         * route to what the ID cell already opens. And a second line under it restated the bucket the
         * reader had just selected plus a child count and a state — none of it in §246's column list,
         * and all of it doubling the row's height in a panel that pages at 25.
         */
        cell: (row) => (
          <span
            className="block min-w-0 break-words whitespace-normal text-foreground"
            title={row.name}
          >
            {row.name}
          </span>
        ),
      },
      {
        key: 'team',
        label: t('columns.team'),
        defaultWidth: 130,
        sortCol: 'team',
        /**
         * `TeamCell` — the square team glyph plus its name — for the ONE-team case, which is every
         * Direct and Unparented row.
         *
         * A Derived row can name several teams (§5: the scoped children that caused inclusion), and no
         * single glyph is the answer for those, so they stay a joined list. That is the same reasoning
         * the capacity Features tab uses for a split Feature.
         *
         * An Unparented Story with no Team named at all rendered as an EMPTY cell, which reads as a
         * value that failed to load; `TeamCell` renders the shared `--`.
         */
        cell: (row) =>
          row.teams.length > 1 ? (
            <span className="truncate text-ui-xs text-muted-foreground">
              {row.teams.map((team) => team.name).join(', ')}
            </span>
          ) : (
            <TeamCell teamKey={teamKeyOf(row.teams[0]?.id)} name={row.teams[0]?.name ?? null} />
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
        key: 'status',
        label: t('columns.status'),
        defaultWidth: 170,
        cell: (row, ctx) => <StatusCell row={row} unit={ctx.unit} />,
      },
    ],
    // `teamKeyOf` too: the Team cell closes over it, so a column spec memoised without it would keep
    // rendering initials after the project's teams resolved.
    [t, teamKeyOf],
  )

  const table = useDataTable<ReleaseTrackingRow, Ctx, ColKey>(columns, {
    storageKey: 'release-tracking:columns',
    // `?? 'asc'`: the hook reports a null direction only while nothing is sorted, which cannot happen
    // here (it is seeded), but the header's contract wants a concrete direction.
    sort: { col: sortCol, dir: sortDir ?? 'asc', onSort: toggleSort },
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
      {/* SEARCH ONLY, through the shared toolbar every other grid uses — this was a bare
          `SearchInput` in a hand-rolled flex row, which is the same drift the Portfolio children
          tabs had. No Filters and no Add New, deliberately: RT §7 puts Project/Team in the global
          context and RT-AC-02 requires that "no duplicate page-level Project/Team filter exists",
          and the bucket selector is part of the page header rather than the grid. No Show Fields
          either — §5 specifies only that "columns are horizontally resizable". */}
      <PageToolbar
        /* The bucket picker LEADS the toolbar and the search sits at the far right — one row, as Rally
           lays this list out. The picker used to sit on its own row above the grid, which read as a
           filter for the panel rather than the selector for the list under it. */
        titleAccessory={bucketPicker}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('searchPlaceholder'),
          ariaLabel: t('searchPlaceholder'),
          width: 280,
          align: 'right',
        }}
      />
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
          /**
           * The same row chrome every other data grid in this app draws — Iteration Status, Backlog,
           * Portfolio, the capacity tables: `group`, a `min-h-[34px]` floor, `border-border-inner`,
           * `transition-colors` and `hover:bg-primary-lighter`.
           *
           * This one had been hand-written with `hover:bg-surface-hover` (the LIST-row hover, used by
           * Projects and Home), no `group`, no transition and a `py-1.5` height instead of a floor — so
           * the one grid on this page highlighted a different colour from the identical grid one menu
           * item away.
           *
           * `px-3` matters as much: it matches `DataTableFrame`'s default `padClassName`, which insets
           * the HEADER. Without it every cell sat 12px left of the label above it.
           */
          <div
            key={row.id}
            className="group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter"
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
