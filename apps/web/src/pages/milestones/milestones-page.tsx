/**
 * Milestones — P3.3
 *
 * Lists milestones for the active project. Milestones live under
 * Plan > Timeboxes alongside Iterations and Releases.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, Plus, Pencil, Trash2, PackageOpen } from 'lucide-react'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { StatusBadge as StatusPill } from '@/shared/ui/status-badge'
import { MILESTONE_STATUS_STYLE } from '@/features/milestones/status-colors'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { DataTableFrame, useDataTable, type ColumnSpec } from '@/shared/ui/table'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { cn } from '@/shared/lib/utils'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { EmptyState } from '@/shared/ui/empty-state'
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
  const { t } = useTranslation('milestones')
  return (
    <>
      <FormField label={t('form.nameLabel')} required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q4 Release Candidate"
          autoFocus
        />
      </FormField>
      <FormField label={t('common:status')}>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
          className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground"
        >
          {MILESTONE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_STYLE[s].label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label={t('common:description')}>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Milestone description..."
          rows={2}
        />
      </FormField>
      <FormField label={t('form.notesLabel')}>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes..."
          rows={2}
        />
      </FormField>
      <FormField label={t('common:owner')}>
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="w-full rounded-md border border-border-strong px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">{t('form.unassigned')}</option>
          {(members ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName ?? m.email}
            </option>
          ))}
        </select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('form.targetStart')}>
          <div
            className={cn(
              'w-full rounded-md border border-border-strong bg-surface-subtle px-3 py-1.5 text-sm',
              targetStartDate ? 'text-foreground' : 'text-foreground-subtle',
            )}
          >
            {targetStartDate || t('form.notSet')}
          </div>
          <p className="mt-0.5 text-ui-xs text-foreground-subtle">
            {t('form.derivedFromReleases')}
          </p>
        </FormField>
        <FormField label={t('form.targetEnd')}>
          <div
            className={cn(
              'w-full rounded-md border border-border-strong bg-surface-subtle px-3 py-1.5 text-sm',
              targetEndDate ? 'text-foreground' : 'text-foreground-subtle',
            )}
          >
            {targetEndDate || t('form.notSet')}
          </div>
          <p className="mt-0.5 text-ui-xs text-foreground-subtle">
            {t('form.derivedFromReleases')}
          </p>
        </FormField>
      </div>
      <FormField label={t('form.associatedReleases')}>
        <div className="flex max-h-32 flex-col gap-1.5 overflow-y-auto rounded-md border border-border-strong p-2">
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
            <span className="text-xs text-foreground-subtle">{t('form.noReleases')}</span>
          )}
        </div>
      </FormField>
    </>
  )
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateMilestoneModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation('milestones')
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
      toast.success(t('create.created', { name }))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('create.createFailed'))
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('create.title')} width={480}>
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
            {t('common:cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? t('create.creating') : t('create.createButton')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditMilestoneModal({ milestone, onClose }: { milestone: Milestone; onClose: () => void }) {
  const { t } = useTranslation('milestones')
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
      toast.success(t('edit.updated'))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('edit.updateFailed'))
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('edit.title')} width={480}>
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
            {t('common:cancel')}
          </Button>
          <Button type="submit" disabled={update.isPending || !name.trim()}>
            {update.isPending ? t('edit.saving') : t('common:save')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Table columns (shared useDataTable engine) ───────────────────────────────

type MilestoneColKey = 'name' | 'targetStartDate' | 'targetEndDate' | 'status' | 'actions'

/** Per-render context handed to each cell (permissions + row callbacks). */
interface MilestoneCtx {
  canManage: boolean
  onEdit: (m: Milestone) => void
  onAskDelete: (id: string) => void
}

/** Row actions cell — edit + delete (delete opens the shared ConfirmDialog). */
function MilestoneActionsCell({ milestone, ctx }: { milestone: Milestone; ctx: MilestoneCtx }) {
  if (!ctx.canManage) return null
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <IconButton aria-label="Edit" title="Edit" onClick={() => ctx.onEdit(milestone)}>
        <Pencil size={13} />
      </IconButton>
      <IconButton
        variant="destructive"
        aria-label="Delete"
        title="Delete"
        onClick={() => ctx.onAskDelete(milestone.id)}
      >
        <Trash2 size={13} />
      </IconButton>
    </div>
  )
}

