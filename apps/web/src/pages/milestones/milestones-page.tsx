/**
 * Milestones — P3.3
 *
 * Lists milestones for the active project. Milestones live under
 * Plan > Timeboxes alongside Iterations and Releases.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, Plus, Pencil, Trash2, PackageOpen } from 'lucide-react'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { StatusBadge as StatusPill } from '@/shared/ui/status-badge'
import { MILESTONE_STATUS_STYLE } from '@/features/milestones/status-colors'
import { useColumnLayout, type ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { ResizeHandle } from '@/shared/ui/resize-handle'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { SkeletonList } from '@/shared/ui/skeleton'
import { BRAND } from '@/shared/config/brand'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import {
  useMilestones,
  useCreateMilestone,
  useUpdateMilestone,
  useDeleteMilestone,
  type Milestone,
  type MilestoneStatus,
} from '@/features/milestones/api'
import { useReleases } from '@/features/releases/api'
import { useProjectMembers } from '@/features/teams/api'

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLE = MILESTONE_STATUS_STYLE

function StatusBadge({ status }: { status: MilestoneStatus }) {
  return <StatusPill style={STATUS_STYLE[status] ?? STATUS_STYLE.planned} />
}

const MILESTONE_STATUSES: MilestoneStatus[] = [
  'planned',
  'at_risk',
  'met',
  'missed',
  'cancelled',
  'completed',
]

// ── Shared modal body ────────────────────────────────────────────────────────

function MilestoneFormFields({
  name,
  setName,
  description,
  setDescription,
  notes,
  setNotes,
  status,
  setStatus,
  ownerId,
  setOwnerId,
  targetStartDate,
  targetEndDate,
  selectedReleases,
  toggleRelease,
  releases,
  members,
}: {
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  status: MilestoneStatus
  setStatus: (v: MilestoneStatus) => void
  ownerId: string
  setOwnerId: (v: string) => void
  targetStartDate: string
  targetEndDate: string
  selectedReleases: string[]
  toggleRelease: (rid: string) => void
  releases: { id: string; name: string }[] | undefined
  members: { userId: string; displayName?: string; email?: string }[] | undefined
}) {
  return (
    <>
      <FormField label="Milestone name" required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q4 Release Candidate"
          autoFocus
        />
      </FormField>
      <FormField label="Status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
          className="w-full rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: BRAND.border, color: BRAND.textPrimary }}
        >
          {MILESTONE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_STYLE[s].label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Description">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Milestone description..."
          rows={2}
        />
      </FormField>
      <FormField label="Notes">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes..."
          rows={2}
        />
      </FormField>
      <FormField label="Owner">
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="w-full rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: BRAND.border, color: BRAND.textPrimary }}
        >
          <option value="">Unassigned</option>
          {(members ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName ?? m.email}
            </option>
          ))}
        </select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Target Start">
          <div
            className="w-full rounded-md border bg-gray-50 px-3 py-1.5 text-sm"
            style={{
              borderColor: BRAND.border,
              color: targetStartDate ? BRAND.textPrimary : BRAND.textMuted,
            }}
          >
            {targetStartDate || 'Not set'}
          </div>
          <p className="mt-0.5 text-[10px]" style={{ color: BRAND.textMuted }}>
            Derived from linked Releases
          </p>
        </FormField>
        <FormField label="Target End">
          <div
            className="w-full rounded-md border bg-gray-50 px-3 py-1.5 text-sm"
            style={{
              borderColor: BRAND.border,
              color: targetEndDate ? BRAND.textPrimary : BRAND.textMuted,
            }}
          >
            {targetEndDate || 'Not set'}
          </div>
          <p className="mt-0.5 text-[10px]" style={{ color: BRAND.textMuted }}>
            Derived from linked Releases
          </p>
        </FormField>
      </div>
      <FormField label="Associated Releases">
        <div
          className="flex max-h-32 flex-col gap-1.5 overflow-y-auto rounded-md border p-2"
          style={{ borderColor: BRAND.border }}
        >
          {releases && releases.length > 0 ? (
            releases.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2 text-xs select-none"
              >
                <input
                  type="checkbox"
                  checked={selectedReleases.includes(r.id)}
                  onChange={() => toggleRelease(r.id)}
                />
                <span>{r.name}</span>
              </label>
            ))
          ) : (
            <span className="text-xs text-gray-400">No releases available</span>
          )}
        </div>
      </FormField>
    </>
  )
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateMilestoneModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<MilestoneStatus>('planned')
  const targetStartDate = ''
  const targetEndDate = ''
  const [selectedReleases, setSelectedReleases] = useState<string[]>([])
  const [ownerId, setOwnerId] = useState('')
  const { data: releases } = useReleases(projectId)
  const { data: members } = useProjectMembers(projectId)
  const create = useCreateMilestone()

  function toggleRelease(rid: string) {
    setSelectedReleases((prev) =>
      prev.includes(rid) ? prev.filter((id) => id !== rid) : [...prev, rid],
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await create.mutateAsync({
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
        status,
        ownerId: ownerId || undefined,
        releaseIds: selectedReleases,
      })
      toast.success(`Milestone "${name}" created`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create milestone')
    }
  }

  return (
    <AppModal open onClose={onClose} title="New Milestone" width={480}>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
      >
        <ModalBody className="space-y-4">
          <MilestoneFormFields
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            notes={notes}
            setNotes={setNotes}
            status={status}
            setStatus={setStatus}
            ownerId={ownerId}
            setOwnerId={setOwnerId}
            targetStartDate={targetStartDate}
            targetEndDate={targetEndDate}
            selectedReleases={selectedReleases}
            toggleRelease={toggleRelease}
            releases={releases}
            members={members}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating...' : 'Create Milestone'}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditMilestoneModal({ milestone, onClose }: { milestone: Milestone; onClose: () => void }) {
  const [name, setName] = useState(milestone.name)
  const [description, setDescription] = useState(milestone.description ?? '')
  const [notes, setNotes] = useState(milestone.notes ?? '')
  const [status, setStatus] = useState<MilestoneStatus>(milestone.status)
  const [selectedReleases, setSelectedReleases] = useState<string[]>(milestone.releaseIds ?? [])
  const [ownerId, setOwnerId] = useState(milestone.ownerId ?? '')
  const targetStartDate = milestone.targetStartDate ?? ''
  const targetEndDate = milestone.targetEndDate ?? ''
  const { data: releases } = useReleases(milestone.projectId)
  const { data: members } = useProjectMembers(milestone.projectId)
  const update = useUpdateMilestone()

  function toggleRelease(rid: string) {
    setSelectedReleases((prev) =>
      prev.includes(rid) ? prev.filter((id) => id !== rid) : [...prev, rid],
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await update.mutateAsync({
        id: milestone.id,
        name: name.trim(),
        description: description.trim() || null,
        notes: notes.trim() || null,
        status,
        ownerId: ownerId || null,
        releaseIds: selectedReleases,
      })
      toast.success('Milestone updated')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update milestone')
    }
  }

  return (
    <AppModal open onClose={onClose} title="Edit Milestone" width={480}>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
      >
        <ModalBody className="space-y-4">
          <MilestoneFormFields
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            notes={notes}
            setNotes={setNotes}
            status={status}
            setStatus={setStatus}
            ownerId={ownerId}
            setOwnerId={setOwnerId}
            targetStartDate={targetStartDate}
            targetEndDate={targetEndDate}
            selectedReleases={selectedReleases}
            toggleRelease={toggleRelease}
            releases={releases}
            members={members}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending || !name.trim()}>
            {update.isPending ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Column definitions (resize) ──────────────────────────────────────────

type MilestoneColKey = 'name' | 'targetStartDate' | 'targetEndDate' | 'status' | 'actions'

const MILESTONES_COLUMNS: ColumnDef<MilestoneColKey>[] = [
  { key: 'name', label: 'Name', defaultWidth: 260, minWidth: 120, locked: true },
  { key: 'targetStartDate', label: 'Target Start Date', defaultWidth: 120, minWidth: 90 },
  { key: 'targetEndDate', label: 'Target End Date', defaultWidth: 120, minWidth: 90 },
  { key: 'status', label: 'Status', defaultWidth: 100, minWidth: 70 },
  { key: 'actions', label: '', defaultWidth: 96, minWidth: 48, locked: true },
]

// ── Milestones page ───────────────────────────────────────────────────────────

export function MilestonesPage() {
  const { project } = useAppContext()
  const { startResize, styleFor } = useColumnLayout(
    MILESTONES_COLUMNS,
    STORAGE_KEYS.MILESTONES_COLUMNS,
  )
  const { can } = useProjectPermissions(project?.projectId)
  const canManage = can('milestone:manage')
  const { data: milestones, isLoading, error } = useMilestones(project?.projectId)
  const deleteMilestone = useDeleteMilestone()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!milestones) return []
    const q = search.toLowerCase()
    return milestones.filter(
      (m) => m.name.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q),
    )
  }, [milestones, search])

  async function handleDelete(id: string) {
    try {
      await deleteMilestone.mutateAsync(id)
      toast.success('Milestone deleted')
      setDeleting(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
        <AlertTriangle size={32} style={{ color: BRAND.danger }} />
        <p className="text-sm" style={{ color: BRAND.textSecondary }}>
          {error instanceof Error ? error.message : 'Failed to load milestones'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <PageToolbar
        title="Milestones"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search milestones…',
          ariaLabel: 'Search milestones',
          width: 200,
        }}
        actions={
          canManage ? (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white"
              style={{ backgroundColor: BRAND.primary }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = BRAND.primaryHover)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = BRAND.primary)}
            >
              <Plus size={14} />
              New Milestone
            </button>
          ) : undefined
        }
      />

      {/* Table */}
      <div className="flex flex-1 overflow-hidden bg-white">
        {isLoading ? (
          <SkeletonList rows={6} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
            <PackageOpen size={40} style={{ color: BRAND.textFaint }} />
            <p className="text-sm" style={{ color: BRAND.textMuted }}>
              {search ? 'No milestones match your search' : 'No milestones yet'}
            </p>
            {canManage && !search && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white"
                style={{ backgroundColor: BRAND.primary }}
              >
                <Plus size={14} />
                Create Milestone
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {/* Header */}
            <div
              className="flex h-8 shrink-0 items-center px-3 select-none"
              style={{
                backgroundColor: BRAND.surfaceHover,
                borderBottom: `1px solid ${BRAND.border}`,
                minWidth: 'max-content',
              }}
            >
              {MILESTONES_COLUMNS.map((col) => (
                <div
                  key={col.key}
                  className="group relative flex items-center gap-1 px-2 text-[9px] font-semibold tracking-wider whitespace-nowrap uppercase"
                  style={{ ...styleFor(col.key, { flexShrink: 0 }), color: BRAND.textMuted }}
                >
                  <span>{col.label}</span>
                  <ResizeHandle
                    onMouseDown={(e) => startResize(col.key, e)}
                    ariaLabel={`Resize ${col.label} column`}
                  />
                </div>
              ))}
            </div>
            {/* Rows */}
            {filtered.map((ms) => (
              <div
                key={ms.id}
                className="flex h-8 cursor-pointer items-center px-3"
                style={{ borderBottom: `1px solid ${BRAND.borderInner}`, minWidth: 'max-content' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = BRAND.surfaceHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                onClick={() =>
                  navigate({ to: '/milestones/$milestoneId', params: { milestoneId: ms.id } })
                }
              >
                {/* Name */}
                <div className="shrink-0 px-2" style={styleFor('name')}>
                  <span
                    className="block truncate text-xs font-medium"
                    style={{ color: BRAND.textPrimary }}
                  >
                    {ms.name}
                  </span>
                </div>
                {/* Target Start Date */}
                <div
                  className="shrink-0 px-2 text-xs"
                  style={{ ...styleFor('targetStartDate'), color: BRAND.textSecondary }}
                >
                  {ms.targetStartDate ?? '\u2014'}
                </div>
                {/* Target End Date */}
                <div
                  className="shrink-0 px-2 text-xs"
                  style={{ ...styleFor('targetEndDate'), color: BRAND.textSecondary }}
                >
                  {ms.targetEndDate ?? '\u2014'}
                </div>
                {/* Status */}
                <div className="shrink-0 px-2" style={styleFor('status')}>
                  <StatusBadge status={ms.status} />
                </div>
                {/* Actions */}
                <div className="shrink-0 px-2" style={styleFor('actions')}>
                  {canManage && (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setEditing(ms)}
                        className="rounded p-1 hover:bg-gray-100"
                        title="Edit"
                      >
                        <Pencil size={13} style={{ color: BRAND.textSecondary }} />
                      </button>
                      {deleting === ms.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              void handleDelete(ms.id)
                            }}
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: BRAND.dangerBg,
                              color: BRAND.danger,
                              border: `1px solid ${BRAND.dangerBorder}`,
                            }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleting(null)}
                            className="rounded px-1.5 py-0.5 text-[10px]"
                            style={{
                              border: `1px solid ${BRAND.border}`,
                              color: BRAND.textSecondary,
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleting(ms.id)}
                          className="rounded p-1 hover:bg-red-50"
                          title="Delete"
                        >
                          <Trash2 size={13} style={{ color: BRAND.danger }} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateMilestoneModal
          projectId={project?.projectId ?? ''}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editing && <EditMilestoneModal milestone={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
