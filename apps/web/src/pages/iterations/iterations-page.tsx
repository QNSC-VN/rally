/**
 * Timeboxes › Iterations — P2.2 Iteration Management
 *
 * Lists iterations for the active project/team with search, state filter, sort
 * and pagination; a quick-create modal; and a full-page detail (Theme/Notes +
 * right panel). State maps DB planning/committed/accepted ↔ UI Planning/Committed/Accepted.
 */
import { useMemo, useState } from 'react'
import { ChevronLeft, Plus } from 'lucide-react'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { SkeletonList } from '@/shared/ui/skeleton'
import { InlineSelect } from '@/shared/ui/native-select'
import { Button } from '@/shared/ui/button'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ITERATION_STATE_STYLE } from '@/features/iterations/status-colors'
import { CreateIterationModal, IterationDetail } from './ui/iteration-parts'
import { useIterations, type IterationState } from '@/features/iterations/api'

// ── State label mapping (DB ↔ UI) ────────────────────────────────────────────

// ── Columns ───────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'theme' | 'startDate' | 'endDate' | 'state' | 'plannedVelocity'
const COLUMNS: Array<{ key: SortKey; label: string; width: number; align?: 'right' }> = [
  { key: 'name', label: 'Name', width: 220 },
  { key: 'theme', label: 'Theme', width: 260 },
  { key: 'startDate', label: 'Start Date', width: 130 },
  { key: 'endDate', label: 'End Date', width: 130 },
  { key: 'plannedVelocity', label: 'Planned Velocity', width: 130, align: 'right' },
  { key: 'state', label: 'State', width: 120 },
]

const PAGE_SIZE = 25

// ── Page ────────────────────────────────────────────────────────────────────

export function IterationsPage() {
  const { project } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canManage = can('iteration:create') || can('iteration:edit') || can('iteration:delete')

  const { data: iterations = [], isLoading, isError } = useIterations(projectId)

  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | IterationState>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'startDate',
    dir: 'asc',
  })
  const [page, setPage] = useState(1)
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const activePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)

  function toggleSort(key: SortKey) {
    setSort((p) =>
      p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    )
  }

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-ui-lg text-foreground-subtle">
        Select a project to view iterations.
      </div>
    )
  }

  if (detailId) {
    return <IterationDetail id={detailId} canManage={canManage} onBack={() => setDetailId(null)} />
  }

  const tableWidth = COLUMNS.reduce((t, c) => t + c.width, 0) + 64

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <PageToolbar
        title="Timeboxes"
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
              <Plus size={12} /> Create Iteration
            </Button>
          ) : undefined
        }
        activeFilterCount={stateFilter !== 'all' ? 1 : 0}
        defaultFiltersOpen={stateFilter !== 'all'}
        filters={
          <>
            <div className="flex items-center gap-1.5 rounded border border-border-subtle bg-card px-2 py-1.5">
              <span className="text-ui-sm font-semibold text-muted-foreground">State</span>
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
                Clear filters
              </button>
            )}
          </>
        }
      />

      {/* Table */}
      <div className="flex flex-1 flex-col overflow-hidden bg-card">
        <div className="flex-1 overflow-auto">
          <div style={{ width: tableWidth, minWidth: '100%' }}>
            <div className="sticky top-0 z-10 flex h-8 items-center border-b border-border-subtle bg-surface-hover px-3 select-none">
              <div className="w-16 shrink-0" />
              {COLUMNS.map((c) => {
                const active = sort.key === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`flex h-full items-center gap-1 border-r border-border-subtle px-2 text-ui-sm font-semibold ${active ? 'text-primary' : 'text-foreground-subtle'}`}
                    style={{
                      width: c.width,
                      justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <span className="truncate">{c.label}</span>
                    {active && <span>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                )
              })}
            </div>

            {isLoading && <SkeletonList rows={8} cols={6} />}

            {!isLoading && isError && (
              <div className="flex h-40 items-center justify-center text-ui-md text-destructive">
                Failed to load iterations. Please try again.
              </div>
            )}

            {!isLoading &&
              !isError &&
              pageRows.map((it) => (
                <div
                  key={it.id}
                  onClick={() => setDetailId(it.id)}
                  className="flex h-8 cursor-pointer items-center border-b border-border-inner px-3 transition-colors hover:bg-surface-subtle"
                  style={{ width: tableWidth, minWidth: '100%' }}
                >
                  <div
                    className="w-16 shrink-0 truncate px-2 font-mono text-ui-xs text-foreground-subtle"
                    title={it.iterationKey ?? ''}
                  >
                    {it.iterationKey ?? ''}
                  </div>
                  <div
                    className="shrink-0 truncate px-2 text-ui-sm font-medium text-foreground"
                    style={{ width: COLUMNS[0].width }}
                    title={it.name}
                  >
                    {it.name}
                  </div>
                  <div
                    className="shrink-0 truncate px-2 text-ui-sm text-foreground"
                    style={{ width: COLUMNS[1].width }}
                  >
                    {it.theme ?? ''}
                  </div>
                  <div
                    className="shrink-0 truncate px-2 text-ui-sm text-muted-foreground"
                    style={{ width: COLUMNS[2].width }}
                  >
                    {it.startDate ?? ''}
                  </div>
                  <div
                    className="shrink-0 truncate px-2 text-ui-sm text-muted-foreground"
                    style={{ width: COLUMNS[3].width }}
                  >
                    {it.endDate ?? ''}
                  </div>
                  <div
                    className="shrink-0 px-2 text-right font-mono text-ui-sm text-muted-foreground tabular-nums"
                    style={{ width: COLUMNS[4].width }}
                  >
                    {it.plannedVelocity ?? ''}
                  </div>
                  <div className="shrink-0 px-2" style={{ width: COLUMNS[5].width }}>
                    <StatusBadge style={ITERATION_STATE_STYLE[it.state]} />
                  </div>
                </div>
              ))}

            {!isLoading && !isError && pageRows.length === 0 && (
              <div className="flex h-40 items-center justify-center text-ui-md text-foreground-subtle">
                No iterations found
              </div>
            )}
          </div>
        </div>

        {/* Pagination */}
        <div className="flex h-10 shrink-0 items-center justify-between border-t border-border-subtle bg-card px-3">
          <span className="text-ui-sm text-foreground-subtle">
            {filtered.length === 0
              ? '0 records'
              : `${(activePage - 1) * PAGE_SIZE + 1}-${Math.min(activePage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-ui-sm text-muted-foreground tabular-nums">
              Page {activePage} of {totalPages}
            </span>
            <button
              aria-label="Previous page"
              disabled={activePage === 1}
              onClick={() => setPage(activePage - 1)}
              className="cursor-pointer rounded border border-border-subtle p-1.5 text-muted-foreground transition-colors hover:bg-primary-lighter disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              aria-label="Next page"
              disabled={activePage === totalPages}
              onClick={() => setPage(activePage + 1)}
              className="cursor-pointer rounded border border-border-subtle p-1.5 text-muted-foreground transition-colors hover:bg-primary-lighter disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronLeft size={13} className="rotate-180" />
            </button>
          </div>
        </div>
      </div>

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
