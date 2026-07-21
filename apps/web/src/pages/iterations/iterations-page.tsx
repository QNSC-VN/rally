/**
 * Timeboxes › Iterations — P2.2 Iteration Management
 *
 * Lists iterations for the active project/team with search, state filter, sort
 * and pagination; a quick-create modal; and a full-page detail (Theme/Notes +
 * right panel). State maps DB planning/committed/accepted ↔ UI Planning/Committed/Accepted.
 *
 * Grid uses the shared `useDataTable` engine + `DataTableFrame` (resize / reorder /
 * show-hide + identical chrome), replacing the former hand-rolled flex-grid and
 * bespoke pagination (FRONTEND_COMPONENT_AUDIT §5.2).
 */
import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Inbox, Plus } from 'lucide-react'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { TimeboxTypeSwitcher } from '@/pages/timeboxes/timebox-type-switcher'
import { EmptyState } from '@/shared/ui/empty-state'
import { InlineSelect } from '@/shared/ui/native-select'
import { Button } from '@/shared/ui/button'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { DataTableFrame, useDataTable } from '@/shared/ui/table'
import { StatusBadge } from '@/shared/ui/status-badge'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { ITERATION_STATE_STYLE } from '@/features/iterations/status-colors'
import { CreateIterationModal, IterationDetail } from './ui/iteration-parts'
import { type ColKey, ITERATIONS_COLUMNS } from './model/columns'
import { useIterations, type Iteration, type IterationState } from '@/features/iterations/api'

// ── Page ────────────────────────────────────────────────────────────────────

