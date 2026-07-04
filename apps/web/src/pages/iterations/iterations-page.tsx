/**
 * Timeboxes › Iterations — P2.2 Iteration Management
 *
 * Lists iterations for the active project/team with search, state filter, sort
 * and pagination; a quick-create modal; and a full-page detail (Theme/Notes +
 * right panel). State maps DB planning/committed/accepted ↔ UI Planning/Committed/Accepted.
 */
import { useMemo, useState } from 'react'
import { ChevronLeft, Filter, Loader2, Plus, Search } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useProjectTeams } from '@/features/teams/api'
import {
  useIterations,
  useIteration,
  useCreateIteration,
  useUpdateIteration,
  type IterationState,
} from '@/features/iterations/api'

// ── State label mapping (DB ↔ UI) ────────────────────────────────────────────

const STATE_LABEL: Record<IterationState, string> = {
  planning: 'Planning',
  committed: 'Committed',
  accepted: 'Accepted',
}
const STATE_STYLE: Record<IterationState, { bg: string; text: string; border: string }> = {
  planning: { bg: '#eef3fb', text: '#1d3f73', border: '#bdd0ef' },
  committed: { bg: '#fef5e4', text: '#8a5808', border: '#f4d28d' },
  accepted: { bg: '#eaf5ed', text: '#1e6930', border: '#b9dec2' },
}

