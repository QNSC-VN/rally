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
import { useMemo, useState } from 'react'
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
import { ProgressBar } from '@/shared/ui/progress-bar'
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
}: {
  report: ReleaseTrackingReport | undefined
  bucket: ReleaseBucket
  unit: ChartUnit
  isLoading: boolean
}) {
  const { t } = useTranslation('release-tracking')
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>('rank')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const columns: ColumnSpec<ReleaseTrackingRow, Ctx, ColKey>[] = useMemo(
    () => [
      {
        key: 'rank',
        label: t('columns.rank'),
        defaultWidth: 56,
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
            {row.teams.map((team) => team.name).join(', ')}
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
        empty={
          rows.length === 0 ? (
            <EmptyState
              title={t(`empty.${bucket}.title`)}
              description={t(`empty.${bucket}.description`)}
              size="sm"
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

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        {row.status.percent !== null && (
          <span className="text-ui-md font-semibold text-primary-light tabular-nums">
            {row.status.percent}%
          </span>
        )}
        <span className="truncate text-ui-xs text-muted-foreground">{label}</span>
      </div>
      <ProgressBar ratio={ratio} showLabel={false} title={label} />
    </div>
  )
}
