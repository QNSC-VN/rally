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
  Trash2,
  PackageOpen,
  Pencil,
  ExternalLink,
} from 'lucide-react'
import { InlineSelect } from '@/shared/ui/native-select'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { BRAND } from '@/shared/config/brand'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { DataTableFrame, useDataTable, type ColumnSpec } from '@/shared/ui/table'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { StatusBadge as StatusPill } from '@/shared/ui/status-badge'
import { RELEASE_STATUS_STYLE } from '@/features/releases/status-colors'
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
  | 'state'
  | 'actions'

const RELEASES_COLUMNS: ColumnSpec<Release, unknown, ColKey>[] = [
  { key: 'name', label: 'Name', defaultWidth: 200, minWidth: 120, locked: true },
  { key: 'theme', label: 'Theme', defaultWidth: 144, minWidth: 80 },
  { key: 'version', label: 'Version', defaultWidth: 80, minWidth: 50 },
  { key: 'startDate', label: 'Start Date', defaultWidth: 96, minWidth: 80 },
  { key: 'releaseDate', label: 'Release Date', defaultWidth: 96, minWidth: 80 },
  { key: 'plannedVelocity', label: 'Plan. Vel.', defaultWidth: 80, minWidth: 60, align: 'right' },
  { key: 'taskEstimate', label: 'Task Est.', defaultWidth: 64, minWidth: 50, align: 'right' },
  { key: 'state', label: 'State', defaultWidth: 112, minWidth: 80 },
  { key: 'actions', label: '', defaultWidth: 64, minWidth: 48, locked: true },
]

const RELEASE_STATES: ReleaseStatus[] = ['planning', 'active', 'accepted']

const STATUS_STYLE = RELEASE_STATUS_STYLE

function StatusBadge({ status }: { status: ReleaseStatus }) {
  return <StatusPill style={STATUS_STYLE[status] ?? STATUS_STYLE.planning} />
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
                  backgroundColor: t === 'Release' ? BRAND.primaryLighter : 'transparent',
                  color: t === 'Release' ? BRAND.primary : BRAND.textMuted,
                  border: `1px solid ${t === 'Release' ? BRAND.accentBorder : BRAND.borderSubtle}`,
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
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={create.isPending || !name.trim()}
          onClick={() => {
            void submit(true)
          }}
        >
          Create with details
        </Button>
        <Button
          type="button"
          disabled={create.isPending || !name.trim()}
          onClick={() => {
            void submit(false)
          }}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          Create Release
        </Button>
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
            style={{
              backgroundColor: BRAND.surfaceHover,
              border: `1px solid ${BRAND.borderSubtle}`,
            }}
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
                  style={{ backgroundColor: BRAND.borderSubtle }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${rollup.progressPercent}%`,
                      backgroundColor:
                        rollup.progressPercent === 100
                          ? BRAND.success
                          : rollup.progressPercent > 50
                            ? BRAND.primaryLight
                            : BRAND.warning,
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
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={update.isPending || !name.trim()}
          onClick={() => {
            void handleSubmit()
          }}
        >
          {update.isPending && <Loader2 size={11} className="animate-spin" />}
          Save
        </Button>
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

  const navigate = useNavigate()

  return (
    <div
      onClick={() => navigate({ to: '/releases/$releaseId', params: { releaseId: release.id } })}
      className="group flex h-8 cursor-pointer items-center px-3 text-[11px] hover:bg-surface-hover"
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
            aria-label="Release name"
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
            aria-label="Theme"
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
            aria-label="Version"
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
            aria-label="Start date"
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
            aria-label="Release date"
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
            aria-label="Planned velocity"
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

      {/* Task Estimate — read-only roll-up of assigned work-item estimate hours (P3-REL-FR-004) */}
      <div
        style={{ ...colStyleFor('taskEstimate', { flexShrink: 0 }), color: BRAND.textSecondary }}
        className="pr-2 text-right font-mono tabular-nums"
        onClick={(e) => e.stopPropagation()}
      >
        <span>{release.taskEstimate ?? 0}</span>
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
  const canManage = can('release:create') || can('release:edit') || can('release:delete')

  // ── Shared table engine (identical to projects/quality): resize / reorder / show-hide ──
  const table = useDataTable<Release, unknown, ColKey>(RELEASES_COLUMNS, {
    storageKey: STORAGE_KEYS.RELEASES_COLUMNS,
  })
  const colStyleFor = useCallback(
    (key: ColKey, base?: React.CSSProperties) => table.styleFor(key, base),
    [table],
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

  const stats = useMemo(
    () => ({
      total: releases.length,
      active: releases.filter((r) => r.status === 'active').length,
      accepted: releases.filter((r) => r.status === 'accepted').length,
      planning: releases.filter((r) => r.status === 'planning').length,
    }),
    [releases],
  )

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
      <PageToolbar
        title="Releases"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search releases…',
          ariaLabel: 'Search releases',
          width: 200,
        }}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={13} /> Create Release
            </Button>
          ) : undefined
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* Summary metric strip */}
      <MetricStrip>
        <MetricCard label="Total Releases" value={stats.total} minWidth={100} />
        <MetricCard
          label="Active"
          value={stats.active}
          valueColor={BRAND.primaryLight}
          minWidth={80}
        />
        <MetricCard
          label="Accepted"
          value={stats.accepted}
          valueColor={BRAND.success}
          minWidth={90}
        />
        <MetricCard label="Planning" value={stats.planning} minWidth={90} />
      </MetricStrip>

      {/* Table — shared DataTableFrame owns the chrome (read-only list kind:
          sortable header, no totals / selection / drag gutter). */}
      <DataTableFrame
        header={table.headerProps}
        loading={isLoading}
        skeleton={{ rows: 8, cols: 7 }}
        error={
          isError ? (
            <EmptyState
              icon={<AlertTriangle size={28} className="text-destructive" />}
              title="Failed to load releases. Please try again."
            />
          ) : undefined
        }
        empty={
          filtered.length === 0 ? (
            <EmptyState
              icon={<PackageOpen size={32} className="text-border-strong" />}
              title={search ? 'No releases match your search.' : 'No releases yet.'}
              action={
                !search && canManage ? (
                  <Button variant="link" size="xs" onClick={() => setShowCreate(true)}>
                    + Create first release
                  </Button>
                ) : undefined
              }
            />
          ) : undefined
        }
      >
        {filtered.map((release) => (
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
      </DataTableFrame>

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
