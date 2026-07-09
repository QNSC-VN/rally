/**
 * Releases — P3.2 Release Management
 *
 * Dense dashboard with inline-editable rows. Status values: Planning, Active, Accepted.
 * Create modal locks Type = Release. Columns: Name, Theme, Start Date, Release Date,
 * Project, Planned Velocity, Task Estimate, State.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Plus, Search, Trash2, X, PackageOpen, Pencil, ExternalLink } from 'lucide-react'
import { SkeletonList } from '@/shared/ui/skeleton'
import { InlineSelect } from '@/shared/ui/native-select'
import { BRAND } from '@/shared/config/brand'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import {
  useReleases,
  useCreateRelease,
  useUpdateRelease,
  useDeleteRelease,
  type Release,
  type ReleaseStatus,
} from '@/features/releases/api'

const RELEASE_STATES: ReleaseStatus[] = ['planning', 'active', 'accepted']

const STATUS_STYLE: Record<ReleaseStatus, { bg: string; text: string; border: string; label: string }> = {
  planning: { bg: '#eef3fb', text: '#1d3f73', border: '#bdd0ef', label: 'Planning' },
  active: { bg: '#fff7ed', text: '#92400e', border: '#fed7aa', label: 'Active' },
  accepted: { bg: '#eaf5ed', text: '#1e6930', border: '#b9dec2', label: 'Accepted' },
}

function StatusBadge({ status }: { status: ReleaseStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.planning
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-px text-[11px] font-medium whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  )
}

// ── Create modal (P3-REL-FR-011/012: Type locked to Release) ─────────────

function CreateReleaseModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [state, setState] = useState<ReleaseStatus>('planning')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateRelease()

  async function submit() {
    setError(null)
    if (!name.trim()) {
      setError('Release name is required')
      return
    }
    if (startDate && releaseDate && releaseDate < startDate) {
      setError('Release date must be >= start date')
      return
    }
    try {
      await create.mutateAsync({
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        startDate: startDate || undefined,
        releaseDate: releaseDate || undefined,
        state,
      })
      toast.success(`Release "${name.trim()}" created`)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create release'
      setError(msg)
      toast.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title="Create Release" subtitle="Type: Release (locked)" width={460}>
      <ModalBody className="space-y-4">
        {/* Type selector — disabled, locked to Release (P3-REL-FR-012) */}
        <FormField label="Type">
          <div className="flex gap-2">
            {(['Iteration', 'Release', 'Milestones'] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={t !== 'Release'}
                className="flex-1 py-1.5 text-[11px] font-semibold rounded-sm transition-colors"
                style={{
                  backgroundColor: t === 'Release' ? '#eef3fb' : 'transparent',
                  color: t === 'Release' ? BRAND.primary : BRAND.textMuted,
                  border: `1px solid ${t === 'Release' ? '#bdd0ef' : BRAND.borderSubtle}`,
                  opacity: t === 'Release' ? 1 : 0.4,
                  cursor: t === 'Release' ? 'default' : 'not-allowed',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label="Release name" required error={error ?? undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="v1.2.0 — Q3 Feature Drop" autoFocus />
        </FormField>

        <div className="flex gap-3">
          <FormField label="Start Date" className="flex-1">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <FormField label="Release Date" className="flex-1">
            <Input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
          </FormField>
        </div>

        <FormField label="State">
          <InlineSelect
            value={state}
            onChange={(e) => setState(e.target.value as ReleaseStatus)}
            className="w-full text-[11px] px-2 py-1.5 rounded bg-white focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
          >
            {RELEASE_STATES.map((s) => (
              <option key={s} value={s}>{STATUS_STYLE[s].label}</option>
            ))}
          </InlineSelect>
        </FormField>

        <FormField label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What ships in this release?" rows={3} />
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
          disabled={create.isPending || !name.trim()}
          onClick={() => {
            void submit()
          }}
          className="rounded px-4 py-1.5 text-[11px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ border: '1px solid #9fb5d5', color: BRAND.primary, backgroundColor: '#f5f8fc' }}
        >
          Create with details
        </button>
        <button
          type="button"
          disabled={create.isPending || !name.trim()}
          onClick={() => {
            void submit()
          }}
          className="flex items-center gap-1.5 rounded px-4 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: BRAND.primary }}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          Create Release
        </button>
      </ModalFooter>
    </AppModal>
  )
}

// ── Edit modal (Release Detail) ──────────────────────────────────────────

function ReleaseDetailModal({ release, projectId, onClose }: { release: Release; projectId: string; onClose: () => void }) {
  const [name, setName] = useState(release.name)
  const [theme, setTheme] = useState(release.theme ?? '')
  const [notes, setNotes] = useState(release.notes ?? '')
  const [startDate, setStartDate] = useState(release.startDate ?? '')
  const [releaseDate, setReleaseDate] = useState(release.releaseDate ?? '')
  const [plannedVelocity, setPlannedVelocity] = useState(release.plannedVelocity == null ? '' : String(release.plannedVelocity))
  const [planEstimate, setPlanEstimate] = useState(release.planEstimate == null ? '' : String(release.planEstimate))
  const [version, setVersion] = useState(release.version ?? '')
  const [state, setState] = useState<ReleaseStatus>(release.status)
  const update = useUpdateRelease(release.id, projectId)

  async function handleSubmit() {
    if (!name.trim()) return
    try {
      await update.mutateAsync({
        name: name.trim(),
        theme: theme.trim() || null,
        notes: notes.trim() || null,
        startDate: startDate || null,
        releaseDate: releaseDate || null,
        plannedVelocity: plannedVelocity ? Number(plannedVelocity) : null,
        planEstimate: planEstimate ? Number(planEstimate) : null,
        version: version.trim() || null,
        state,
      })
      toast.success('Release updated')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update release')
    }
  }

  return (
    <AppModal open onClose={onClose} title={release.name} subtitle="Release Detail" width={560}>
      <ModalBody className="space-y-4">
        {/* Left panel fields: Theme, Notes */}
        <FormField label="Theme">
          <Textarea value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Release theme or goal..." rows={3} />
        </FormField>

        <FormField label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." rows={3} />
        </FormField>

        {/* Right panel fields */}
        <FormField label="Release name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>

        <div className="flex gap-3">
          <FormField label="Start Date" className="flex-1">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <FormField label="Release Date" className="flex-1">
            <Input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
          </FormField>
        </div>

        <FormField label="State">
          <InlineSelect
            value={state}
            onChange={(e) => setState(e.target.value as ReleaseStatus)}
            className="w-full text-[11px] px-2 py-1.5 rounded bg-white focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
          >
            {RELEASE_STATES.map((s) => (
              <option key={s} value={s}>{STATUS_STYLE[s].label}</option>
            ))}
          </InlineSelect>
        </FormField>

        <div className="flex gap-3">
          <FormField label="Planned Velocity" className="flex-1">
            <Input type="number" min={0} value={plannedVelocity} onChange={(e) => setPlannedVelocity(e.target.value)} placeholder="0" />
          </FormField>
          <FormField label="Plan Estimate" className="flex-1">
            <Input type="number" min={0} value={planEstimate} onChange={(e) => setPlanEstimate(e.target.value)} placeholder="0" />
          </FormField>
        </div>

        <FormField label="Version" hint="Optional">
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
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
          disabled={update.isPending || !name.trim()}
          onClick={() => { void handleSubmit() }}
          className="flex items-center gap-1.5 rounded px-4 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: BRAND.primary }}
        >
          {update.isPending && <Loader2 size={11} className="animate-spin" />}
          Save
        </button>
      </ModalFooter>
    </AppModal>
  )
}

// ── Inline editable row ───────────────────────────────────────────────────

function ReleaseRow({
  release,
  projectId,
  canManage,
  onEdit,
  onDelete,
}: {
  release: Release
  projectId: string
  canManage: boolean
  onEdit: (r: Release) => void
  onDelete: (id: string) => void
}) {
  const update = useUpdateRelease(release.id, projectId)
  const status = release.status as ReleaseStatus

  function handleStateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newState = e.target.value as ReleaseStatus
    update.mutate(
      { state: newState },
      {
        onSuccess: () => toast.success(`Status updated to ${STATUS_STYLE[newState].label}`),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function handleNameBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    if (val && val !== release.name) {
      update.mutate(
        { name: val },
        {
          onSuccess: () => toast.success('Name updated'),
          onError: (err) => toast.error(err.message),
        },
      )
    }
  }

  return (
    <div
      className="group flex items-center h-8 px-3 text-[11px] hover:bg-[#f9fafb]"
      style={{ borderBottom: `1px solid ${BRAND.borderInner}` }}
    >
      {/* Name — inline editable (P3-REL-FR-005) */}
      <div className="flex-1 min-w-[200px] pr-2">
        {canManage ? (
          <input
            key={release.name}
            defaultValue={release.name}
            onBlur={handleNameBlur}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full text-[11px] font-semibold bg-transparent focus:outline-none focus:bg-white focus:ring-1 px-0.5 rounded"
            style={{ color: BRAND.textPrimary, border: 'none' }}
          />
        ) : (
          <span className="font-semibold truncate block" style={{ color: BRAND.textPrimary }}>
            {release.name}
          </span>
        )}
      </div>

      {/* Theme (P3-REL-FR-005) */}
      <div className="w-40 shrink-0 truncate" style={{ color: BRAND.textSecondary }} title={release.theme ?? ''}>
        {release.theme || '—'}
      </div>

      {/* Start Date */}
      <div className="w-28 shrink-0" style={{ color: BRAND.textSecondary }}>
        {release.startDate ?? '—'}
      </div>

      {/* Release Date */}
      <div className="w-28 shrink-0" style={{ color: BRAND.textSecondary }}>
        {release.releaseDate ?? '—'}
      </div>

      {/* Planned Velocity */}
      <div className="w-20 shrink-0 text-right font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
        {release.plannedVelocity ?? '—'}
      </div>

      {/* Task Estimate */}
      <div className="w-16 shrink-0 text-right font-mono tabular-nums" style={{ color: BRAND.textSecondary }}>
        {release.planEstimate ?? '—'}
      </div>

      {/* State (P3-REL-FR-008) */}
      <div className="w-28 shrink-0" onClick={(e) => e.stopPropagation()}>
        {canManage ? (
          <InlineSelect
            value={status}
            onChange={handleStateChange}
            className="text-[11px] px-1 py-0.5 rounded bg-white focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
          >
            {RELEASE_STATES.map((s) => (
              <option key={s} value={s}>{STATUS_STYLE[s].label}</option>
            ))}
          </InlineSelect>
        ) : (
          <StatusBadge status={status} />
        )}
      </div>

      {/* Actions */}
      {canManage && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 ml-1">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(release) }}
            title="Open detail"
            className="rounded p-1 transition-colors hover:bg-gray-100"
            style={{ color: BRAND.textMuted }}
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(release) }}
            title="Detail"
            className="rounded p-1 transition-colors hover:bg-gray-100"
            style={{ color: BRAND.textMuted }}
          >
            <ExternalLink size={12} />
          </button>
          {status !== 'accepted' && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(release.id) }}
              title="Delete release"
              className="rounded p-1 transition-colors hover:bg-red-50"
              style={{ color: BRAND.textMuted }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export function ReleasesPage() {
  const { project } = useAppContext()
  const projectId = project?.projectId
  const canManage = useAuthStore((s) => s.hasPermission('release:manage'))

  const { data: releases = [], isLoading, isError } = useReleases(projectId)
  const deleteRelease = useDeleteRelease(projectId ?? '')

  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingRelease, setEditingRelease] = useState<Release | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return releases
    const q = search.toLowerCase()
    return releases.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.theme ?? '').toLowerCase().includes(q),
    )
  }, [releases, search])

  async function handleDelete(id: string) {
    if (!confirm('Delete this release? Work items will keep their release assignment.')) return
    try {
      await deleteRelease.mutateAsync(id)
      toast.success('Release deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete release')
    }
  }

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ backgroundColor: BRAND.pageBg }}>
        <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
          Select a project to view releases.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: BRAND.pageBg }}>
      {/* Header */}
      <div
        className="flex h-12 shrink-0 items-center justify-between gap-4 px-4"
        style={{ borderBottom: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
      >
        <h1 className="text-[14px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Releases
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: BRAND.textMuted }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search releases…"
              className="h-7 rounded-md border pl-7 pr-3 text-[12px] placeholder:text-gray-400 focus:outline-none focus:ring-2"
              style={{ borderColor: BRAND.border, backgroundColor: BRAND.surface, color: BRAND.textPrimary, width: 200 }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: BRAND.textMuted }}>
                <X size={11} />
              </button>
            )}
          </div>

          {canManage && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: BRAND.primary }}
            >
              <Plus size={13} /> Create Release
            </button>
          )}
        </div>
      </div>

      {/* Column headers (P3-REL-FR-004/007) */}
      <div
        className="flex items-center h-8 px-3 select-none text-[11px] font-semibold"
        style={{ borderBottom: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textMuted, backgroundColor: BRAND.surface }}
      >
        <div className="flex-1 min-w-[200px]">Name</div>
        <div className="w-40 shrink-0">Theme</div>
        <div className="w-28 shrink-0">Start Date</div>
        <div className="w-28 shrink-0">Release Date</div>
        <div className="w-20 shrink-0 text-right">Plan. Vel.</div>
        <div className="w-16 shrink-0 text-right">Task Est.</div>
        <div className="w-28 shrink-0">State</div>
        {canManage && <div className="w-16 shrink-0" />}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND.surface }}>
        {isLoading && <SkeletonList rows={8} cols={7} />}

        {!isLoading && isError && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <AlertTriangle size={28} style={{ color: BRAND.danger }} />
            <p className="text-[13px] font-medium" style={{ color: BRAND.textSecondary }}>
              Failed to load releases. Please try again.
            </p>
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <PackageOpen size={32} style={{ color: BRAND.border }} />
            <p className="text-[13px] font-medium" style={{ color: BRAND.textSecondary }}>
              {search ? 'No releases match your search.' : 'No releases yet.'}
            </p>
            {!search && canManage && (
              <button onClick={() => setShowCreate(true)} className="text-[12px] font-medium" style={{ color: BRAND.primary }}>
                + Create first release
              </button>
            )}
          </div>
        )}

        {!isLoading && !isError &&
          filtered.map((release) => (
            <ReleaseRow
              key={release.id}
              release={release}
              projectId={projectId!}
              canManage={canManage}
              onEdit={setEditingRelease}
              onDelete={(id) => { void handleDelete(id) }}
            />
          ))}
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateReleaseModal projectId={projectId} onClose={() => setShowCreate(false)} />
      )}
      {editingRelease && (
        <ReleaseDetailModal
          release={editingRelease}
          projectId={projectId!}
          onClose={() => setEditingRelease(null)}
        />
      )}
    </div>
  )
}