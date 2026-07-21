import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Archive,
  Edit3,
  FolderKanban,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Users,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { formatDate } from '@/shared/lib/utils'
import { SearchInput } from '@/shared/ui/search-input'
import { EmptyState } from '@/shared/ui/empty-state'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { TeamCell } from '@/shared/ui/team-cell'
import { KeyChip } from '@/shared/ui/key-chip'
import { StatusBadge } from '@/shared/ui/status-badge'
import { PROJECT_STATUS_STYLE } from '@/features/projects/status-colors'
import { DataTableHeader } from '@/shared/ui/data-table-header'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { useDataTable, type ColumnSpec } from '@/shared/ui/table'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useProjects, useUpdateProject, useCreateProject } from '@/features/projects/api'
import type { Project } from '@/features/projects/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import {
  useWorkspaceTeams,
  useProjectTeams,
  useLinkProjectTeam,
  useUnlinkProjectTeam,
} from '@/features/teams/api'

/** Extract a human-readable message from an API error response. */
function parseApiError(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'An unexpected error occurred'
}

// ── Archive Confirmation modal ───────────────────────────────────────────────
// BA SRS UC-PRJ-03: UI must warn about impact and require confirming project key.

function ArchiveConfirmModal({
  project,
  onConfirm,
  onClose,
  isPending,
}: {
  project: Project
  onConfirm: () => void
  onClose: () => void
  isPending: boolean
}) {
  const [typed, setTyped] = useState('')
  const confirmed = typed.trim().toUpperCase() === project.key.toUpperCase()

  return (
    <AppModal open onClose={onClose} title="Archive project" width={440}>
      {/* Danger header band */}
      <div
        className="flex items-center gap-3 px-5 py-3"
        style={{ backgroundColor: BRAND.dangerBg, borderBottom: `1px solid ${BRAND.dangerBorder}` }}
      >
        <AlertTriangle size={16} style={{ color: BRAND.danger, flexShrink: 0 }} />
        <p className="text-[11px]" style={{ color: BRAND.danger }}>
          This project will become read-only. Work items and iterations will still be visible.
        </p>
      </div>

      <ModalBody className="space-y-4">
        {/* Impact summary */}
        <div
          className="rounded p-3 text-[11px]"
          style={{
            backgroundColor: BRAND.surfaceSubtle,
            border: `1px solid ${BRAND.borderSubtle}`,
          }}
        >
          <p className="font-semibold" style={{ color: BRAND.textPrimary }}>
            What will happen:
          </p>
          <ul className="mt-1.5 space-y-0.5" style={{ color: BRAND.textSecondary }}>
            <li>
              · Project status changes to <strong>Archived</strong>
            </li>
            <li>· No new work items, iterations, or releases can be created</li>
            <li>· Existing data remains accessible in read-only mode</li>
            <li>· The project will be hidden from the Active filter</li>
          </ul>
        </div>

        {/* Key confirmation */}
        <FormField
          label={
            <>
              Type{' '}
              <span className="font-mono font-bold" style={{ color: BRAND.textPrimary }}>
                {project.key}
              </span>{' '}
              to confirm
            </>
          }
        >
          <Input
            autoFocus
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={project.key}
            className="font-mono"
            style={{ borderColor: confirmed ? BRAND.dangerBorder : undefined }}
          />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          type="button"
          onClick={onConfirm}
          disabled={!confirmed || isPending}
        >
          {isPending && <Loader2 size={12} className="animate-spin" />}
          Archive project
        </Button>
      </ModalFooter>
    </AppModal>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function ProjectStatusBadge({ status }: { status: 'active' | 'archived' }) {
  return <StatusBadge style={PROJECT_STATUS_STYLE[status]} />
}

// ── Owner (project lead) picker ──────────────────────────────────────────────
// Shared by the New Project and Edit Project modals. Backed by the single-source
// workspace-member roster (useWorkspaceMembers) so the owner list never drifts.

function OwnerSelect({
  workspaceId,
  value,
  onChange,
  currentUserId,
}: {
  workspaceId: string
  value: string
  onChange: (userId: string) => void
  currentUserId?: string
}) {
  const { data: members = [], isLoading } = useWorkspaceMembers(workspaceId)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={isLoading || members.length === 0}
      className="w-full rounded border border-input bg-input-background px-3 py-2 text-[12px] outline-none focus:ring-2"
      style={{ color: BRAND.textPrimary }}
    >
      {members.length === 0 && <option value="">{isLoading ? 'Loading…' : '—'}</option>}
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {(m.displayName || m.email || m.userId) + (m.userId === currentUserId ? ' (you)' : '')}
        </option>
      ))}
    </select>
  )
}

