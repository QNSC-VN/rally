/* eslint-disable react-refresh/only-export-components -- PROJECT_COLUMNS is config that must co-locate with the cell renderers it references */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Archive,
  Edit3,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Users,
  UsersRound,
} from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { cn, formatDate } from '@/shared/lib/utils'
import { DateField } from '@/shared/ui/date-field'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { notify, errorMessage } from '@/shared/lib/toast'
import { useCreateProject, useUpdateProject, type Project } from '@/features/projects/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import {
  useWorkspaceTeams,
  useProjectTeams,
  useLinkProjectTeam,
  useUnlinkProjectTeam,
} from '@/features/teams/api'
import { PROJECT_STATUS_STYLE } from '@/features/projects/status-colors'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { KeyChip } from '@/shared/ui/key-chip'
import { OwnerCell, OwnerAvatar } from '@/shared/ui/owner-cell'
import { TeamCell } from '@/shared/ui/team-cell'
import { StatusBadge } from '@/shared/ui/status-badge'
import { type ColumnSpec } from '@/shared/ui/table'
import { type ProjectColKey, type ProjectCtx } from '../model/columns'

export function ArchiveConfirmModal({
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
  const { t } = useTranslation('projects')
  const [typed, setTyped] = useState('')
  const confirmed = typed.trim().toUpperCase() === project.key.toUpperCase()

  return (
    <AppModal open onClose={onClose} title={t('actions.archive')} width={440}>
      {/* Danger header band */}
      <div className="flex items-center gap-3 border-b border-destructive-border bg-destructive-bg px-5 py-3">
        <AlertTriangle size={16} className="text-destructive" style={{ flexShrink: 0 }} />
        <p className="text-ui-sm text-destructive">{t('archive.warning')}</p>
      </div>

      <ModalBody className="space-y-4">
        {/* Impact summary */}
        <div className="rounded border border-border-subtle bg-surface-subtle p-3 text-ui-sm">
          <p className="font-semibold text-foreground">{t('archive.whatWillHappen')}</p>
          <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
            <li>
              {t('archive.statusChange')} <strong>{t('status.archived')}</strong>
            </li>
            <li>{t('archive.item2')}</li>
            <li>{t('archive.item3')}</li>
            <li>{t('archive.item4')}</li>
          </ul>
        </div>

        {/* Key confirmation */}
        <FormField
          label={
            <>
              {t('archive.confirmPrefix')}{' '}
              <span className="font-mono font-bold text-foreground">{project.key}</span>{' '}
              {t('archive.confirmSuffix')}
            </>
          }
        >
          <Input
            autoFocus
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={project.key}
            className={cn('font-mono', confirmed && 'border-destructive-border')}
          />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button
          variant="destructive"
          type="button"
          onClick={onConfirm}
          disabled={!confirmed || isPending}
        >
          {isPending && <Loader2 size={12} className="animate-spin" />}
          {t('actions.archive')}
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
  const { t } = useTranslation('projects')
  const { data: members = [], isLoading } = useWorkspaceMembers(workspaceId)
  const options = members.map((m) => ({
    value: m.userId,
    label: (m.displayName || m.email || m.userId) + (m.userId === currentUserId ? ' (you)' : ''),
    icon: <OwnerAvatar name={m.displayName || m.email || m.userId} size={16} />,
    group: 'Team Members',
  }))
  return (
    <SearchableSelect
      variant="field"
      value={value}
      readOnly={isLoading || members.length === 0}
      ariaLabel={t('form.owner')}
      placeholder={isLoading ? t('form.loading') : '—'}
      options={options}
      onChange={onChange}
    />
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
  const { t } = useTranslation('projects')
  const { data: teams = [], isLoading } = useWorkspaceTeams(workspaceId)
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((teamId) => teamId !== id) : [...value, id])
  }
  if (isLoading) return <div className="text-ui-md text-foreground-subtle">{t('form.loading')}</div>
  if (teams.length === 0)
    return <div className="text-ui-md text-foreground-subtle">{t('form.noTeams')}</div>
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-ui-sm text-foreground-subtle">{t('form.teamsHint')}</span>
        <span className="text-ui-sm font-medium text-muted-foreground">
          {t('form.teamsSelected', { num: value.length })}
        </span>
      </div>
      <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded border border-input bg-input-background p-2">
        {teams.map((team) => {
          const checked = value.includes(team.id)
          return (
            <label
              key={team.id}
              className="flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 text-ui-md text-foreground transition-colors"
              style={{
                borderColor: checked ? BRAND.primary : BRAND.border,
                backgroundColor: checked ? BRAND.primaryLighter : BRAND.surface,
              }}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(team.id)} />
              <UsersRound size={12} className="text-foreground-subtle" />
              <span className="truncate">{team.name}</span>
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
  const { t } = useTranslation('projects')
  return (
    <>
      <div className="grid grid-cols-[1fr_9rem] gap-3">
        <FormField label={t('form.name')} required>
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
          label={t('form.key')}
          required={keyEditable}
          hint={keyEditable ? t('form.keyHintEditable') : t('form.keyHintImmutable')}
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
                        .slice(0, 10),
                    })
                : undefined
            }
            placeholder="NXP"
            required={keyEditable}
            className="font-mono"
          />
        </FormField>
      </div>
      <FormField label={t('fields.description')}>
        <Textarea
          value={values.description}
          onChange={(e) => onPatch({ description: e.target.value })}
          placeholder="Brief description of this project…"
          rows={3}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('form.owner')} required>
          <OwnerSelect
            workspaceId={workspaceId}
            value={values.leadId}
            onChange={(leadId) => onPatch({ leadId })}
            currentUserId={currentUserId}
          />
        </FormField>
        <FormField label={t('form.startDate')}>
          <DateField
            value={values.startDate || null}
            ariaLabel={t('form.startDate')}
            onChange={(v) => onPatch({ startDate: v ?? '' })}
          />
        </FormField>
      </div>
      <FormField label={t('fields.teams')}>
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

export function EditProjectModal({
  project,
  workspaceId,
  onClose,
}: {
  project: Project
  workspaceId: string
  onClose: () => void
}) {
  const { t } = useTranslation('projects')
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
    setValues((v) => ({ ...v, teamIds: linkedTeams.map((team) => team.id) }))
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
      const original = new Set(linkedTeams.map((team) => team.id))
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
      notify.success(t('edit.updated', { name: values.name }))
      onClose()
    } catch (err) {
      const msg = errorMessage(err)
      notify.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('edit.title')} width={560}>
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
            {t('common:cancel')}
          </Button>
          <Button type="submit" disabled={saving || !values.name.trim()}>
            {saving && <Loader2 size={12} className="animate-spin" />}
            {t('edit.save')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── New Project modal ─────────────────────────────────────────────────────────

export function NewProjectModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const { t } = useTranslation('projects')
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
      notify.error(t('create.keyTooShort'))
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
      notify.success(t('create.created', { name: values.name }))
      onClose()
    } catch (err) {
      const msg = errorMessage(err)
      notify.error(msg)
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('create.title')} width={560}>
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
            {t('common:cancel')}
          </Button>
          <Button type="submit" disabled={isPending || !values.name.trim() || !values.key.trim()}>
            {isPending && <Loader2 size={12} className="animate-spin" />}
            {t('create.submit')}
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
    return <span className="text-ui-sm text-foreground-subtle">—</span>
  }

  // Names still loading — show a compact count placeholder.
  if (teams.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground">
        <UsersRound size={11} className="text-foreground-subtle" />
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

function ProjectActionsCell({ project, ctx }: { project: Project; ctx: ProjectCtx }) {
  const { t } = useTranslation('projects')
  const { openMenu, setOpenMenu, onEdit, onToggleArchive } = ctx
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpenMenu(openMenu === project.id ? null : project.id)}
        className="flex h-6 w-6 items-center justify-center rounded text-foreground-subtle hover:bg-avatar"
        aria-label="Project actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {openMenu === project.id && (
        <div className="absolute top-7 right-0 z-20 w-44 overflow-hidden rounded border border-border bg-card py-1 shadow-lg">
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-ui-sm text-foreground hover:bg-surface-subtle"
            onClick={() => {
              onEdit(project)
              setOpenMenu(null)
            }}
          >
            <Edit3 size={12} className="text-muted-foreground" />
            {t('actions.edit')}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-ui-sm hover:bg-surface-subtle"
            style={{ color: project.status === 'active' ? BRAND.danger : BRAND.textPrimary }}
            onClick={() => onToggleArchive(project)}
          >
            {project.status === 'active' ? (
              <Archive size={12} className="text-destructive" />
            ) : (
              <RotateCcw size={12} className="text-muted-foreground" />
            )}
            {project.status === 'active' ? t('actions.archive') : t('actions.restore')}
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
export const PROJECT_COLUMNS: ColumnSpec<Project, ProjectCtx, ProjectColKey>[] = [
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
        <div className="break-words whitespace-normal text-ui-md font-semibold text-foreground">
          {p.name}
        </div>
        {p.description && (
          <div className="truncate text-ui-xs text-foreground-subtle">{p.description}</div>
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
    cellClassName: 'flex items-center text-ui-sm',
    cell: (p) =>
      p.memberCount > 0 ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Users size={11} className="text-foreground-subtle" />
          {p.memberCount}
        </span>
      ) : (
        <span className="text-foreground-subtle">—</span>
      ),
  },
  {
    key: 'startDate',
    label: 'Start Date',
    sortCol: 'startDate',
    defaultWidth: 116,
    minWidth: 90,
    cellClassName: 'flex items-center px-2',
    type: 'date',
  },
  {
    key: 'updated',
    label: 'Updated',
    sortCol: 'updated',
    defaultWidth: 128,
    minWidth: 100,
    cellClassName: 'flex items-center text-ui-sm',
    cell: (p) => <span className="text-muted-foreground">{formatDate(p.updatedAt)}</span>,
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
