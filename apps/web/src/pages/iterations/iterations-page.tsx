/**
 * Timeboxes › Iterations — P2.2 Iteration Management
 *
 * Lists iterations for the active project/team with search, state filter, sort
 * and pagination; a quick-create modal; and a full-page detail (Theme/Notes +
 * right panel). State maps DB planning/committed/accepted ↔ UI Planning/Committed/Accepted.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, Loader2, Plus } from 'lucide-react'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { Spinner } from '@/shared/ui/spinner'
import { SkeletonList } from '@/shared/ui/skeleton'
import { NativeSelect, InlineSelect } from '@/shared/ui/native-select'
import { BRAND } from '@/shared/config/brand'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
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
  planning: { bg: BRAND.primaryLighter, text: BRAND.primary, border: BRAND.accentBorder },
  committed: { bg: BRAND.warningBg, text: BRAND.warning, border: BRAND.warningBorder },
  accepted: { bg: BRAND.successBg, text: BRAND.success, border: BRAND.successBorder },
}

function StateBadge({ state }: { state: IterationState }) {
  const s = STATE_STYLE[state]
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-px text-[11px] font-medium whitespace-nowrap"
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
  const { can } = useProjectPermissions(projectId)
  const canManage = can('iteration:manage')

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
      <div
        className="flex flex-1 items-center justify-center text-[13px]"
        style={{ color: BRAND.textMuted }}
      >
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
            <div
              className="flex items-center gap-1.5 rounded px-2 py-1.5"
              style={{ backgroundColor: BRAND.surface, border: `1px solid ${BRAND.borderSubtle}` }}
            >
              <span className="text-[11px] font-semibold" style={{ color: BRAND.textSecondary }}>
                State
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
                className="cursor-pointer rounded px-2.5 py-1 text-[11px] hover:bg-primary-lighter"
                style={{ color: BRAND.primaryLight }}
              >
                Clear filters
              </button>
            )}
          </>
        }
      />

      {/* Table */}
      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: BRAND.surface }}
      >
        <div className="flex-1 overflow-auto">
          <div style={{ width: tableWidth, minWidth: '100%' }}>
            <div
              className="sticky top-0 z-10 flex h-8 items-center px-3 select-none"
              style={{
                backgroundColor: BRAND.surfaceHover,
                borderBottom: `1px solid ${BRAND.borderSubtle}`,
              }}
            >
              <div className="w-16 shrink-0" />
              {COLUMNS.map((c) => {
                const active = sort.key === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className="flex h-full items-center gap-1 px-2 text-[11px] font-semibold"
                    style={{
                      width: c.width,
                      color: active ? BRAND.primary : BRAND.textMuted,
                      borderRight: `1px solid ${BRAND.borderSubtle}`,
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
              <div
                className="flex h-40 items-center justify-center text-[12px]"
                style={{ color: BRAND.danger }}
              >
                Failed to load iterations. Please try again.
              </div>
            )}

            {!isLoading &&
              !isError &&
              pageRows.map((it) => (
                <div
                  key={it.id}
                  onClick={() => setDetailId(it.id)}
                  className="flex h-8 cursor-pointer items-center px-3 transition-colors hover:bg-surface-subtle"
                  style={{
                    width: tableWidth,
                    minWidth: '100%',
                    borderBottom: `1px solid ${BRAND.borderInner}`,
                  }}
                >
                  <div
                    className="w-16 shrink-0 truncate px-2 font-mono text-[10px]"
                    style={{ color: BRAND.textMuted }}
                    title={it.iterationKey ?? ''}
                  >
                    {it.iterationKey ?? ''}
                  </div>
                  <div
                    className="shrink-0 truncate px-2 text-[11px] font-medium"
                    style={{ width: COLUMNS[0].width, color: BRAND.textPrimary }}
                    title={it.name}
                  >
                    {it.name}
                  </div>
                  <div
                    className="shrink-0 truncate px-2 text-[11px]"
                    style={{ width: COLUMNS[1].width, color: BRAND.textPrimary }}
                  >
                    {it.theme ?? ''}
                  </div>
                  <div
                    className="shrink-0 truncate px-2 text-[11px]"
                    style={{ width: COLUMNS[2].width, color: BRAND.textSecondary }}
                  >
                    {it.startDate ?? ''}
                  </div>
                  <div
                    className="shrink-0 truncate px-2 text-[11px]"
                    style={{ width: COLUMNS[3].width, color: BRAND.textSecondary }}
                  >
                    {it.endDate ?? ''}
                  </div>
                  <div
                    className="shrink-0 px-2 text-right font-mono text-[11px] tabular-nums"
                    style={{ width: COLUMNS[4].width, color: BRAND.textSecondary }}
                  >
                    {it.plannedVelocity ?? ''}
                  </div>
                  <div className="shrink-0 px-2" style={{ width: COLUMNS[5].width }}>
                    <StateBadge state={it.state} />
                  </div>
                </div>
              ))}

            {!isLoading && !isError && pageRows.length === 0 && (
              <div
                className="flex h-40 items-center justify-center text-[12px]"
                style={{ color: BRAND.textMuted }}
              >
                No iterations found
              </div>
            )}
          </div>
        </div>

        {/* Pagination */}
        <div
          className="flex h-10 shrink-0 items-center justify-between px-3"
          style={{ backgroundColor: BRAND.surface, borderTop: `1px solid ${BRAND.borderSubtle}` }}
        >
          <span className="text-[11px]" style={{ color: BRAND.textMuted }}>
            {filtered.length === 0
              ? '0 records'
              : `${(activePage - 1) * PAGE_SIZE + 1}-${Math.min(activePage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums" style={{ color: BRAND.textSecondary }}>
              Page {activePage} of {totalPages}
            </span>
            <button
              aria-label="Previous page"
              disabled={activePage === 1}
              onClick={() => setPage(activePage - 1)}
              className="cursor-pointer rounded p-1.5 transition-colors hover:bg-primary-lighter disabled:cursor-not-allowed disabled:opacity-35"
              style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              aria-label="Next page"
              disabled={activePage === totalPages}
              onClick={() => setPage(activePage + 1)}
              className="cursor-pointer rounded p-1.5 transition-colors hover:bg-primary-lighter disabled:cursor-not-allowed disabled:opacity-35"
              style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textSecondary }}
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
  // Auto-fill from the Team selected in the workspace context (falls back to "No team")
  const [teamId, setTeamId] = useState<string>(team?.teamId ?? '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [state, setState] = useState<IterationState>('planning')
  const [error, setError] = useState<string | null>(null)

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
      toast.success(`Iteration "${it.name}" created`)
      if (openDetail) onCreated(it.id)
      else onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create iteration'
      setError(msg)
      toast.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title="New Iteration" width={480}>
      <ModalBody className="space-y-4">
        <FormField label="Name" required error={error ?? undefined}>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter iteration name..."
          />
        </FormField>
        <FormField label="Team">
          <NativeSelect value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
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
          <NativeSelect value={state} onChange={(e) => setState(e.target.value as IterationState)}>
            <option value="planning">Planning</option>
            <option value="committed">Committed</option>
            <option value="accepted">Accepted</option>
          </NativeSelect>
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={create.isPending}
          onClick={() => submit(true)}
        >
          Create with details
        </Button>
        <Button type="button" disabled={create.isPending} onClick={() => submit(false)}>
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          Create Iteration
        </Button>
      </ModalFooter>
    </AppModal>
  )
}

// ── Full-page detail ──────────────────────────────────────────────────────────

function IterationDetail({
  id,
  canManage,
  onBack,
}: {
  id: string
  canManage: boolean
  onBack: () => void
}) {
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
  const readonlyCls =
    'w-full rounded border border-input bg-input-background px-3 py-2 text-[12px] text-foreground'

  function patch(body: Parameters<typeof update.mutateAsync>[0]) {
    void update.mutateAsync(body)
  }

  if (isLoading || !it) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white">
      <div className="shrink-0 text-white" style={{ backgroundColor: BRAND.primaryDark }}>
        <div className="flex h-12 items-center gap-3 px-4">
          <button aria-label="Back" onClick={onBack} className="rounded p-1.5 hover:bg-white/10">
            <ChevronLeft size={18} />
          </button>
          <span
            className="rounded-sm px-1.5 py-px text-[10px] font-semibold"
            style={{ backgroundColor: BRAND.primaryLighter, color: BRAND.primary }}
          >
            Iteration
          </span>
          <span className="font-mono text-[13px] font-semibold">{it.iterationKey ?? 'New'}</span>
          <span className="h-5 w-px bg-white/25" />
          <h1 className="truncate text-[15px] font-semibold">{it.name}</h1>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2" style={{ backgroundColor: BRAND.avatarBg }}>
        <main
          className="flex-1 overflow-y-auto p-6"
          style={{ backgroundColor: BRAND.surfaceSubtle }}
        >
          <div className="space-y-5">
            <h2 className="text-[18px] font-semibold" style={{ color: BRAND.textPrimary }}>
              Details
            </h2>
            <section
              className="overflow-hidden rounded bg-white"
              style={{ border: `1px solid ${BRAND.borderSubtle}` }}
            >
              <div
                className="px-4 py-2 text-[11px] font-semibold"
                style={{
                  color: BRAND.textSecondary,
                  backgroundColor: BRAND.surfaceSubtle,
                  borderBottom: `1px solid ${BRAND.borderSubtle}`,
                }}
              >
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
            <section
              className="overflow-hidden rounded bg-white"
              style={{ border: `1px solid ${BRAND.borderSubtle}` }}
            >
              <div
                className="px-4 py-2 text-[11px] font-semibold"
                style={{
                  color: BRAND.textSecondary,
                  backgroundColor: BRAND.surfaceSubtle,
                  borderBottom: `1px solid ${BRAND.borderSubtle}`,
                }}
              >
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

        <aside
          className="w-[320px] shrink-0 space-y-4 overflow-y-auto bg-white p-5"
          style={{ borderLeft: `1px solid ${BRAND.borderSubtle}` }}
        >
          <FormField label="Project">
            <div className={readonlyCls}>{project?.projectName ?? '—'}</div>
          </FormField>
          <FormField label="Team">
            <div className={readonlyCls}>{teamName ?? 'No team'}</div>
          </FormField>
          <FormField label="Start Date">
            <Input
              type="date"
              value={it.startDate ?? ''}
              disabled={disabled}
              onBlur={(e) => patch({ startDate: e.target.value || null })}
            />
          </FormField>
          <FormField label="End Date">
            <Input
              type="date"
              value={it.endDate ?? ''}
              disabled={disabled}
              onBlur={(e) => patch({ endDate: e.target.value || null })}
            />
          </FormField>
          <FormField label="State">
            <NativeSelect
              value={it.state}
              disabled={disabled}
              onChange={(e) => patch({ state: e.target.value as IterationState })}
            >
              <option value="planning">Planning</option>
              <option value="committed">Committed</option>
              <option value="accepted">Accepted</option>
            </NativeSelect>
          </FormField>
          <FormField label="Planned Velocity">
            <Input
              type="number"
              min={0}
              defaultValue={it.plannedVelocity ?? ''}
              disabled={disabled}
              onBlur={(e) =>
                patch({ plannedVelocity: e.target.value === '' ? null : Number(e.target.value) })
              }
              placeholder="0"
            />
          </FormField>
        </aside>
      </div>
    </div>
  )
}

// (Field removed — use shared <FormField> from @/shared/ui/form-field instead)