/**
 * Single per-column source of truth. The shared {@link useDataTable} engine
 * derives the header, resize / reorder / show-hide behaviour and body cells
 * from this array — identical to the Projects / Quality grids.
 */
const MILESTONES_COLUMNS: ColumnSpec<Milestone, MilestoneCtx, MilestoneColKey>[] = [
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 260,
    minWidth: 120,
    locked: true,
    cellClassName: 'flex min-w-0 items-center',
    cell: (m) => (
      <span className="block truncate text-xs font-medium text-foreground">{m.name}</span>
    ),
  },
  {
    key: 'targetStartDate',
    label: 'Target Start Date',
    defaultWidth: 120,
    minWidth: 90,
    cellClassName: 'flex items-center text-xs text-muted-foreground',
    cell: (m) => m.targetStartDate ?? '—',
  },
  {
    key: 'targetEndDate',
    label: 'Target End Date',
    defaultWidth: 120,
    minWidth: 90,
    cellClassName: 'flex items-center text-xs text-muted-foreground',
    cell: (m) => m.targetEndDate ?? '—',
  },
  {
    key: 'status',
    label: 'Status',
    defaultWidth: 100,
    minWidth: 70,
    cellClassName: 'flex items-center',
    cell: (m) => <StatusBadge status={m.status} />,
  },
  {
    key: 'actions',
    label: '',
    defaultWidth: 96,
    minWidth: 48,
    locked: true,
    cellClassName: 'flex items-center justify-end',
    cell: (m, ctx) => <MilestoneActionsCell milestone={m} ctx={ctx} />,
  },
]

// ── Milestones page ───────────────────────────────────────────────────────────

export function MilestonesPage() {
  const { t } = useTranslation('milestones')
  const { project } = useAppContext()
  const table = useDataTable<Milestone, MilestoneCtx, MilestoneColKey>(MILESTONES_COLUMNS, {
    storageKey: STORAGE_KEYS.MILESTONES_COLUMNS,
  })
  const { can } = useProjectPermissions(project?.projectId)
  const canManage = can('milestone:create') || can('milestone:edit') || can('milestone:delete')
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
      toast.success(t('delete.deleted'))
      setDeleting(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('delete.deleteFailed'))
    }
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
        <AlertTriangle size={32} className="text-destructive" />
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : t('loadError')}
        </p>
      </div>
    )
  }

  const cellCtx: MilestoneCtx = {
    canManage,
    onEdit: setEditing,
    onAskDelete: setDeleting,
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <PageToolbar
        title={t('title')}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search milestones…',
          ariaLabel: 'Search milestones',
          width: 200,
        }}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={14} />
              {t('createButton')}
            </Button>
          ) : undefined
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* Table — shared DataTableFrame owns the chrome (read-only list kind:
          sortable header, no totals / selection / drag gutter). */}
      <DataTableFrame
        header={table.headerProps}
        padClassName="gap-2 px-3"
        loading={isLoading}
        skeleton={{ rows: 6 }}
        empty={
          filtered.length === 0 ? (
            <EmptyState
              className="flex-1"
              icon={<PackageOpen size={40} className="text-foreground-faint" />}
              title={search ? t('emptySearch') : t('empty')}
              action={
                canManage && !search ? (
                  <Button size="sm" onClick={() => setShowCreate(true)}>
                    <Plus size={14} />
                    {t('createMilestone')}
                  </Button>
                ) : undefined
              }
            />
          ) : undefined
        }
      >
        {filtered.map((ms) => (
          <div
            key={ms.id}
            className="flex min-h-12 cursor-pointer items-center gap-2 border-b border-border-inner px-3 hover:bg-surface-hover"
            style={{ minWidth: 'max-content' }}
            onClick={() =>
              navigate({ to: '/milestones/$milestoneId', params: { milestoneId: ms.id } })
            }
          >
            {table.renderCells(ms, cellCtx)}
          </div>
        ))}
      </DataTableFrame>

      {/* Modals */}
      {showCreate && (
        <CreateMilestoneModal
          projectId={project?.projectId ?? ''}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editing && <EditMilestoneModal milestone={editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={deleting !== null}
        title={t('delete.title')}
        message={t('delete.message')}
        confirmLabel={t('common:delete')}
        destructive
        pending={deleteMilestone.isPending}
        onConfirm={() => deleting && void handleDelete(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
