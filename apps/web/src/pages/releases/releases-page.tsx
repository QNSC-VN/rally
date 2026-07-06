/**
 * Releases — P3-RELEASE-MGMT
 *
 * Lists releases for the active project with create, edit, ship, and delete.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Plus, Search, Ship, Pencil, Trash2, X, PackageOpen } from 'lucide-react'
import { SkeletonList } from '@/shared/ui/skeleton'
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
  useShipRelease,
  type Release,
} from '@/features/releases/api'

// ── Status badge ──────────────────────────────────────────────────────────────

type ReleaseStatus = 'planned' | 'released' | 'archived'

const STATUS_STYLE: Record<ReleaseStatus, { bg: string; text: string; border: string; label: string }> = {
  planned: { bg: '#eef3fb', text: '#1d3f73', border: '#bdd0ef', label: 'Planned' },
  released: { bg: '#eaf5ed', text: '#1e6930', border: '#b9dec2', label: 'Released' },
  archived: { bg: '#f5f5f5', text: '#6b7280', border: '#d1d5db', label: 'Archived' },
}

function StatusBadge({ status }: { status: ReleaseStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.planned
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-px text-[11px] font-medium whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  )
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateReleaseModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const create = useCreateRelease()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await create.mutateAsync({
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        targetDate: targetDate || undefined,
      })
      toast.success(`Release "${name}" created`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create release')
    }
  }

  return (
    <AppModal open onClose={onClose} title="New Release" width={460}>
      <form onSubmit={(e) => { void handleSubmit(e) }}>
        <ModalBody className="space-y-4">
          <FormField label="Release name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="v1.2.0 — Q3 Feature Drop"
              autoFocus
            />
          </FormField>
          <FormField label="Target date" hint="YYYY-MM-DD">
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
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
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {create.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            Create release
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-medium"
            style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
          >
            Cancel
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditReleaseModal({ release, onClose }: { release: Release; onClose: () => void }) {
  const [name, setName] = useState(release.name)
  const [description, setDescription] = useState(release.description ?? '')
  const [targetDate, setTargetDate] = useState(release.targetDate ?? '')
  const update = useUpdateRelease(release.id)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await update.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        targetDate: targetDate || null,
      })
      toast.success('Release updated')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update release')
    }
  }

  return (
    <AppModal open onClose={onClose} title={`Edit ${release.name}`} width={460}>
      <form onSubmit={(e) => { void handleSubmit(e) }}>
        <ModalBody className="space-y-4">
          <FormField label="Release name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Target date" hint="YYYY-MM-DD">
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <button
            type="submit"
            disabled={update.isPending || !name.trim()}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {update.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-medium"
            style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
          >
            Cancel
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Release row ───────────────────────────────────────────────────────────────

function ReleaseRow({
  release,
  canManage,
  onShip,
  onEdit,
  onDelete,
}: {
  release: Release
  canManage: boolean
  onShip: (id: string) => void
  onEdit: (r: Release) => void
  onDelete: (id: string) => void
}) {
  const status = (release.status ?? 'planned') as ReleaseStatus

  return (
    <div
      className="group flex items-center gap-4 px-4 py-3 hover:bg-gray-50"
      style={{ borderBottom: `1px solid ${BRAND.border}` }}
    >
      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate" style={{ color: BRAND.textPrimary }}>
          {release.name}
        </p>
        {release.description && (
          <p className="text-[12px] truncate" style={{ color: BRAND.textMuted }}>
            {release.description}
          </p>
        )}
      </div>

      {/* Target date */}
      <div className="w-32 shrink-0 text-[12px]" style={{ color: BRAND.textMuted }}>
        {release.targetDate ?? <span style={{ color: BRAND.border }}>—</span>}
      </div>

      {/* Released at */}
      <div className="w-36 shrink-0 text-[12px]" style={{ color: BRAND.textMuted }}>
        {release.releasedAt
          ? new Date(release.releasedAt).toLocaleDateString()
          : <span style={{ color: BRAND.border }}>—</span>}
      </div>

      {/* Status */}
      <div className="w-24 shrink-0">
        <StatusBadge status={status} />
      </div>

      {/* Actions */}
      {canManage && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
          {status === 'planned' && (
            <button
              onClick={() => onShip(release.id)}
              title="Mark as released"
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors hover:bg-green-50"
              style={{ color: '#1e6930' }}
            >
              <Ship size={12} /> Ship
            </button>
          )}
          <button
            onClick={() => onEdit(release)}
            title="Edit release"
            className="rounded p-1.5 transition-colors hover:bg-gray-100"
            style={{ color: BRAND.textMuted }}
          >
            <Pencil size={12} />
          </button>
          {status !== 'released' && (
            <button
              onClick={() => onDelete(release.id)}
              title="Delete release"
              className="rounded p-1.5 transition-colors hover:bg-red-50"
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReleasesPage() {
  const { project } = useAppContext()
  const projectId = project?.projectId
  const canManage = useAuthStore((s) => s.hasPermission('release:manage'))

  const { data: releases = [], isLoading, isError } = useReleases(projectId)
  const shipRelease = useShipRelease(projectId ?? '')
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
        (r.description ?? '').toLowerCase().includes(q),
    )
  }, [releases, search])

  async function handleShip(id: string) {
    try {
      await shipRelease.mutateAsync(id)
      toast.success('Release shipped 🚀')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to ship release')
    }
  }

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
      {/* ── Header ── */}
      <div
        className="flex h-12 shrink-0 items-center justify-between gap-4 px-4"
        style={{ borderBottom: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
      >
        <h1 className="text-[14px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Releases
        </h1>

        <div className="flex items-center gap-2">
          {/* Search */}
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
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2"
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
              <Plus size={13} /> New release
            </button>
          )}
        </div>
      </div>

      {/* ── Column headers ── */}
      <div
        className="flex items-center gap-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide"
        style={{ borderBottom: `1px solid ${BRAND.border}`, color: BRAND.textMuted, backgroundColor: BRAND.surface }}
      >
        <div className="flex-1">Name</div>
        <div className="w-32 shrink-0">Target Date</div>
        <div className="w-36 shrink-0">Released</div>
        <div className="w-24 shrink-0">Status</div>
        {canManage && <div className="w-24 shrink-0" />}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <SkeletonList rows={8} cols={4} />}

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

        {!isLoading && !isError &&
          filtered.map((release) => (
            <ReleaseRow
              key={release.id}
              release={release}
              canManage={canManage}
              onShip={(id) => { void handleShip(id) }}
              onEdit={setEditingRelease}
              onDelete={(id) => { void handleDelete(id) }}
            />
          ))}
      </div>

      {/* ── Modals ── */}
      {showCreate && (
        <CreateReleaseModal projectId={projectId} onClose={() => setShowCreate(false)} />
      )}
      {editingRelease && (
        <EditReleaseModal release={editingRelease} onClose={() => setEditingRelease(null)} />
      )}
    </div>
  )
}
