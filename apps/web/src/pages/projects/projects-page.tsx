import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Edit3,
  FolderKanban,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  User,
  Users,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { SearchInput } from '@/shared/ui/search-input'
import { EmptyState } from '@/shared/ui/empty-state'
import { MetricCard } from '@/shared/ui/metric-card'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useProjects, useUpdateProject, useCreateProject } from '@/features/projects/api'
import type { Project } from '@/features/projects/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'

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
  const active = status === 'active'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold"
      style={{
        color: active ? BRAND.success : BRAND.textSecondary,
        backgroundColor: active ? BRAND.successBg : BRAND.primaryLighter,
        border: `1px solid ${active ? BRAND.successBorder : BRAND.border}`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: active ? BRAND.success : BRAND.textMuted }}
      />
      {active ? 'Active' : 'Archived'}
    </span>
  )
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
  const [name, setName] = useState(project.name)
  const [desc, setDesc] = useState(project.description ?? '')
  const [leadId, setLeadId] = useState(project.leadId ?? '')
  const { mutateAsync, isPending } = useUpdateProject(workspaceId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await mutateAsync({
        id: project.id,
        input: {
          name: name.trim(),
          description: desc.trim() || undefined,
          leadId: leadId || null,
        },
      })
      toast.success(`Project "${name}" updated`)
      onClose()
    } catch (err) {
      const msg = parseApiError(err)
      toast.error(msg)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title="Edit Project"
      subtitle={`Key: ${project.key} · immutable`}
      width={440}
    >
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          <FormField label="Project Name" required>
            <Input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Description">
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
          </FormField>
          <FormField label="Project Owner" hint="The person accountable for this project">
            <OwnerSelect
              workspaceId={workspaceId}
              value={leadId}
              onChange={setLeadId}
              currentUserId={user?.id}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || !name.trim()}>
            {isPending && <Loader2 size={12} className="animate-spin" />}
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
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [desc, setDesc] = useState('')
  const [leadId, setLeadId] = useState(user?.id ?? '')
  const { mutateAsync, isPending } = useCreateProject()

  const autoKey = (n: string) =>
    n
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4)

  function handleNameChange(v: string) {
    setName(v)
    if (!key || key === autoKey(name)) {
      setKey(autoKey(v))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedKey = key.trim().toUpperCase()
    if (!name.trim() || !trimmedKey) return
    if (trimmedKey.length < 2) {
      toast.error('Project key must be at least 2 characters')
      return
    }
    try {
      await mutateAsync({
        workspaceId,
        name: name.trim(),
        key: trimmedKey,
        description: desc.trim() || undefined,
        leadId: leadId || user?.id,
      })
      toast.success(`Project "${name}" created`)
      onClose()
    } catch (err) {
      const msg = parseApiError(err)
      toast.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title="New Project" width={440}>
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          <FormField label="Project Name" required>
            <Input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. NX Platform"
              required
            />
          </FormField>
          <FormField label="Key" required hint="2–6 uppercase letters">
            <Input
              type="text"
              value={key}
              onChange={(e) =>
                setKey(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 6),
                )
              }
              placeholder="NXP"
              required
              className="font-mono"
            />
          </FormField>
          <FormField label="Project Owner" required hint="Defaults to you — change if delegating">
            <OwnerSelect
              workspaceId={workspaceId}
              value={leadId}
              onChange={setLeadId}
              currentUserId={user?.id}
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Brief description of this project…"
              rows={3}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || !name.trim() || !key.trim()}>
            {isPending && <Loader2 size={12} className="animate-spin" />}
            Create Project
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { workspace } = useAppContext()
  const workspaceId = workspace?.workspaceId
  const { user: currentUser } = useAuthStore()

  const { data: projects = [], isLoading } = useProjects(workspaceId)
  const updateProject = useUpdateProject(workspaceId)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'All' | 'active' | 'archived'>('active')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [showNewModal, setShowNewModal] = useState(false)

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

  const filtered = projects.filter(
    (p) =>
      (filter === 'All' || p.status === filter) &&
      (p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.key.toLowerCase().includes(search.toLowerCase())),
  )

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
      </div>

      {/* Table */}
      <div className="p-4">
        <div
          className="overflow-hidden rounded bg-white"
          style={{ border: `1px solid ${BRAND.borderSubtle}` }}
        >
          {/* Table header */}
          <div
            className="flex h-7 items-center gap-3 px-4 select-none"
            style={{
              backgroundColor: BRAND.surfaceHover,
              borderBottom: `1px solid ${BRAND.borderSubtle}`,
            }}
          >
            {(
              [
                ['w-16 shrink-0', 'Key'],
                ['flex-1 min-w-0', 'Project Name'],
                ['w-20 shrink-0', 'Status'],
                ['w-28 shrink-0', 'Lead'],
                ['w-16 shrink-0', 'Members'],
                ['w-16 shrink-0', 'Teams'],
                ['w-36 shrink-0', 'Last Updated'],
                ['w-8 shrink-0', ''],
              ] as [string, string][]
            ).map(([cls, label]) => (
              <div
                key={label}
                className={`${cls} text-[9px] font-semibold tracking-widest uppercase`}
                style={{ color: BRAND.textMuted }}
              >
                {label}
              </div>
            ))}
          </div>

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
              filtered.map((project) => (
                <div
                  key={project.id}
                  className="relative flex h-12 cursor-default items-center gap-3 px-4 transition-colors hover:bg-surface-hover"
                  style={{
                    borderBottom: `1px solid ${BRAND.borderInner}`,
                    opacity: project.status === 'archived' ? 0.7 : 1,
                  }}
                >
                  {/* Key */}
                  <div className="w-16 shrink-0">
                    <span
                      className="inline-flex h-5 items-center rounded-sm px-1.5 font-mono text-[10px] font-semibold"
                      style={{ backgroundColor: BRAND.avatarBg, color: BRAND.primary }}
                    >
                      {project.key}
                    </span>
                  </div>

                  {/* Name + desc */}
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[12px] font-semibold"
                      style={{ color: BRAND.textPrimary }}
                    >
                      {project.name}
                    </div>
                    {project.description && (
                      <div className="truncate text-[10px]" style={{ color: BRAND.textMuted }}>
                        {project.description}
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div className="w-20 shrink-0">
                    <ProjectStatusBadge status={project.status} />
                  </div>

                  {/* Lead */}
                  <div
                    className="flex w-28 shrink-0 items-center gap-1.5 text-[11px]"
                    style={{ color: BRAND.textSecondary }}
                  >
                    {project.leadId ? (
                      <>
                        <User size={11} style={{ color: BRAND.textMuted }} />
                        <span className="truncate">
                          {project.leadName ??
                            (project.leadId === currentUser?.id ? currentUser.displayName : '—')}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: BRAND.textMuted }}>—</span>
                    )}
                  </div>

                  {/* Members */}
                  <div className="w-16 shrink-0 text-[11px]" style={{ color: BRAND.textSecondary }}>
                    {project.memberCount > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Users size={11} style={{ color: BRAND.textMuted }} />
                        {project.memberCount}
                      </span>
                    ) : (
                      <span style={{ color: BRAND.textMuted }}>—</span>
                    )}
                  </div>

                  {/* Teams */}
                  <div className="w-16 shrink-0 text-[11px]" style={{ color: BRAND.textSecondary }}>
                    {project.teamCount > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <UsersRound size={11} style={{ color: BRAND.textMuted }} />
                        {project.teamCount}
                      </span>
                    ) : (
                      <span style={{ color: BRAND.textMuted }}>—</span>
                    )}
                  </div>

                  {/* Updated */}
                  <div className="w-36 shrink-0 text-[11px]" style={{ color: BRAND.textSecondary }}>
                    {new Date(project.updatedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>

                  {/* Row actions */}
                  <div className="relative w-8 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenMenu(openMenu === project.id ? null : project.id)
                      }}
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
                            setEditingProject(project)
                            setOpenMenu(null)
                          }}
                        >
                          <Edit3 size={12} style={{ color: BRAND.textSecondary }} />
                          Edit project
                        </button>
                        <button
                          className="flex w-full items-center gap-2 px-3 py-2 text-[11px] hover:bg-surface-subtle"
                          style={{
                            color: project.status === 'active' ? BRAND.danger : BRAND.textPrimary,
                          }}
                          onClick={() => void toggleArchive(project)}
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
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