// Reusable teams multi-select — links teams to a project on creation.
function TeamMultiSelect({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string
  value: string[]
  onChange: (teamIds: string[]) => void
}) {
  const { data: teams = [], isLoading } = useWorkspaceTeams(workspaceId)
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((t) => t !== id) : [...value, id])
  }
  if (isLoading)
    return (
      <div className="text-[12px]" style={{ color: BRAND.textMuted }}>
        Loading…
      </div>
    )
  if (teams.length === 0)
    return (
      <div className="text-[12px]" style={{ color: BRAND.textMuted }}>
        No teams in this workspace yet.
      </div>
    )
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px]" style={{ color: BRAND.textMuted }}>
          A team can be linked to multiple projects.
        </span>
        <span className="text-[11px] font-medium" style={{ color: BRAND.textSecondary }}>
          {value.length} selected
        </span>
      </div>
      <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded border border-input bg-input-background p-2">
        {teams.map((t) => {
          const checked = value.includes(t.id)
          return (
            <label
              key={t.id}
              className="flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 text-[12px] transition-colors"
              style={{
                borderColor: checked ? BRAND.primary : BRAND.border,
                backgroundColor: checked ? BRAND.primaryLighter : BRAND.surface,
                color: BRAND.textPrimary,
              }}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(t.id)} />
              <UsersRound size={12} style={{ color: BRAND.textMuted }} />
              <span className="truncate">{t.name}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ── Shared project form ──────────────────────────────────────────────────────
// Single source of truth for the create/edit field layout (BA design). The two
// modals own their state + submit logic (create vs update+team-diff) and share
// this presentational body so both stay in lockstep.

interface ProjectFormValues {
  name: string
  key: string
  description: string
  leadId: string
  startDate: string
  teamIds: string[]
}

function ProjectFormFields({
  workspaceId,
  values,
  onPatch,
  keyEditable,
  currentUserId,
  autoFocusName,
}: {
  workspaceId: string
  values: ProjectFormValues
  onPatch: (patch: Partial<ProjectFormValues>) => void
  keyEditable: boolean
  currentUserId?: string
  autoFocusName?: boolean
}) {
  return (
    <>
      <div className="grid grid-cols-[1fr_9rem] gap-3">
        <FormField label="Project Name" required>
          <Input
            autoFocus={autoFocusName}
            type="text"
            value={values.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="e.g. NX Platform"
            required
          />
        </FormField>
        <FormField
          label="Project Key"
          required={keyEditable}
          hint={keyEditable ? '2–6 letters' : 'Immutable'}
        >
          <Input
            type="text"
            value={values.key}
            disabled={!keyEditable}
            readOnly={!keyEditable}
            onChange={
              keyEditable
                ? (e) =>
                    onPatch({
                      key: e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, '')
                        .slice(0, 6),
                    })
                : undefined
            }
            placeholder="NXP"
            required={keyEditable}
            className="font-mono"
          />
        </FormField>
      </div>
      <FormField label="Description">
        <Textarea
          value={values.description}
          onChange={(e) => onPatch({ description: e.target.value })}
          placeholder="Brief description of this project…"
          rows={3}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Project Owner" required>
          <OwnerSelect
            workspaceId={workspaceId}
            value={values.leadId}
            onChange={(leadId) => onPatch({ leadId })}
            currentUserId={currentUserId}
          />
        </FormField>
        <FormField label="Start Date">
          <Input
            type="date"
            value={values.startDate}
            onChange={(e) => onPatch({ startDate: e.target.value })}
          />
        </FormField>
      </div>
      <FormField label="Teams">
        <TeamMultiSelect
          workspaceId={workspaceId}
          value={values.teamIds}
          onChange={(teamIds) => onPatch({ teamIds })}
        />
      </FormField>
    </>
  )
}

// ── Edit Project modal ───────────────────────────────────────────────────────

function EditProjectModal({
  project,
  workspaceId,
  onClose,
}: {
  project: Project
  workspaceId: string
  onClose: () => void
}) {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const { data: linkedTeams = [], isLoading: teamsLoading } = useProjectTeams(project.id)

  const [values, setValues] = useState<ProjectFormValues>({
    name: project.name,
    key: project.key,
    description: project.description ?? '',
    leadId: project.leadId ?? '',
    startDate: project.startDate ?? '',
    teamIds: [],
  })
  // Seed the team selection once the linked teams load (during render, not in
  // an effect), then diff against this original set on save.
  const [seeded, setSeeded] = useState(false)
  if (!teamsLoading && !seeded) {
    setSeeded(true)
    setValues((v) => ({ ...v, teamIds: linkedTeams.map((t) => t.id) }))
  }
  function patch(p: Partial<ProjectFormValues>) {
    setValues((v) => ({ ...v, ...p }))
  }

  const { mutateAsync, isPending } = useUpdateProject(workspaceId)
  const linkTeam = useLinkProjectTeam(project.id)
  const unlinkTeam = useUnlinkProjectTeam(project.id)
  const saving = isPending || linkTeam.isPending || unlinkTeam.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!values.name.trim()) return
    try {
      await mutateAsync({
        id: project.id,
        input: {
          name: values.name.trim(),
          description: values.description.trim() || undefined,
          leadId: values.leadId || null,
          startDate: values.startDate || null,
        },
      })
      // Diff team links against the originally-loaded set.
      const original = new Set(linkedTeams.map((t) => t.id))
      const next = new Set(values.teamIds)
      const toAdd = values.teamIds.filter((id) => !original.has(id))
      const toRemove = [...original].filter((id) => !next.has(id))
      await Promise.all([
        ...toAdd.map((id) => linkTeam.mutateAsync(id)),
        ...toRemove.map((id) => unlinkTeam.mutateAsync(id)),
      ])
      if (toAdd.length || toRemove.length) {
        void qc.invalidateQueries({ queryKey: ['projects', workspaceId] })
      }
      toast.success(`Project "${values.name}" updated`)
      onClose()
    } catch (err) {
      const msg = parseApiError(err)
      toast.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title="Edit Project" width={560}>
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          <ProjectFormFields
            workspaceId={workspaceId}
            values={values}
            onPatch={patch}
            keyEditable={false}
            currentUserId={user?.id}
            autoFocusName
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !values.name.trim()}>
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save Changes
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── New Project modal ─────────────────────────────────────────────────────────

function NewProjectModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { user } = useAuthStore()
  const [values, setValues] = useState<ProjectFormValues>({
    name: '',
    key: '',
    description: '',
    leadId: user?.id ?? '',
    startDate: '',
    teamIds: [],
  })
  const { mutateAsync, isPending } = useCreateProject()

  const autoKey = (n: string) =>
    n
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4)

  function patch(p: Partial<ProjectFormValues>) {
    setValues((v) => {
      const next = { ...v, ...p }
      // Auto-derive the key from the name while the user hasn't customised it.
      if (p.name !== undefined && (!v.key || v.key === autoKey(v.name))) {
        next.key = autoKey(p.name)
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedKey = values.key.trim().toUpperCase()
    if (!values.name.trim() || !trimmedKey) return
    if (trimmedKey.length < 2) {
      toast.error('Project key must be at least 2 characters')
      return
    }
    try {
      await mutateAsync({
        workspaceId,
        name: values.name.trim(),
        key: trimmedKey,
        description: values.description.trim() || undefined,
        leadId: values.leadId || user?.id,
        startDate: values.startDate || undefined,
        teamIds: values.teamIds.length > 0 ? values.teamIds : undefined,
      })
      toast.success(`Project "${values.name}" created`)
      onClose()
    } catch (err) {
      const msg = parseApiError(err)
      toast.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title="New Project" width={560}>
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          <ProjectFormFields
            workspaceId={workspaceId}
            values={values}
            onPatch={patch}
            keyEditable
            currentUserId={user?.id}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || !values.name.trim() || !values.key.trim()}>
            {isPending && <Loader2 size={12} className="animate-spin" />}
            Create Project
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Teams cell (linked team names, one per line) ─────────────────────────────

function ProjectTeamsCell({ projectId, teamCount }: { projectId: string; teamCount: number }) {
  // Only fetch team names for rows that actually have linked teams.
  const { data: teams = [] } = useProjectTeams(teamCount > 0 ? projectId : undefined)

  if (teamCount === 0) {
    return (
      <span className="text-[11px]" style={{ color: BRAND.textMuted }}>
        —
      </span>
    )
  }

  // Names still loading — show a compact count placeholder.
  if (teams.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px]"
        style={{ color: BRAND.textSecondary }}
      >
        <UsersRound size={11} style={{ color: BRAND.textMuted }} />
        {teamCount}
      </span>
    )
  }

  // Every linked team on its own line (row grows to fit).
  return (
    <div className="flex w-full flex-col gap-1 py-1">
      {teams.map((t) => (
        <TeamCell key={t.id} teamKey={t.key} name={t.name} className="self-start" />
      ))}
    </div>
  )
}

// ── Table columns (shared useDataTable engine) ───────────────────────────────

type ProjectColKey =
  'key' | 'name' | 'status' | 'owner' | 'teams' | 'members' | 'startDate' | 'updated' | 'actions'

/** Per-render context handed to each column cell (lookups + row callbacks). */
interface ProjectCtx {
  currentUserId?: string
  currentUserName?: string
  openMenu: string | null
  setOpenMenu: (id: string | null) => void
  onEdit: (project: Project) => void
  onToggleArchive: (project: Project) => void
}

/** Row actions dropdown — page-local interactivity kept out of the column spec. */
function ProjectActionsCell({ project, ctx }: { project: Project; ctx: ProjectCtx }) {
  const { openMenu, setOpenMenu, onEdit, onToggleArchive } = ctx
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpenMenu(openMenu === project.id ? null : project.id)}
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-avatar"
        style={{ color: BRAND.textMuted }}
        aria-label="Project actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {openMenu === project.id && (
        <div
          className="absolute top-7 right-0 z-20 w-44 overflow-hidden rounded bg-white py-1 shadow-lg"
          style={{ border: `1px solid ${BRAND.border}` }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-[11px] hover:bg-surface-subtle"
            style={{ color: BRAND.textPrimary }}
            onClick={() => {
              onEdit(project)
              setOpenMenu(null)
            }}
          >
            <Edit3 size={12} style={{ color: BRAND.textSecondary }} />
            Edit project
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-[11px] hover:bg-surface-subtle"
            style={{ color: project.status === 'active' ? BRAND.danger : BRAND.textPrimary }}
            onClick={() => onToggleArchive(project)}
          >
            {project.status === 'active' ? (
              <Archive size={12} style={{ color: BRAND.danger }} />
            ) : (
              <RotateCcw size={12} style={{ color: BRAND.textSecondary }} />
            )}
            {project.status === 'active' ? 'Archive project' : 'Restore project'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Single per-column source of truth. The shared {@link useDataTable} engine
 * derives the header, resize / reorder / show-hide behaviour and body cells
 * from this array — identical to the Backlog / Quality / Team-Status grids.
 */
const PROJECT_COLUMNS: ColumnSpec<Project, ProjectCtx, ProjectColKey>[] = [
  {
    key: 'key',
    label: 'Key',
    sortCol: 'key',
    defaultWidth: 76,
    minWidth: 60,
    locked: true,
    cellClassName: 'flex items-center',
    cell: (p) => <KeyChip>{p.key}</KeyChip>,
  },
  {
    key: 'name',
    label: 'Project',
    sortCol: 'name',
    defaultWidth: 280,
    minWidth: 160,
    locked: true,
    cellClassName: 'flex min-w-0 flex-col justify-center',
    cell: (p) => (
      <>
        <div className="truncate text-[12px] font-semibold" style={{ color: BRAND.textPrimary }}>
          {p.name}
        </div>
        {p.description && (
          <div className="truncate text-[10px]" style={{ color: BRAND.textMuted }}>
            {p.description}
          </div>
        )}
      </>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    sortCol: 'status',
    defaultWidth: 96,
    minWidth: 80,
    cellClassName: 'flex items-center',
    cell: (p) => <ProjectStatusBadge status={p.status} />,
  },
  {
    key: 'owner',
    label: 'Owner',
    defaultWidth: 140,
    minWidth: 90,
    cellClassName: 'flex items-center',
    cell: (p, ctx) => (
      <OwnerCell
        name={
          p.leadId
            ? (p.leadName ?? (p.leadId === ctx.currentUserId ? ctx.currentUserName : null))
            : null
        }
      />
    ),
  },
  {
    key: 'teams',
    label: 'Teams',
    defaultWidth: 190,
    minWidth: 120,
    cellClassName: 'flex items-center',
    cell: (p) => <ProjectTeamsCell projectId={p.id} teamCount={p.teamCount} />,
  },
  {
    key: 'members',
    label: 'Members',
    sortCol: 'members',
    defaultWidth: 96,
    minWidth: 70,
    cellClassName: 'flex items-center text-[11px]',
    cell: (p) =>
      p.memberCount > 0 ? (
        <span className="inline-flex items-center gap-1" style={{ color: BRAND.textSecondary }}>
          <Users size={11} style={{ color: BRAND.textMuted }} />
          {p.memberCount}
        </span>
      ) : (
        <span style={{ color: BRAND.textMuted }}>—</span>
      ),
  },
  {
    key: 'startDate',
    label: 'Start Date',
    sortCol: 'startDate',
    defaultWidth: 116,
    minWidth: 90,
    cellClassName: 'flex items-center text-[11px]',
    cell: (p) =>
      p.startDate ? (
        <span style={{ color: BRAND.textSecondary }}>{formatDate(p.startDate)}</span>
      ) : (
        <span style={{ color: BRAND.textMuted }}>—</span>
      ),
  },
  {
    key: 'updated',
    label: 'Updated',
    sortCol: 'updated',
    defaultWidth: 128,
    minWidth: 100,
    cellClassName: 'flex items-center text-[11px]',
    cell: (p) => <span style={{ color: BRAND.textSecondary }}>{formatDate(p.updatedAt)}</span>,
  },
  {
    key: 'actions',
    label: '',
    defaultWidth: 52,
    minWidth: 52,
    locked: true,
    cellClassName: 'flex items-center justify-end',
    cell: (p, ctx) => <ProjectActionsCell project={p} ctx={ctx} />,
  },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { workspace } = useAppContext()
  const workspaceId = workspace?.workspaceId
  const { user: currentUser } = useAuthStore()

  const { data: projects = [], isLoading } = useProjects(workspaceId)
  const updateProject = useUpdateProject(workspaceId)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'All' | 'active' | 'archived'>('active')
  const [pageSize, setPageSize] = useState(25)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortCol(col)
        setSortDir('asc')
      }
    },
    [sortCol],
  )

  // Shared table engine: header + resize / reorder / show-hide + click-to-sort,
  // persisted per-user. Rows stay page-owned (row-click, actions menu).
  const table = useDataTable<Project, ProjectCtx, ProjectColKey>(PROJECT_COLUMNS, {
    storageKey: STORAGE_KEYS.PROJECTS_COLUMNS,
    sort: { col: sortCol, dir: sortDir, onSort: handleSort },
  })

  // Close dropdown on outside click
  useEffect(() => {
    if (!openMenu) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openMenu])
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [archivingProject, setArchivingProject] = useState<Project | null>(null)

  const filtered = useMemo(
    () =>
      projects.filter(
        (p) =>
          (filter === 'All' || p.status === filter) &&
          (p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.key.toLowerCase().includes(search.toLowerCase())),
      ),
    [projects, filter, search],
  )

  // Client-side sort over the filtered set (the projects list is fully loaded).
  const sorted = useMemo(() => {
    if (!sortCol) return filtered
    const dir = sortDir === 'asc' ? 1 : -1
    const keyOf = (p: Project): string | number => {
      switch (sortCol) {
        case 'key':
          return p.key.toLowerCase()
        case 'name':
          return p.name.toLowerCase()
        case 'status':
          return p.status
        case 'members':
          return p.memberCount
        case 'startDate':
          return p.startDate ?? ''
        case 'updated':
          return p.updatedAt
        default:
          return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const av = keyOf(a)
      const bv = keyOf(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [filtered, sortCol, sortDir])

  // Client-side pagination over the sorted set. Reset to page 1 (during render,
  // not in an effect) whenever the filtered shape changes so the visible range
  // never lands past the last page.
  const resetKey = `${search}|${filter}|${pageSize}`
  const [prevResetKey, setPrevResetKey] = useState(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    setCurrentPage(1)
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(currentPage, pageCount)
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function toggleArchive(project: Project) {
    if (project.status === 'active') {
      // Archive requires confirmation (BA SRS UC-PRJ-03)
      setArchivingProject(project)
      setOpenMenu(null)
      return
    }
    // Restore doesn't need confirmation
    try {
      await updateProject.mutateAsync({ id: project.id, input: { status: 'active' } })
      toast.success(`"${project.name}" restored`)
    } catch (err) {
      const msg = parseApiError(err)
      toast.error(msg)
    }
    setOpenMenu(null)
  }

  async function confirmArchive() {
    if (!archivingProject) return
    try {
      await updateProject.mutateAsync({ id: archivingProject.id, input: { status: 'archived' } })
      toast.success(`"${archivingProject.name}" archived`)
      setArchivingProject(null)
    } catch (err) {
      const msg = parseApiError(err)
      toast.error(msg)
    }
  }

  const activeCount = projects.filter((p) => p.status === 'active').length

  const stats = {
    total: projects.length,
    active: activeCount,
    archived: projects.filter((p) => p.status === 'archived').length,
    linkedTeams: projects.reduce((sum, p) => sum + (p.teamCount ?? 0), 0),
  }

  const cellCtx: ProjectCtx = {
    currentUserId: currentUser?.id,
    currentUserName: currentUser?.displayName,
    openMenu,
    setOpenMenu,
    onEdit: setEditingProject,
    onToggleArchive: (p) => void toggleArchive(p),
  }
  return (
    <div className="flex flex-1 flex-col" style={{ backgroundColor: BRAND.pageBg }}>
      {showNewModal && workspaceId && (
        <NewProjectModal workspaceId={workspaceId} onClose={() => setShowNewModal(false)} />
      )}
      {editingProject && workspaceId && (
        <EditProjectModal
          project={editingProject}
          workspaceId={workspaceId}
          onClose={() => setEditingProject(null)}
        />
      )}
      {archivingProject && (
        <ArchiveConfirmModal
          project={archivingProject}
          onConfirm={() => void confirmArchive()}
          onClose={() => setArchivingProject(null)}
          isPending={updateProject.isPending}
        />
      )}

      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between bg-white px-6 py-3"
        style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
      >
        <div>
          <h1 className="text-[14px] font-semibold" style={{ color: BRAND.textPrimary }}>
            Projects
          </h1>
          <p className="text-[11px]" style={{ color: BRAND.textMuted }}>
            {workspace?.workspaceName ?? 'Workspace'} · {activeCount} active{' '}
            {activeCount === 1 ? 'project' : 'projects'}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNewModal(true)}>
          <Plus size={13} />
          New Project
        </Button>
      </div>

      {/* Summary metric strip */}
      <MetricStrip>
        <MetricCard label="Total" value={stats.total} minWidth={80} />
        <MetricCard
          label="Active"
          value={stats.active}
          valueColor={BRAND.primaryLight}
          minWidth={80}
        />
        <MetricCard label="Archived" value={stats.archived} minWidth={90} />
        <MetricCard label="Linked Teams" value={stats.linkedTeams} minWidth={110} />
      </MetricStrip>

      {/* Toolbar */}
      <div
        className="flex shrink-0 items-center gap-3 bg-white px-6 py-2"
        style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
      >
        {/* Search */}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search projects…"
          ariaLabel="Search projects"
          iconSize={13}
          className="w-52 py-1.5 pl-8"
        />

        {/* Status filter tabs */}
        <div className="flex items-center gap-1">
          {(['All', 'active', 'archived'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className="rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors"
              style={{
                backgroundColor: filter === tab ? BRAND.primaryLighter : 'transparent',
                color: filter === tab ? BRAND.primary : BRAND.textSecondary,
              }}
            >
              {tab === 'All' ? 'All' : tab === 'active' ? 'Active' : 'Archived'}
            </button>
          ))}
        </div>

        {/* Column show/hide + reorder (shared engine) */}
        <div className="ml-auto">
          <ColumnFieldsMenu {...table.fieldsMenuProps} />
        </div>
      </div>

      {/* Table */}
      <div className="p-4">
        <div
          className="overflow-hidden rounded bg-white"
          style={{ border: `1px solid ${BRAND.borderSubtle}` }}
        >
          {/* Horizontal-scroll region: shared header + page-owned rows */}
          <div className="overflow-x-auto">
            <div style={{ width: table.tableWidth, minWidth: '100%' }}>
              {/* Table header (shared engine: resize / reorder / sort) */}
              <DataTableHeader {...table.headerProps} className="gap-2 px-3" />

              {/* Loading state */}
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={22} className="animate-spin" style={{ color: BRAND.textMuted }} />
                </div>
              )}

              {/* Empty state */}
              {!isLoading && filtered.length === 0 && (
                <EmptyState
                  icon={
                    <FolderKanban
                      size={32}
                      strokeWidth={1.25}
                      className="text-foreground-subtle opacity-40"
                    />
                  }
                  title="No projects found"
                  description="Try adjusting your search or filter."
                />
              )}

              {/* Rows */}
              <div ref={menuRef}>
                {!isLoading &&
                  paged.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => setEditingProject(project)}
                      className="flex min-h-12 cursor-pointer items-center gap-2 px-3 transition-colors hover:bg-surface-hover"
                      style={{
                        borderBottom: `1px solid ${BRAND.borderInner}`,
                        opacity: project.status === 'archived' ? 0.7 : 1,
                        minWidth: 'max-content',
                      }}
                    >
                      {table.renderCells(project, cellCtx)}
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Pagination footer */}
          {!isLoading && filtered.length > 0 && (
            <PaginationFooter
              pageSize={pageSize}
              setPageSize={setPageSize}
              currentPage={safePage}
              rangeStart={(safePage - 1) * pageSize + 1}
              rangeEnd={(safePage - 1) * pageSize + paged.length}
              total={filtered.length}
              pageCount={pageCount}
              hasPrevPage={safePage > 1}
              hasNextPage={safePage < pageCount}
              onPrevPage={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
            />
          )}
        </div>
      </div>
    </div>
  )
}