export function IterationsPage() {
  const { t } = useTranslation('iterations')
  const { project } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canManage = can('iteration:create') || can('iteration:edit') || can('iteration:delete')

  const { data: iterations = [], isLoading, isError } = useIterations(projectId)

  // ── Shared table engine (resize / reorder / show-hide) ──
  const table = useDataTable<Iteration, unknown, ColKey>(ITERATIONS_COLUMNS, {
    storageKey: STORAGE_KEYS.ITERATIONS_COLUMNS,
  })
  const colStyleFor = useCallback(
    (key: ColKey, base?: CSSProperties) => table.styleFor(key, base),
    [table],
  )

  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | IterationState>('all')
  const [sort, setSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' }>({
    key: 'startDate',
    dir: 'asc',
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [showCreate, setShowCreate] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = iterations.filter((it) => {
      const matchesQ =
        !q ||
        [it.name, it.theme ?? '', it.iterationKey ?? ''].some((v) => v.toLowerCase().includes(q))
      const matchesState = stateFilter === 'all' || it.state === stateFilter
      return matchesQ && matchesState
    })
    const sorted = [...rows].sort((a, b) => {
      const av = a[sort.key] ?? ''
      const bv = b[sort.key] ?? ''
      const r =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? r : -r
    })
    return sorted
  }, [iterations, search, stateFilter, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const activePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((activePage - 1) * pageSize, activePage * pageSize)

  const toggleSort = useCallback((key: ColKey) => {
    setSort((p) =>
      p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    )
  }, [])

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-ui-lg text-foreground-subtle">
        {t('selectProject')}
      </div>
    )
  }

  if (detailId) {
    return <IterationDetail id={detailId} canManage={canManage} onBack={() => setDetailId(null)} />
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <PageToolbar
        title={t('title')}
        titleAccessory={<TimeboxTypeSwitcher current="iterations" />}
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setPage(1)
          },
          placeholder: 'Search iterations…',
          ariaLabel: 'Search iterations',
          width: 190,
        }}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={12} /> {t('createButton')}
            </Button>
          ) : undefined
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
        activeFilterCount={stateFilter !== 'all' ? 1 : 0}
        defaultFiltersOpen={stateFilter !== 'all'}
        filters={
          <>
            <div className="flex items-center gap-1.5 rounded border border-border-subtle bg-card px-2 py-1.5">
              <span className="text-ui-sm font-semibold text-muted-foreground">
                {t('filterState')}
              </span>
              <InlineSelect
                value={stateFilter}
                aria-label="Filter iterations by state"
                onChange={(e) => {
                  setStateFilter(e.target.value as 'all' | IterationState)
                  setPage(1)
                }}
                className="w-auto"
              >
                <option value="all">All</option>
                <option value="planning">Planning</option>
                <option value="committed">Committed</option>
                <option value="accepted">Accepted</option>
              </InlineSelect>
            </div>
            {stateFilter !== 'all' && (
              <button
                onClick={() => setStateFilter('all')}
                className="cursor-pointer rounded px-2.5 py-1 text-ui-sm text-primary-light hover:bg-primary-lighter"
              >
                {t('clearFilters')}
              </button>
            )}
          </>
        }
      />

      {/* Table — shared DataTableFrame owns the header/scroll/loading/empty chrome;
          the leading iteration-key cell is a gutter (not a reorderable column). */}
      <DataTableFrame
        header={{
          ...table.headerProps,
          sort: { col: sort.key, dir: sort.dir, onSort: (k) => toggleSort(k as ColKey) },
        }}
        leading={<div className="w-16 shrink-0" />}
        loading={isLoading}
        skeleton={{ rows: 8, cols: 6 }}
        error={
          isError ? (
            <EmptyState
              icon={<AlertTriangle size={28} className="text-destructive" />}
              title={t('loadError')}
            />
          ) : undefined
        }
        empty={
          pageRows.length === 0 ? (
            <EmptyState
              icon={<Inbox size={32} className="text-foreground-subtle" />}
              title={t('empty')}
            />
          ) : undefined
        }
        footer={
          filtered.length > 0 ? (
            <PaginationFooter
              pageSize={pageSize}
              setPageSize={(n) => {
                setPageSize(n)
                setPage(1)
              }}
              currentPage={activePage}
              rangeStart={(activePage - 1) * pageSize + 1}
              rangeEnd={(activePage - 1) * pageSize + pageRows.length}
              total={filtered.length}
              pageCount={totalPages}
              hasPrevPage={activePage > 1}
              hasNextPage={activePage < totalPages}
              onPrevPage={() => setPage(activePage - 1)}
              onNextPage={() => setPage(activePage + 1)}
            />
          ) : undefined
        }
      >
        {pageRows.map((it) => (
          <div
            key={it.id}
            onClick={() => setDetailId(it.id)}
            className="flex h-8 cursor-pointer items-center border-b border-border-inner px-3 transition-colors hover:bg-surface-subtle"
            style={{ minWidth: 'max-content' }}
          >
            <div
              className="w-16 shrink-0 truncate px-2 font-mono text-ui-xs text-foreground-subtle"
              title={it.iterationKey ?? ''}
            >
              {it.iterationKey ?? ''}
            </div>
            <div
              style={colStyleFor('name', { flexShrink: 0 })}
              className="truncate px-2 text-ui-sm font-medium text-foreground"
              title={it.name}
            >
              {it.name}
            </div>
            <div
              style={colStyleFor('theme', { flexShrink: 0 })}
              className="truncate px-2 text-ui-sm text-foreground"
            >
              {it.theme ?? ''}
            </div>
            <div
              style={colStyleFor('startDate', { flexShrink: 0 })}
              className="truncate px-2 text-ui-sm text-muted-foreground"
            >
              {it.startDate ?? ''}
            </div>
            <div
              style={colStyleFor('endDate', { flexShrink: 0 })}
              className="truncate px-2 text-ui-sm text-muted-foreground"
            >
              {it.endDate ?? ''}
            </div>
            <div
              style={colStyleFor('plannedVelocity', { flexShrink: 0 })}
              className="px-2 text-right font-mono text-ui-sm text-muted-foreground tabular-nums"
            >
              {it.plannedVelocity ?? ''}
            </div>
            <div style={colStyleFor('state', { flexShrink: 0 })} className="px-2">
              <StatusBadge style={ITERATION_STATE_STYLE[it.state]} />
            </div>
          </div>
        ))}
      </DataTableFrame>

      {showCreate && projectId && (
        <CreateIterationModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false)
            setDetailId(id)
          }}
        />
      )}
    </div>
  )
}
