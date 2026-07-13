/**
 * Releases — P3.2 Release Management
 *
 * Dense dashboard with inline-editable rows. Status values: Planning, Active, Accepted.
 * Create modal locks Type = Release. Columns: Name, Theme, Start Date, Release Date,
 * Project, Planned Velocity, Task Estimate, State.
 */
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  PackageOpen,
  Pencil,
  ExternalLink,
} from 'lucide-react'
import { SkeletonList } from '@/shared/ui/skeleton'
import { InlineSelect } from '@/shared/ui/native-select'
import { BRAND } from '@/shared/config/brand'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useColumnLayout, type ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { ResizeHandle } from '@/shared/ui/resize-handle'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import {
  useReleases,
  useCreateRelease,
  useUpdateRelease,
  useDeleteRelease,
  type Release,
  type ReleaseStatus,
} from '@/features/releases/api'

// ── Column definitions (resize) ──────────────────────────────────────────

type ColKey =
  | 'name'
  | 'theme'
  | 'version'
  | 'startDate'
  | 'releaseDate'
  | 'plannedVelocity'
  | 'taskEstimate'
  | 'progress'
  | 'state'
  | 'actions'

const RELEASES_COLUMNS: ColumnDef<ColKey>[] = [
  { key: 'name', label: 'Name', defaultWidth: 200, minWidth: 120, locked: true },
  { key: 'theme', label: 'Theme', defaultWidth: 144, minWidth: 80 },
  { key: 'version', label: 'Version', defaultWidth: 80, minWidth: 50 },
  { key: 'startDate', label: 'Start Date', defaultWidth: 96, minWidth: 80 },
  { key: 'releaseDate', label: 'Release Date', defaultWidth: 96, minWidth: 80 },
  { key: 'plannedVelocity', label: 'Plan. Vel.', defaultWidth: 80, minWidth: 60 },
  { key: 'taskEstimate', label: 'Task Est.', defaultWidth: 64, minWidth: 50 },
  { key: 'progress', label: 'Progress', defaultWidth: 128, minWidth: 80 },
  { key: 'state', label: 'State', defaultWidth: 112, minWidth: 80 },
  { key: 'actions', label: '', defaultWidth: 64, minWidth: 48 },
]

const RELEASE_STATES: ReleaseStatus[] = ['planning', 'active', 'accepted']

const STATUS_STYLE: Record<
  ReleaseStatus,
  { bg: string; text: string; border: string; label: string }
