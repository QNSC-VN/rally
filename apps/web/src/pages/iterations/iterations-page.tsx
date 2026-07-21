/**
 * Timeboxes › Iterations — P2.2 Iteration Management
 *
 * Lists iterations for the active project/team with search, state filter, sort
 * and pagination; a quick-create modal; and a full-page detail (Theme/Notes +
 * right panel). State maps DB planning/committed/accepted ↔ UI Planning/Committed/Accepted.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
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
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useProjectTeams, useProjectMembers } from '@/features/teams/api'
import { useProjects } from '@/features/projects/api'
import { TypeBadge, ScheduleStateBadge } from '@/entities/work-item/ui/badges'
import { StatusBadge } from '@/shared/ui/status-badge'
import { TeamCell } from '@/shared/ui/team-cell'
import { ITERATION_STATE_STYLE } from '@/features/iterations/status-colors'
import {
  useIterations,
  useIteration,
  useIterationStatus,
  useCreateIteration,
  useUpdateIteration,
  useCommitIteration,
  useAcceptIteration,
  useRolloverIteration,
  type IterationState,
  type Iteration,
  type IterationStatus,
  type IterationStatusItem,
} from '@/features/iterations/api'

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
                    <StatusBadge style={ITERATION_STATE_STYLE[it.state]} />
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
  const { workspace, team } = useAppContext()
  const workspaceId = workspace?.workspaceId ?? ''
  // Project auto-fills from context (P2-IT-FR-001C) but an admin may override it
  // (FR-001D); Team then filters by the SELECTED project and must be valid for it.
  const [selectedProjectId, setSelectedProjectId] = useState(projectId)
  const { data: projects = [] } = useProjects(workspaceId || undefined)
  const { data: teams = [] } = useProjectTeams(selectedProjectId)
  const create = useCreateIteration()
  const [name, setName] = useState('')
  // Auto-fill from the Team selected in the workspace context (falls back to "No team")
  const [teamId, setTeamId] = useState<string>(team?.teamId ?? '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [state, setState] = useState<IterationState>('planning')
  const [error, setError] = useState<string | null>(null)

  // A pre-filled/inherited team that isn't linked to the selected project is
  // treated as unset so the create can't be rejected with
  // PROJECT_TEAM_LINK_NOT_FOUND (FR-001D). Derived — no effect needed.
  const validTeamId = teams.some((t) => t.id === teamId) ? teamId : ''

  function handleProjectChange(nextProjectId: string) {
    if (nextProjectId === selectedProjectId) return
    setSelectedProjectId(nextProjectId)
    setTeamId('')
  }

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
        projectId: selectedProjectId,
        name: name.trim(),
        teamId: validTeamId || undefined,
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
        {/* Type — Phase 2 shows Iterations only, so the control is fixed (P2-IT-FR-003/011). */}
        <FormField label="Type">
          <NativeSelect value="iteration" disabled>
            <option value="iteration">Iteration</option>
          </NativeSelect>
        </FormField>
        {/* Project — auto-filled from context, overridable by admin (P2-IT-FR-001C/D). */}
        <FormField label="Project" required>
          <NativeSelect
            value={selectedProjectId}
            onChange={(e) => handleProjectChange(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Team">
          <NativeSelect value={validTeamId} onChange={(e) => setTeamId(e.target.value)}>
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
  const team = teams.find((t) => t.id === it?.teamId) ?? null
  const teamName = team?.name ?? null
  const disabled = !canManage
  const readonlyCls =
    'w-full rounded border border-input bg-input-background px-3 py-2 text-[12px] text-foreground'

  function patch(body: Parameters<typeof update.mutateAsync>[0]) {
    void update.mutateAsync(body)
  }

  // Timebox scope + capacity read-model (shared with Iteration Status) and the
  // gated lifecycle actions (Commit / Accept / Rollover).
  const navigate = useNavigate()
  const { data: status } = useIterationStatus(id)
  const { data: members = [] } = useProjectMembers(it?.projectId)
  const { data: allIterations = [] } = useIterations(it?.projectId)
  const commit = useCommitIteration(id)
  const accept = useAcceptIteration(id)
  const [showRollover, setShowRollover] = useState(false)

  const memberName = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of members) if (p.displayName) m.set(p.userId, p.displayName)
    return m
  }, [members])

  async function handleCommit() {
    try {
      await commit.mutateAsync()
      toast.success('Iteration committed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to commit iteration')
    }
  }
  async function handleAccept() {
    try {
      await accept.mutateAsync()
      toast.success('Iteration accepted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to accept iteration')
    }
  }

  if (isLoading || !it) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const scopeItems = status?.items ?? []
  const unfinishedCount = scopeItems.filter(
    (i) =>
      (i.type === 'story' || i.type === 'defect') &&
      i.scheduleState !== 'accepted' &&
      i.scheduleState !== 'release',
  ).length

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
          <div className="ml-auto">
            <StatusBadge style={ITERATION_STATE_STYLE[it.state]} />
          </div>
        </div>
      </div>

      {canManage && it.state !== 'accepted' && (
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-2"
          style={{
            backgroundColor: BRAND.surface,
            borderBottom: `1px solid ${BRAND.borderSubtle}`,
          }}
        >
          <span className="text-[12px]" style={{ color: BRAND.textSecondary }}>
            {it.state === 'planning'
              ? 'Shape the scope, then commit to start the iteration.'
              : `${unfinishedCount} unfinished item${unfinishedCount === 1 ? '' : 's'} · all assigned items must be accepted to close.`}
          </span>
          <div className="flex items-center gap-2">
            {it.state === 'committed' && (
              <Button
                size="sm"
                variant="outline"
                disabled={unfinishedCount === 0}
                onClick={() => setShowRollover(true)}
              >
                Move Unfinished
              </Button>
            )}
            {it.state === 'planning' ? (
              <Button size="sm" disabled={commit.isPending} onClick={handleCommit}>
                {commit.isPending && <Loader2 size={11} className="animate-spin" />} Commit
                Iteration
              </Button>
            ) : (
              <Button size="sm" disabled={accept.isPending} onClick={handleAccept}>
                {accept.isPending && <Loader2 size={11} className="animate-spin" />} Accept
                Iteration
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2" style={{ backgroundColor: BRAND.avatarBg }}>
        <main
          className="flex-1 overflow-y-auto p-6"
          style={{ backgroundColor: BRAND.surfaceSubtle }}
        >
          <div className="space-y-5">
            <CapacityStrip metrics={status?.metrics} scopeCount={scopeItems.length} />
            <IterationScope
              items={scopeItems}
              memberName={memberName}
              onOpen={(itemKey) => navigate({ to: '/item/$itemKey', params: { itemKey } })}
            />
            <h2 className="text-[18px] font-semibold" style={{ color: BRAND.textPrimary }}>
              Details
            </h2>
            <RichTextEditor
              title="Theme"
              value={it?.theme}
              minHeight={200}
              readOnly={disabled}
              onSave={(html) => patch({ theme: html || null })}
            />
            <RichTextEditor
              title="Notes"
              value={it?.notes}
              minHeight={160}
              readOnly={disabled}
              onSave={(html) => patch({ notes: html || null })}
            />
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
            {teamName ? (
              <div className={readonlyCls}>
                <TeamCell teamKey={team?.key} name={teamName} />
              </div>
            ) : (
              <div className={readonlyCls}>No team</div>
            )}
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
            <div className="flex h-9 items-center rounded border border-input bg-input-background px-3">
              <StatusBadge style={ITERATION_STATE_STYLE[it.state]} />
            </div>
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

      {showRollover && (
        <RolloverModal
          iterationId={id}
          iterations={allIterations}
          unfinishedCount={unfinishedCount}
          onClose={() => setShowRollover(false)}
        />
      )}
    </div>
  )
}

// ── Capacity strip ────────────────────────────────────────────────────────────

function CapacityStrip({
  metrics,
  scopeCount,
}: {
  metrics: IterationStatus['metrics'] | undefined
  scopeCount: number
}) {
  const committed = metrics?.totalPlanEstimate ?? 0
  const capacity = metrics?.plannedVelocity ?? 0
  const capacityPct = capacity > 0 ? Math.round((committed / capacity) * 100) : 0
  const tiles: Array<{ label: string; value: string; caption?: string }> = [
    { label: 'Planned Velocity', value: `${capacity} pts` },
    {
      label: 'Committed',
      value: `${committed} pts`,
      caption: capacity > 0 ? `${capacityPct}% of capacity` : undefined,
    },
    {
      label: 'Accepted',
      value: `${metrics?.acceptedPoints ?? 0} pts`,
      caption: `${metrics?.acceptedPercent ?? 0}% of committed`,
    },
    { label: 'Days Left', value: metrics?.daysLeft != null ? String(metrics.daysLeft) : '—' },
    { label: 'Scope Items', value: String(scopeCount) },
    { label: 'Defects', value: String(metrics?.defectCount ?? 0) },
    { label: 'Tasks', value: String(metrics?.taskCount ?? 0) },
  ]
  return (
    <section>
      <h2 className="mb-2 text-[18px] font-semibold" style={{ color: BRAND.textPrimary }}>
        Capacity
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded bg-white px-3 py-2.5"
            style={{ border: `1px solid ${BRAND.borderSubtle}` }}
          >
            <div
              className="text-[10px] font-semibold tracking-wide uppercase"
              style={{ color: BRAND.textMuted }}
            >
              {t.label}
            </div>
            <div className="mt-1 text-[16px] font-semibold" style={{ color: BRAND.textPrimary }}>
              {t.value}
            </div>
            {t.caption && (
              <div className="text-[10px]" style={{ color: BRAND.textMuted }}>
                {t.caption}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Committed scope list ────────────────────────────────────────────────────────

function IterationScope({
  items,
  memberName,
  onOpen,
}: {
  items: IterationStatusItem[]
  memberName: Map<string, string>
  onOpen: (itemKey: string) => void
}) {
  return (
    <section>
      <h2 className="mb-2 text-[18px] font-semibold" style={{ color: BRAND.textPrimary }}>
        Scope{' '}
        <span className="text-[13px] font-normal" style={{ color: BRAND.textMuted }}>
          ({items.length})
        </span>
      </h2>
      <div
        className="overflow-hidden rounded bg-white"
        style={{ border: `1px solid ${BRAND.borderSubtle}` }}
      >
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px]" style={{ color: BRAND.textMuted }}>
            No work items assigned. Assign Stories or Defects from the Backlog.
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${BRAND.borderSubtle}`,
                  color: BRAND.textSecondary,
                }}
              >
                <th className="px-3 py-2 text-left font-semibold">Type</th>
                <th className="px-3 py-2 text-left font-semibold">ID</th>
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                <th className="px-3 py-2 text-left font-semibold">Schedule State</th>
                <th className="px-3 py-2 text-right font-semibold">Est.</th>
                <th className="px-3 py-2 text-left font-semibold">Owner</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={i.id}
                  onClick={() => onOpen(i.itemKey)}
                  className="cursor-pointer hover:bg-primary-lighter"
                  style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
                >
                  <td className="px-3 py-2">
                    <TypeBadge type={i.type} />
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: BRAND.primary }}>
                    {i.itemKey}
                  </td>
                  <td className="px-3 py-2" style={{ color: BRAND.textPrimary }}>
                    {i.title}
                  </td>
                  <td className="px-3 py-2">
                    <ScheduleStateBadge state={i.scheduleState} />
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    style={{ color: BRAND.textSecondary }}
                  >
                    {i.planEstimate ?? '—'}
                  </td>
                  <td className="px-3 py-2" style={{ color: BRAND.textSecondary }}>
                    {i.assigneeId ? (memberName.get(i.assigneeId) ?? '—') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

// ── Rollover modal (move unfinished items out) ──────────────────────────────────

function RolloverModal({
  iterationId,
  iterations,
  unfinishedCount,
  onClose,
}: {
  iterationId: string
  iterations: Iteration[]
  unfinishedCount: number
  onClose: () => void
}) {
  const rollover = useRolloverIteration(iterationId)
  const [target, setTarget] = useState('') // '' = backlog
  const targets = iterations.filter((it) => it.id !== iterationId && it.state !== 'accepted')

  async function submit() {
    try {
      const res = await rollover.mutateAsync({ moveToIterationId: target || undefined })
      toast.success(`Moved ${res.movedCount} item${res.movedCount === 1 ? '' : 's'}`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to move items')
    }
  }

  return (
    <AppModal open onClose={onClose} title="Move Unfinished Items" width={440}>
      <ModalBody className="space-y-4">
        <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
          {unfinishedCount} unfinished (not-accepted) Story/Defect item
          {unfinishedCount === 1 ? '' : 's'} will be moved out of this iteration.
        </p>
        <FormField label="Destination">
          <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Backlog (no iteration)</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={rollover.isPending} onClick={submit}>
          {rollover.isPending && <Loader2 size={11} className="animate-spin" />} Move Items
        </Button>
      </ModalFooter>
    </AppModal>
  )
}

// (Field removed — use shared <FormField> from @/shared/ui/form-field instead)
