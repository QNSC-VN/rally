import { useState, type CSSProperties } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Pencil, Trash2, ExternalLink } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import {
  useCreateRelease,
  useUpdateRelease,
  type Release,
  type ReleaseStatus,
} from '@/features/releases/api'
import { RELEASE_STATUS_STYLE } from '@/features/releases/status-colors'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { InlineSelect } from '@/shared/ui/native-select'
import { StatusBadge as StatusPill } from '@/shared/ui/status-badge'
import { type ColKey } from '../model/columns'

const RELEASE_STATES: ReleaseStatus[] = ['planning', 'active', 'accepted']

const STATUS_STYLE = RELEASE_STATUS_STYLE

function StatusBadge({ status }: { status: ReleaseStatus }) {
  return <StatusPill style={STATUS_STYLE[status] ?? STATUS_STYLE.planning} />
}

// ── Create modal (P3-REL-FR-011/012: Type locked to Release) ─────────────

export function CreateReleaseModal({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
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
      notify.success(`Release "${name.trim()}" created`)
      onClose()
      if (goToDetails && result?.id) {
        void navigate({ to: '/releases/$releaseId', params: { releaseId: result.id } })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create release'
      setError(msg)
      notify.error(msg)
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
                className="flex-1 rounded-sm py-1.5 text-ui-sm font-semibold transition-colors"
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
            className="w-full rounded border border-input bg-card px-2 py-1.5 text-ui-sm text-foreground focus:outline-none"
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

export function ReleaseDetailModal({
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
      notify.success('Release updated')
      onClose()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to update release')
    }
  }

  const rollup = release.taskRollup

  return (
    <AppModal open onClose={onClose} title={release.name} subtitle="Release Detail" width={560}>
      <ModalBody className="space-y-4">
        {/* Task Rollup Summary */}
        {rollup && (
          <div className="flex items-center gap-4 rounded-md border border-border-subtle bg-surface-hover p-3">
            <div className="flex-1">
              <div className="mb-1 text-ui-xs font-semibold tracking-wider text-foreground-subtle uppercase">
                Progress
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-border-subtle">
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
                <span className="font-mono text-ui-sm font-semibold text-foreground">
                  {rollup.progressPercent}%
                </span>
              </div>
            </div>
            <div className="border-l border-border-subtle px-3 text-center">
              <div className="text-ui-xs tracking-wider text-foreground-subtle uppercase">
                Items
              </div>
              <div className="font-mono text-ui-xl font-semibold text-foreground">
                {rollup.completedItems}
                <span className="text-ui-sm font-normal text-foreground-subtle">
                  /{rollup.totalItems}
                </span>
              </div>
            </div>
            <div className="border-l border-border-subtle px-3 text-center">
              <div className="text-ui-xs tracking-wider text-foreground-subtle uppercase">
                Points
              </div>
              <div className="font-mono text-ui-xl font-semibold text-foreground">
                {rollup.completedPoints}
                <span className="text-ui-sm font-normal text-foreground-subtle">
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
            className="w-full rounded border border-input bg-card px-2 py-1.5 text-ui-sm text-foreground focus:outline-none"
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

export function ReleaseRow({
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
  colStyleFor: (key: ColKey, base?: CSSProperties) => CSSProperties
}) {
  const update = useUpdateRelease(release.id, projectId)
  const status = release.status as ReleaseStatus

  function handleStateChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newState = e.target.value as ReleaseStatus
    update.mutate(
      { state: newState },
      {
        onSuccess: () => notify.success(`Status updated to ${STATUS_STYLE[newState].label}`),
        onError: (err) => notify.error(err.message),
      },
    )
  }

  function handleNameBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    if (val && val !== release.name) {
      update.mutate(
        { name: val },
        {
          onSuccess: () => notify.success('Name updated'),
          onError: (err) => notify.error(err.message),
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
          onSuccess: () => notify.success('Theme updated'),
          onError: (err) => notify.error(err.message),
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
          onSuccess: () => notify.success('Version updated'),
          onError: (err) => notify.error(err.message),
        },
      )
    }
  }

  function handleVelocityBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.target.value.trim()
    const num = val === '' ? null : Number(val)
    if (num !== null && (isNaN(num) || num < 0)) {
      notify.error('Planned velocity must be a positive integer')
      e.target.value = release.plannedVelocity != null ? String(release.plannedVelocity) : ''
      return
    }
    if (num !== release.plannedVelocity) {
      update.mutate(
        { plannedVelocity: num ?? undefined },
        {
          onSuccess: () => notify.success('Planned velocity updated'),
          onError: (err) => notify.error(err.message),
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
          onSuccess: () => notify.success('Start date updated'),
          onError: (err) => notify.error(err.message),
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
          onSuccess: () => notify.success('Release date updated'),
          onError: (err) => notify.error(err.message),
        },
      )
    }
  }

  const navigate = useNavigate()

  return (
    <div
      onClick={() => navigate({ to: '/releases/$releaseId', params: { releaseId: release.id } })}
      className="group flex h-8 cursor-pointer items-center border-b border-border-inner px-3 text-ui-sm hover:bg-surface-hover"
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
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm font-semibold text-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span className="block truncate font-semibold text-foreground">{release.name}</span>
        )}
      </div>

      {/* Theme (P3-REL-FR-005) */}
      <div
        style={colStyleFor('theme', { flexShrink: 0 })}
        className="truncate pr-2 text-muted-foreground"
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
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span className="block truncate">{release.theme || '—'}</span>
        )}
      </div>

      {/* Version */}
      <div
        style={colStyleFor('version', { flexShrink: 0 })}
        className="truncate pr-2 text-muted-foreground"
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
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span className="block truncate">{release.version || '—'}</span>
        )}
      </div>

      {/* Start Date — inline editable */}
      <div
        style={colStyleFor('startDate', { flexShrink: 0 })}
        className="text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.startDate}
            type="date"
            defaultValue={release.startDate ?? ''}
            onBlur={handleStartDateBlur}
            aria-label="Start date"
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span>{release.startDate ?? '—'}</span>
        )}
      </div>

      {/* Release Date — inline editable */}
      <div
        style={colStyleFor('releaseDate', { flexShrink: 0 })}
        className="text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage ? (
          <input
            key={release.releaseDate}
            type="date"
            defaultValue={release.releaseDate ?? ''}
            onBlur={handleReleaseDateBlur}
            aria-label="Release date"
            className="w-full rounded border-0 bg-transparent px-0.5 text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span>{release.releaseDate ?? '—'}</span>
        )}
      </div>

      {/* Planned Velocity — inline editable */}
      <div
        style={colStyleFor('plannedVelocity', { flexShrink: 0 })}
        className="pr-2 text-muted-foreground"
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
            className="w-full rounded border-0 bg-transparent px-0.5 text-right font-mono text-ui-sm text-muted-foreground focus:bg-card focus:ring-1 focus:outline-none"
          />
        ) : (
          <span className="block text-right font-mono tabular-nums">
            {release.plannedVelocity ?? '—'}
          </span>
        )}
      </div>

      {/* Task Estimate — read-only roll-up of assigned work-item estimate hours (P3-REL-FR-004) */}
      <div
        style={colStyleFor('taskEstimate', { flexShrink: 0 })}
        className="pr-2 text-right font-mono text-muted-foreground tabular-nums"
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
            className="rounded border border-border-subtle bg-card px-1 py-0.5 text-ui-sm text-foreground focus:outline-none"
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
              className="cursor-pointer rounded p-1 text-foreground-subtle transition-colors hover:bg-gray-100"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigate({ to: '/releases/$releaseId', params: { releaseId: release.id } })
              }}
              title="Detail"
              className="cursor-pointer rounded p-1 text-foreground-subtle transition-colors hover:bg-gray-100"
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
                className="cursor-pointer rounded p-1 text-foreground-subtle transition-colors hover:bg-red-50"
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