> = {
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
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [theme, setTheme] = useState('')
  const [status, setState] = useState<ReleaseStatus>('planning')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateRelease()

  async function submit(goToDetails?: boolean) {
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
      const result = await create.mutateAsync({
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        theme: theme.trim() || undefined,
        startDate: startDate || undefined,
        releaseDate: releaseDate || undefined,
        state: status,
      })
      toast.success(`Release "${name.trim()}" created`)
      onClose()
      if (goToDetails && result?.id) {
        void navigate({ to: '/releases/$releaseId', params: { releaseId: result.id } })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create release'
      setError(msg)
      toast.error(msg)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title="Create Release"
      subtitle="Type: Release (locked)"
      width={460}
    >
      <ModalBody className="space-y-4">
        {/* Type selector — disabled, locked to Release (P3-REL-FR-012) */}
        <FormField label="Type">
          <div className="flex gap-2">
            {(['Iteration', 'Release', 'Milestones'] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={t !== 'Release'}
                className="flex-1 rounded-sm py-1.5 text-[11px] font-semibold transition-colors"
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
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="v1.2.0 — Q3 Feature Drop"
            autoFocus
          />
        </FormField>

        <div className="flex gap-3">
          <FormField label="Theme" className="flex-1">
            <Input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="e.g. Security & Perf"
            />
          </FormField>
        </div>

        <div className="flex gap-3">
          <FormField label="Start Date" className="flex-1">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </FormField>
          <FormField label="Release Date" className="flex-1">
            <Input
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="Status">
          <InlineSelect
            value={status}
            onChange={(e) => setState(e.target.value as ReleaseStatus)}
            className="w-full rounded bg-white px-2 py-1.5 text-[11px] focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
          >
            {RELEASE_STATES.map((s) => (
              <option key={s} value={s}>
                {STATUS_STYLE[s].label}
              </option>
            ))}
          </InlineSelect>
        </FormField>

        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What ships in this release?"
            rows={3}
          />
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
            void submit(true)
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
            void submit(false)
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

function ReleaseDetailModal({
  release,
  projectId,
  onClose,
}: {
  release: Release
  projectId: string
  onClose: () => void
}) {
  const [name, setName] = useState(release.name)
  const [theme, setTheme] = useState(release.theme ?? '')
  const [notes, setNotes] = useState(release.notes ?? '')
  const [startDate, setStartDate] = useState(release.startDate ?? '')
  const [releaseDate, setReleaseDate] = useState(release.releaseDate ?? '')
  const [plannedVelocity, setPlannedVelocity] = useState(
    release.plannedVelocity == null ? '' : String(release.plannedVelocity),
  )
  const [planEstimate, setPlanEstimate] = useState(
    release.planEstimate == null ? '' : String(release.planEstimate),
  )
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

  const rollup = release.taskRollup

  return (
    <AppModal open onClose={onClose} title={release.name} subtitle="Release Detail" width={560}>
      <ModalBody className="space-y-4">
        {/* Task Rollup Summary */}
        {rollup && (
          <div
            className="flex items-center gap-4 rounded-md p-3"
            style={{ backgroundColor: '#f7f8fa', border: `1px solid ${BRAND.borderSubtle}` }}
          >
            <div className="flex-1">
              <div
                className="mb-1 text-[10px] font-semibold tracking-wider uppercase"
                style={{ color: BRAND.textMuted }}
              >
                Progress
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="h-2 flex-1 overflow-hidden rounded-full"
                  style={{ backgroundColor: '#e2e6eb' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${rollup.progressPercent}%`,
                      backgroundColor:
                        rollup.progressPercent === 100
                          ? '#1e6930'
                          : rollup.progressPercent > 50
                            ? '#1d6f9e'
                            : '#92400e',
                    }}
                  />
                </div>
                <span
                  className="font-mono text-[11px] font-semibold"
                  style={{ color: BRAND.textPrimary }}
                >
                  {rollup.progressPercent}%
                </span>
              </div>
            </div>
            <div
              className="px-3 text-center"
              style={{ borderLeft: `1px solid ${BRAND.borderSubtle}` }}
            >
              <div
                className="text-[10px] tracking-wider uppercase"
                style={{ color: BRAND.textMuted }}
              >
                Items
              </div>
              <div
                className="font-mono text-[14px] font-semibold"
                style={{ color: BRAND.textPrimary }}
              >
                {rollup.completedItems}
                <span className="text-[11px] font-normal" style={{ color: BRAND.textMuted }}>
                  /{rollup.totalItems}
                </span>
              </div>
            </div>
            <div
              className="px-3 text-center"
              style={{ borderLeft: `1px solid ${BRAND.borderSubtle}` }}
            >
              <div
                className="text-[10px] tracking-wider uppercase"
                style={{ color: BRAND.textMuted }}
              >
                Points
              </div>
              <div
                className="font-mono text-[14px] font-semibold"
                style={{ color: BRAND.textPrimary }}
              >
                {rollup.completedPoints}
                <span className="text-[11px] font-normal" style={{ color: BRAND.textMuted }}>
                  /{rollup.totalPoints}
                </span>
              </div>
            </div>
          </div>
        )}
        {/* Left panel fields: Theme, Notes */}
        <FormField label="Theme">
          <Textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Release theme or goal..."
            rows={3}
          />
        </FormField>

        <FormField label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes..."
            rows={3}
          />
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
            <Input
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="State">
          <InlineSelect
            value={state}
            onChange={(e) => setState(e.target.value as ReleaseStatus)}
            className="w-full rounded bg-white px-2 py-1.5 text-[11px] focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
          >
            {RELEASE_STATES.map((s) => (
              <option key={s} value={s}>
                {STATUS_STYLE[s].label}
              </option>
            ))}
          </InlineSelect>
        </FormField>

        <div className="flex gap-3">
          <FormField label="Planned Velocity" className="flex-1">
            <Input
              type="number"
              min={0}
              value={plannedVelocity}
              onChange={(e) => setPlannedVelocity(e.target.value)}
              placeholder="0"
            />
          </FormField>
          <FormField label="Plan Estimate" className="flex-1">
            <Input
              type="number"
              min={0}
              value={planEstimate}
              onChange={(e) => setPlanEstimate(e.target.value)}
              placeholder="0"
            />
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
          onClick={() => {
            void handleSubmit()
          }}
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
  onDelete,
  colStyleFor,
}: {
  release: Release
  projectId: string
  canManage: boolean
  onDelete: (id: string) => void
  colStyleFor: (key: ColKey, base?: React.CSSProperties) => React.CSSProperties
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

  function handleThemeBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    if (val !== (release.theme ?? '')) {
      update.mutate(
        { theme: val || undefined },
        {
          onSuccess: () => toast.success('Theme updated'),
          onError: (err) => toast.error(err.message),
        },
      )
    }
  }

  function handleVersionBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    if (val !== (release.version ?? '')) {
      update.mutate(
        { version: val || undefined },
        {
          onSuccess: () => toast.success('Version updated'),
          onError: (err) => toast.error(err.message),
        },
      )
    }
  }

  function handleVelocityBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    const num = val === '' ? null : Number(val)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('Planned velocity must be a positive integer')
      e.target.value = release.plannedVelocity != null ? String(release.plannedVelocity) : ''
      return
    }
    if (num !== release.plannedVelocity) {
      update.mutate(
        { plannedVelocity: num ?? undefined },
        {
          onSuccess: () => toast.success('Planned velocity updated'),
          onError: (err) => toast.error(err.message),
        },
      )
    }
  }

  function handleStartDateBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value
    if (val !== (release.startDate ?? '')) {
      update.mutate(
        { startDate: val || undefined },
        {
          onSuccess: () => toast.success('Start date updated'),
          onError: (err) => toast.error(err.message),
        },
      )
    }
  }

  function handleReleaseDateBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value
    if (val !== (release.releaseDate ?? '')) {
      update.mutate(
        { releaseDate: val || undefined },
        {
          onSuccess: () => toast.success('Release date updated'),
          onError: (err) => toast.error(err.message),
        },
      )
    }
  }

  function handleTaskEstimateBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    const num = val === '' ? null : Number(val)
    if (num !== null && (isNaN(num) || num < 0)) {
      toast.error('Task estimate must be a non-negative number')
      e.target.value = release.planEstimate != null ? String(release.planEstimate) : ''
      return
    }
    if (num !== release.planEstimate) {
      update.mutate(
        { planEstimate: num ?? undefined },
        {
          onSuccess: () => toast.success('Task estimate updated'),
          onError: (err) => toast.error(err.message),
        },
      )
    }
  }

  const navigate = useNavigate()

  return (
    <div
      onClick={() => navigate({ to: '/releases/$releaseId', params: { releaseId: release.id } })}
      className="group flex h-8 cursor-pointer items-center px-3 text-[11px] hover:bg-[#f9fafb]"
      style={{ borderBottom: `1px solid ${BRAND.borderInner}` }}
    >
      {/* Name — inline editable (P3-REL-FR-005) */}
      <div
        style={colStyleFor('name', { flexShrink: 0 })}
        className="flex items-center pr-2"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.name}
            defaultValue={release.name}
            onBlur={handleNameBlur}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border-0 bg-transparent px-0.5 text-[11px] font-semibold focus:bg-white focus:ring-1 focus:outline-none"
            style={{ color: BRAND.textPrimary }}
          />
        ) : (
          <span className="block truncate font-semibold" style={{ color: BRAND.textPrimary }}>
            {release.name}
          </span>
        )}
      </div>

      {/* Theme (P3-REL-FR-005) */}
      <div
        style={{ ...colStyleFor('theme', { flexShrink: 0 }), color: BRAND.textSecondary }}
        className="truncate pr-2"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.theme}
            defaultValue={release.theme ?? ''}
            onBlur={handleThemeBlur}
            placeholder="—"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border-0 bg-transparent px-0.5 text-[11px] focus:bg-white focus:ring-1 focus:outline-none"
            style={{ color: BRAND.textSecondary }}
          />
        ) : (
          <span className="block truncate">{release.theme || '—'}</span>
        )}
      </div>

      {/* Version */}
      <div
        style={{ ...colStyleFor('version', { flexShrink: 0 }), color: BRAND.textSecondary }}
        className="truncate pr-2"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.version}
            defaultValue={release.version ?? ''}
            onBlur={handleVersionBlur}
            placeholder="—"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border-0 bg-transparent px-0.5 text-[11px] focus:bg-white focus:ring-1 focus:outline-none"
            style={{ color: BRAND.textSecondary }}
          />
        ) : (
          <span className="block truncate">{release.version || '—'}</span>
        )}
      </div>

      {/* Start Date — inline editable */}
      <div
        style={{ ...colStyleFor('startDate', { flexShrink: 0 }), color: BRAND.textSecondary }}
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.startDate}
            type="date"
            defaultValue={release.startDate ?? ''}
            onBlur={handleStartDateBlur}
            className="w-full rounded border-0 bg-transparent px-0.5 text-[11px] focus:bg-white focus:ring-1 focus:outline-none"
            style={{ color: BRAND.textSecondary }}
          />
        ) : (
          <span>{release.startDate ?? '—'}</span>
        )}
      </div>

      {/* Release Date — inline editable */}
      <div
        style={{ ...colStyleFor('releaseDate', { flexShrink: 0 }), color: BRAND.textSecondary }}
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.releaseDate}
            type="date"
            defaultValue={release.releaseDate ?? ''}
            onBlur={handleReleaseDateBlur}
            className="w-full rounded border-0 bg-transparent px-0.5 text-[11px] focus:bg-white focus:ring-1 focus:outline-none"
            style={{ color: BRAND.textSecondary }}
          />
        ) : (
          <span>{release.releaseDate ?? '—'}</span>
        )}
      </div>

      {/* Planned Velocity — inline editable */}
      <div
        style={{ ...colStyleFor('plannedVelocity', { flexShrink: 0 }), color: BRAND.textSecondary }}
        className="pr-2"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.plannedVelocity}
            defaultValue={release.plannedVelocity != null ? String(release.plannedVelocity) : ''}
            onBlur={handleVelocityBlur}
            placeholder="—"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border-0 bg-transparent px-0.5 text-right font-mono text-[11px] focus:bg-white focus:ring-1 focus:outline-none"
            style={{ color: BRAND.textSecondary }}
          />
        ) : (
          <span className="block text-right font-mono tabular-nums">
            {release.plannedVelocity ?? '—'}
          </span>
        )}
      </div>

      {/* Task Estimate — inline editable */}
      <div
        style={{ ...colStyleFor('taskEstimate', { flexShrink: 0 }), color: BRAND.textSecondary }}
        className="pr-2 text-right font-mono tabular-nums"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.planEstimate}
            type="number"
            min={0}
            defaultValue={release.planEstimate != null ? String(release.planEstimate) : ''}
            onBlur={handleTaskEstimateBlur}
            placeholder="—"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border-0 bg-transparent px-0.5 text-right font-mono text-[11px] focus:bg-white focus:ring-1 focus:outline-none"
            style={{ color: BRAND.textSecondary }}
          />
        ) : (
          <span>{release.planEstimate ?? '—'}</span>
        )}
      </div>

      {/* Progress bar */}
      <div style={colStyleFor('progress', { flexShrink: 0 })} className="flex items-center gap-1.5">
        {release.taskRollup ? (
          <>
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full"
              style={{ backgroundColor: '#edf0f4' }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${release.taskRollup.progressPercent}%`,
                  backgroundColor:
                    release.taskRollup.progressPercent === 100 ? '#1e6930' : '#1d6f9e',
                }}
              />
            </div>
            <span
              className="font-mono text-[10px] whitespace-nowrap tabular-nums"
              style={{ color: BRAND.textMuted }}
            >
              {release.taskRollup.completedItems}/{release.taskRollup.totalItems}
            </span>
          </>
        ) : (
          <span className="text-[10px]" style={{ color: BRAND.textMuted }}>
            —
          </span>
        )}
      </div>

      {/* State (P3-REL-FR-008) */}
      <div style={colStyleFor('state', { flexShrink: 0 })} onClick={(e) => e.stopPropagation()}>
        {canManage ? (
          <InlineSelect
            value={status}
            onChange={handleStateChange}
            className="rounded bg-white px-1 py-0.5 text-[11px] focus:outline-none"
            style={{ border: `1px solid ${BRAND.borderSubtle}`, color: BRAND.textPrimary }}
          >
            {RELEASE_STATES.map((s) => (
              <option key={s} value={s}>
                {STATUS_STYLE[s].label}
              </option>
            ))}
          </InlineSelect>
        ) : (
          <StatusBadge status={status} />
        )}
      </div>

      {/* Actions */}
      <div style={colStyleFor('actions', { flexShrink: 0 })}>
        {canManage && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigate({ to: '/releases/$releaseId', params: { releaseId: release.id } })
              }}
              title="Open detail"
              className="cursor-pointer rounded p-1 transition-colors hover:bg-gray-100"
              style={{ color: BRAND.textMuted }}
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigate({ to: '/releases/$releaseId', params: { releaseId: release.id } })
              }}
              title="Detail"
              className="cursor-pointer rounded p-1 transition-colors hover:bg-gray-100"
              style={{ color: BRAND.textMuted }}
            >
              <ExternalLink size={12} />
            </button>
            {status !== 'accepted' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(release.id)
                }}
                title="Delete release"
                className="cursor-pointer rounded p-1 transition-colors hover:bg-red-50"
                style={{ color: BRAND.textMuted }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export function ReleasesPage() {
  const { project } = useAppContext()
  const projectId = project?.projectId
  const { can } = useProjectPermissions(projectId)
  const canManage = can('release:manage')

  // ── Column layout (resize) ──────────────────────────────────────────
  const { startResize, styleFor } = useColumnLayout(RELEASES_COLUMNS, STORAGE_KEYS.RELEASES_COLUMNS)
  const colStyleFor = useCallback(
    (key: ColKey, base?: React.CSSProperties) => styleFor(key, base),
    [styleFor],
  )

  const { data: releases = [], isLoading, isError } = useReleases(projectId)
  const deleteRelease = useDeleteRelease(projectId ?? '')

  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingRelease, setEditingRelease] = useState<Release | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return releases
    const q = search.toLowerCase()
    return releases.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.theme ?? '').toLowerCase().includes(q),
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
      <div
        className="flex flex-1 items-center justify-center"
        style={{ backgroundColor: BRAND.pageBg }}
      >
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
            <Search
              size={12}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
              style={{ color: BRAND.textMuted }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search releases…"
              className="h-7 rounded-md border pr-3 pl-7 text-[12px] placeholder:text-gray-400 focus:ring-2 focus:outline-none"
              style={{
                borderColor: BRAND.border,
                backgroundColor: BRAND.surface,
                color: BRAND.textPrimary,
                width: 200,
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute top-1/2 right-2 -translate-y-1/2"
                style={{ color: BRAND.textMuted }}
              >
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

      {/* Column headers (P3-REL-FR-004/007) — resizable */}
      <div
        className="flex h-8 items-center px-3 text-[11px] font-semibold select-none"
        style={{
          borderBottom: `1px solid ${BRAND.borderSubtle}`,
          color: BRAND.textMuted,
          backgroundColor: BRAND.surface,
        }}
      >
        <div style={styleFor('name', { flexShrink: 0 })} className="group relative px-1">
          Name
          <ResizeHandle
            onMouseDown={(e) => startResize('name', e)}
            ariaLabel="Resize Name column"
          />
        </div>
        <div style={styleFor('theme', { flexShrink: 0 })} className="group relative px-1">
          Theme
          <ResizeHandle
            onMouseDown={(e) => startResize('theme', e)}
            ariaLabel="Resize Theme column"
          />
        </div>
        <div style={styleFor('version', { flexShrink: 0 })} className="group relative px-1">
          Version
          <ResizeHandle
            onMouseDown={(e) => startResize('version', e)}
            ariaLabel="Resize Version column"
          />
        </div>
        <div style={styleFor('startDate', { flexShrink: 0 })} className="group relative px-1">
          Start Date
          <ResizeHandle
            onMouseDown={(e) => startResize('startDate', e)}
            ariaLabel="Resize Start Date column"
          />
        </div>
        <div style={styleFor('releaseDate', { flexShrink: 0 })} className="group relative px-1">
          Release Date
          <ResizeHandle
            onMouseDown={(e) => startResize('releaseDate', e)}
            ariaLabel="Resize Release Date column"
          />
        </div>
        <div
          style={styleFor('plannedVelocity', { flexShrink: 0 })}
          className="group relative px-1 pr-2 text-right"
        >
          Plan. Vel.
          <ResizeHandle
            onMouseDown={(e) => startResize('plannedVelocity', e)}
            ariaLabel="Resize Planned Velocity column"
          />
        </div>
        <div
          style={styleFor('taskEstimate', { flexShrink: 0 })}
          className="group relative px-1 pr-2 text-right"
        >
          Task Est.
          <ResizeHandle
            onMouseDown={(e) => startResize('taskEstimate', e)}
            ariaLabel="Resize Task Estimate column"
          />
        </div>
        <div style={styleFor('progress', { flexShrink: 0 })} className="group relative px-1">
          Progress
          <ResizeHandle
            onMouseDown={(e) => startResize('progress', e)}
            ariaLabel="Resize Progress column"
          />
        </div>
        <div style={styleFor('state', { flexShrink: 0 })} className="group relative px-1">
          State
          <ResizeHandle
            onMouseDown={(e) => startResize('state', e)}
            ariaLabel="Resize State column"
          />
        </div>
        {canManage && <div style={styleFor('actions', { flexShrink: 0 })} className="px-1" />}
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
              <button
                onClick={() => setShowCreate(true)}
                className="text-[12px] font-medium"
                style={{ color: BRAND.primary }}
              >
                + Create first release
              </button>
            )}
          </div>
        )}

        {!isLoading &&
          !isError &&
          filtered.map((release) => (
            <ReleaseRow
              key={release.id}
              release={release}
              projectId={projectId!}
              canManage={canManage}
              onDelete={(id) => {
                void handleDelete(id)
              }}
              colStyleFor={colStyleFor}
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