function StateBadge({ state }: { state: IterationState }) {
  const s = STATE_STYLE[state]
  return (
    <span
      className="inline-flex items-center px-1.5 py-px text-[11px] font-medium rounded-sm whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {STATE_LABEL[state]}
    </span>
  )
}

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
  const canManage = useAuthStore((s) => s.hasPermission('iteration:manage'))

  const { data: iterations = [], isLoading } = useIterations(projectId)

  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
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
        [it.name, it.theme ?? '', it.iterationKey ?? ''].some((v) =>
          v.toLowerCase().includes(q),
        )
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
    setSort((p) => (p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px]" style={{ color: BRAND.textMuted }}>
        Select a project to view iterations.
      </div>
    )
  }

  if (detailId) {
    return <IterationDetail id={detailId} canManage={canManage} onBack={() => setDetailId(null)} />
  }

  const tableWidth = COLUMNS.reduce((t, c) => t + c.width, 0) + 40

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex items-end gap-2 px-4 py-2 shrink-0"
        style={{ backgroundColor: BRAND.surface, borderBottom: `1px solid ${BRAND.borderSubtle}` }}
      >
        <div className="flex flex-col items-start gap-1.5 mr-2 min-w-[150px]">
          <h2 className="text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>
            Timeboxes
          </h2>
          {canManage && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-white rounded"
              style={{ backgroundColor: BRAND.primary }}
            >
              <Plus size={12} /> Create Iteration
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: BRAND.textMuted }} />
          <input
            type="text"
            placeholder="Search iterations..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="pl-7 pr-3 py-1 text-[11px] rounded focus:outline-none"
            style={{ backgroundColor: BRAND.surfaceSubtle, border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary, width: 190 }}
          />
        </div>
        <button
          onClick={() => setShowFilters((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold rounded"
          style={{ border: '1px solid #bdd0ef', color: BRAND.primaryLight, backgroundColor: showFilters || stateFilter !== 'all' ? '#edf2fb' : '#fff' }}
        >
          <Filter size={12} /> {showFilters ? 'Hide filter' : 'Show filter'}
          {stateFilter !== 'all' ? ' (1)' : ''}
        </button>
        <div className="flex-1" />
      </div>

      {showFilters && (
        <div className="px-4 py-3 shrink-0" style={{ backgroundColor: '#f5f8fc', borderBottom: '1px solid #cfdced' }}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded" style={{ backgroundColor: BRAND.surface, border: `1px solid ${BRAND.borderSubtle}` }}>
              <span className="text-[11px] font-semibold" style={{ color: BRAND.textSecondary }}>
                State
              </span>
              <select
                value={stateFilter}
                aria-label="Filter iterations by state"
                onChange={(e) => {
                  setStateFilter(e.target.value as 'all' | IterationState)
                  setPage(1)
                }}
                className="text-[11px] px-2 py-1 rounded bg-white focus:outline-none"
                style={{ minWidth: 120, border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
              >
                <option value="all">All</option>
                <option value="planning">Planning</option>
                <option value="committed">Committed</option>
                <option value="accepted">Accepted</option>
              </select>
            </div>
            {stateFilter !== 'all' && (
              <button onClick={() => setStateFilter('all')} className="px-2.5 py-1 text-[11px] rounded" style={{ color: BRAND.primaryLight }}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex flex-col flex-1 overflow-hidden" style={{ backgroundColor: BRAND.surface }}>
        <div className="flex-1 overflow-auto">
          <div style={{ width: tableWidth, minWidth: '100%' }}>
            <div
              className="sticky top-0 z-10 flex items-center h-8 px-3 select-none"
              style={{ backgroundColor: BRAND.surfaceHover, borderBottom: `1px solid ${BRAND.borderSubtle}` }}
            >
              <div className="w-10 shrink-0" />
              {COLUMNS.map((c) => {
                const active = sort.key === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className="h-full flex items-center gap-1 px-2 text-[11px] font-semibold"
                    style={{ width: c.width, color: active ? BRAND.primary : BRAND.textMuted, borderRight: `1px solid ${BRAND.borderSubtle}`, justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start' }}
                  >
                    <span className="truncate">{c.label}</span>
                    {active && <span>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                )
              })}
            </div>

            {isLoading && (
              <div className="h-40 flex items-center justify-center text-[12px]" style={{ color: BRAND.textMuted }}>
                Loading…
              </div>
            )}

            {!isLoading &&
              pageRows.map((it) => (
                <div
                  key={it.id}
                  onClick={() => setDetailId(it.id)}
                  className="flex items-center h-8 px-3 cursor-pointer transition-colors hover:bg-[#f4f6f9]"
                  style={{ width: tableWidth, minWidth: '100%', borderBottom: `1px solid ${BRAND.borderInner}` }}
                >
                  <div className="w-10 shrink-0 px-2 text-[10px] font-mono truncate" style={{ color: BRAND.textMuted }}>
                    {it.iterationKey ?? ''}
                  </div>
                  <div className="shrink-0 px-2 text-[11px] font-medium truncate" style={{ width: COLUMNS[0].width, color: BRAND.textPrimary }}>
                    {it.name}
                  </div>
                  <div className="shrink-0 px-2 text-[11px] truncate" style={{ width: COLUMNS[1].width, color: BRAND.textPrimary }}>
                    {it.theme ?? ''}
                  </div>
                  <div className="shrink-0 px-2 text-[11px] truncate" style={{ width: COLUMNS[2].width, color: BRAND.textSecondary }}>
                    {it.startDate ?? ''}
                  </div>
                  <div className="shrink-0 px-2 text-[11px] truncate" style={{ width: COLUMNS[3].width, color: BRAND.textSecondary }}>
                    {it.endDate ?? ''}
                  </div>
                  <div className="shrink-0 px-2 text-right text-[11px] font-mono tabular-nums" style={{ width: COLUMNS[4].width, color: BRAND.textSecondary }}>
                    {it.plannedVelocity ?? ''}
                  </div>
                  <div className="shrink-0 px-2" style={{ width: COLUMNS[5].width }}>
                    <StateBadge state={it.state} />
                  </div>
                </div>
              ))}

            {!isLoading && pageRows.length === 0 && (
              <div className="h-40 flex items-center justify-center text-[12px]" style={{ color: BRAND.textMuted }}>
                No iterations found
              </div>
            )}
          </div>
        </div>

        {/* Pagination */}
        <div className="h-10 shrink-0 flex items-center justify-between px-3" style={{ backgroundColor: BRAND.surface, borderTop: `1px solid ${BRAND.borderSubtle}` }}>
          <span className="text-[11px]" style={{ color: BRAND.textMuted }}>
            {filtered.length === 0
              ? '0 records'
              : `${(activePage - 1) * PAGE_SIZE + 1}-${Math.min(activePage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums" style={{ color: BRAND.textSecondary }}>
              Page {activePage} of {totalPages}
            </span>
            <button aria-label="Previous page" disabled={activePage === 1} onClick={() => setPage(activePage - 1)} className="p-1.5 rounded disabled:opacity-35" style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }}>
              <ChevronLeft size={13} />
            </button>
            <button aria-label="Next page" disabled={activePage === totalPages} onClick={() => setPage(activePage + 1)} className="p-1.5 rounded disabled:opacity-35" style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }}>
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

// ── Quick-create modal ──────────────────────────────────────────────────────

function CreateIterationModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { team } = useAppContext()
  const { data: teams = [] } = useProjectTeams(projectId)
  const create = useCreateIteration()
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState<string>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [state, setState] = useState<IterationState>('planning')
  const [error, setError] = useState<string | null>(null)

  const selectCls =
    'w-full rounded border border-input bg-white px-3 py-2 text-[12px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

  async function submit(openDetail: boolean) {
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!startDate) {
      setError('Start Date is required')
      return
    }
    if (!endDate) {
      setError('End Date is required')
      return
    }
    try {
      const it = await create.mutateAsync({
        projectId,
        name: name.trim(),
        teamId: teamId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        state,
      })
      if (openDetail) onCreated(it.id)
      else onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create iteration')
    }
  }

  return (
    <AppModal open onClose={onClose} title="New Iteration" width={480}>
      <ModalBody className="space-y-4">
        <FormField label="Name" required error={error ?? undefined}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter iteration name..." />
        </FormField>
        <FormField label="Team">
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={selectCls}>
            <option value="">{team ? `Context: ${team}` : 'No team'}</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Start Date" required>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <FormField label="End Date" required>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </FormField>
        </div>
        <FormField label="State" required>
          <select value={state} onChange={(e) => setState(e.target.value as IterationState)} className={selectCls}>
            <option value="planning">Planning</option>
            <option value="committed">Committed</option>
            <option value="accepted">Accepted</option>
          </select>
        </FormField>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[#f0f2f5]"
          style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => submit(true)}
          className="rounded px-4 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ border: '1px solid #9fb5d5', color: BRAND.primary, backgroundColor: '#f5f8fc' }}
        >
          Create with details
        </button>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => submit(false)}
          className="flex items-center gap-1.5 rounded px-4 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: BRAND.primary }}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          Create Iteration
        </button>
      </ModalFooter>
    </AppModal>
  )
}

// ── Full-page detail ──────────────────────────────────────────────────────────

function IterationDetail({ id, canManage, onBack }: { id: string; canManage: boolean; onBack: () => void }) {
  const { project } = useAppContext()
  const { data: it, isLoading } = useIteration(id)
  const update = useUpdateIteration(id)
  const { data: teams = [] } = useProjectTeams(it?.projectId)
  const teamName = teams.find((t) => t.id === it?.teamId)?.name ?? null
  const [theme, setTheme] = useState<string | null>(null)
  const [notes, setNotes] = useState<string | null>(null)

  const themeVal = theme ?? it?.theme ?? ''
  const notesVal = notes ?? it?.notes ?? ''
  const disabled = !canManage

  const selectCls =
    'w-full rounded border border-input bg-white px-3 py-2 text-[12px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
  const readonlyCls =
    'w-full rounded border border-input bg-input-background px-3 py-2 text-[12px] text-foreground'

  function patch(body: Parameters<typeof update.mutateAsync>[0]) {
    void update.mutateAsync(body)
  }

  if (isLoading || !it) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px]" style={{ color: BRAND.textMuted }}>
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-white">
      <div className="shrink-0 text-white" style={{ backgroundColor: '#173f78' }}>
        <div className="h-12 px-4 flex items-center gap-3">
          <button aria-label="Back" onClick={onBack} className="p-1.5 rounded hover:bg-white/10">
            <ChevronLeft size={18} />
          </button>
          <span className="px-1.5 py-px text-[10px] font-semibold rounded-sm" style={{ backgroundColor: '#eef3fb', color: '#1d3f73' }}>
            Iteration
          </span>
          <span className="font-mono text-[13px] font-semibold">{it.iterationKey ?? 'New'}</span>
          <span className="h-5 w-px bg-white/25" />
          <h1 className="text-[15px] font-semibold truncate">{it.name}</h1>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 gap-2" style={{ backgroundColor: '#e7ebf0' }}>
        <main className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#f3f5f8' }}>
          <div className="space-y-5">
            <h2 className="text-[18px] font-semibold" style={{ color: '#273449' }}>
              Details
            </h2>
            <section className="bg-white rounded overflow-hidden" style={{ border: `1px solid ${BRAND.borderSubtle}` }}>
              <div className="px-4 py-2 text-[11px] font-semibold" style={{ color: BRAND.textSecondary, backgroundColor: BRAND.surfaceSubtle, borderBottom: `1px solid ${BRAND.borderSubtle}` }}>
                Theme
              </div>
              <textarea
                value={themeVal}
                disabled={disabled}
                onChange={(e) => setTheme(e.target.value)}
                onBlur={() => theme !== null && patch({ theme })}
                placeholder="Describe the iteration goal, scope, and planning context..."
                className="block w-full resize-none px-4 py-3 text-[13px] leading-6 focus:outline-none"
                style={{ minHeight: 200, color: BRAND.textPrimary }}
              />
            </section>
            <section className="bg-white rounded overflow-hidden" style={{ border: `1px solid ${BRAND.borderSubtle}` }}>
              <div className="px-4 py-2 text-[11px] font-semibold" style={{ color: BRAND.textSecondary, backgroundColor: BRAND.surfaceSubtle, borderBottom: `1px solid ${BRAND.borderSubtle}` }}>
                Notes
              </div>
              <textarea
                value={notesVal}
                disabled={disabled}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== null && patch({ notes })}
                placeholder="Capture team notes, risks, carry-over context, or planning decisions..."
                className="block w-full resize-none px-4 py-3 text-[13px] leading-6 focus:outline-none"
                style={{ minHeight: 160, color: BRAND.textPrimary }}
              />
            </section>
          </div>
        </main>

        <aside className="w-[320px] shrink-0 overflow-y-auto p-5 space-y-4 bg-white" style={{ borderLeft: `1px solid ${BRAND.borderSubtle}` }}>
          <FormField label="Project">
            <div className={readonlyCls}>{project?.projectName ?? '—'}</div>
          </FormField>
          <FormField label="Team">
            <div className={readonlyCls}>{teamName ?? 'No team'}</div>
          </FormField>
          <FormField label="Start Date">
            <Input
              type="date"
              defaultValue={it.startDate ?? ''}
              disabled={disabled}
              onBlur={(e) => patch({ startDate: e.target.value || null })}
            />
          </FormField>
          <FormField label="End Date">
            <Input
              type="date"
              defaultValue={it.endDate ?? ''}
              disabled={disabled}
              onBlur={(e) => patch({ endDate: e.target.value || null })}
            />
          </FormField>
          <FormField label="State">
            <select
              defaultValue={it.state}
              disabled={disabled}
              onChange={(e) => patch({ state: e.target.value as IterationState })}
              className={selectCls}
            >
              <option value="planning">Planning</option>
              <option value="committed">Committed</option>
              <option value="accepted">Accepted</option>
            </select>
          </FormField>
          <FormField label="Planned Velocity">
            <Input
              type="number"
              min={0}
              defaultValue={it.plannedVelocity ?? ''}
              disabled={disabled}
              onBlur={(e) => patch({ plannedVelocity: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="0"
            />
          </FormField>
        </aside>
      </div>
    </div>
  )
}

// (Field removed — use shared <FormField> from @/shared/ui/form-field instead)
