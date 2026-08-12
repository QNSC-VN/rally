/* eslint-disable react-refresh/only-export-components -- PROJECT_COLUMNS is config that must co-locate with the cell renderers it references */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, UsersRound } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { cn, formatDateIso } from '@/shared/lib/utils'
import { DateField } from '@/shared/ui/date-field'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { notify, errorMessage } from '@/shared/lib/toast'
import { useCreateProject, type Project } from '@/features/projects/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import {
  useWorkspaceTeams,
  useProjectTeams,
  useProjectMembers,
  useLinkProjectTeam,
  useUnlinkProjectTeam,
} from '@/features/teams/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { PERMISSION } from '@/shared/config/permissions'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { OwnerAvatar, OwnerSelectCell } from '@/shared/ui/owner-cell'
import { TeamAvatar } from '@/shared/ui/team-cell'
import { IdCell } from '@/entities/work-item/ui/id-cell'
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
      placeholder={isLoading ? t('form.loading') : '--'}
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
  endDate: string
  teamIds: string[]
  xsPoints?: number
  sPoints?: number
  mPoints?: number
  lPoints?: number
  xlPoints?: number
  hoursPerPoint?: number
}

function ProjectFormFields({
  workspaceId,
  values,
  onPatch,
  keyEditable,
  currentUserId,
  autoFocusName,
  isWorkspaceAdmin,
}: {
  workspaceId: string
  values: ProjectFormValues
  onPatch: (patch: Partial<ProjectFormValues>) => void
  keyEditable: boolean
  currentUserId?: string
  autoFocusName?: boolean
  isWorkspaceAdmin?: boolean
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
        <FormField label={t('form.owner')}>
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
        <FormField label={t('form.endDate', 'End Date')}>
          <DateField
            value={values.endDate || null}
            ariaLabel={t('form.endDate', 'End Date')}
            onChange={(v) => onPatch({ endDate: v ?? '' })}
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

      {/* Estimation Settings (SRS §6.2) — WA-admin only */}
      {isWorkspaceAdmin && (
        <div className="space-y-3 rounded-lg border border-border-subtle p-4">
          <h4 className="text-ui-sm font-semibold text-foreground">Estimation Settings</h4>
          <p className="text-ui-xs text-foreground-subtle">
            Fixed T-shirt labels with editable point values. Consumed by Capacity Planning and
            Reports.
          </p>
          <div className="grid grid-cols-5 gap-2">
            {(['xsPoints', 'sPoints', 'mPoints', 'lPoints', 'xlPoints'] as const).map(
              (field, i) => {
                const label = ['XS', 'S', 'M', 'L', 'XL'][i]
                return (
                  <FormField key={field} label={label}>
                    <Input
                      type="number"
                      min={1}
                      value={String(
                        (values as unknown as Record<string, unknown>)[field] ??
                          [1, 3, 5, 8, 13][i],
                      )}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (v > 0) onPatch({ [field]: v } as Partial<ProjectFormValues>)
                      }}
                      className="text-center"
                    />
                  </FormField>
                )
              },
            )}
          </div>
          <FormField label="Hours per point">
            <Input
              type="number"
              min={0.5}
              step={0.5}
              value={String((values as unknown as Record<string, unknown>).hoursPerPoint ?? 8)}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v > 0) onPatch({ hoursPerPoint: v } as Partial<ProjectFormValues>)
              }}
              className="w-24"
            />
          </FormField>
        </div>
      )}
    </>
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
  const { user, hasPermission } = useAuthStore()
  const isWA = hasPermission(PERMISSION.WORKSPACE_VIEW)
  const [values, setValues] = useState<ProjectFormValues>({
    name: '',
    key: '',
    description: '',
    leadId: '',
    startDate: '',
    endDate: '',
    teamIds: [],
    xsPoints: 1,
    sPoints: 3,
    mPoints: 5,
    lPoints: 8,
    xlPoints: 13,
    hoursPerPoint: 8,
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
    if (values.name.trim().length < 2 || !trimmedKey) return
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
        leadId: values.leadId || undefined,
        startDate: values.startDate || undefined,
        endDate: values.endDate || undefined,
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
            autoFocusName
            currentUserId={user?.id}
            isWorkspaceAdmin={isWA}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button
            type="submit"
            disabled={isPending || values.name.trim().length < 2 || !values.key.trim()}
          >
            {isPending && <Loader2 size={12} className="animate-spin" />}
            {t('create.submit')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Teams cell (linked team names, one per line) ─────────────────────────────

/** Teams cell — editable inline multi-select (Project↔Team is M2M), matching the
 *  Milestones cell on Iteration Status: stacked chips + a searchable picker.
 *  Edited via the dedicated link/unlink endpoints (the project PATCH carries no
 *  teamIds), so each add/remove commits immediately from the multi-select diff. */
function ProjectTeamsCell({
  projectId,
  workspaceId,
  canEdit,
}: {
  projectId: string
  workspaceId: string
  canEdit: boolean
}) {
  const { data: teams = [] } = useProjectTeams(projectId)
  const { data: allTeams = [] } = useWorkspaceTeams(workspaceId)
  const link = useLinkProjectTeam(projectId)
  const unlink = useUnlinkProjectTeam(projectId)

  return (
    <SearchableSelect
      multiple
      readOnly={!canEdit}
      value={teams.map((t) => t.id)}
      ariaLabel="Teams"
      placeholder="--"
      searchPlaceholder="Search"
      options={allTeams.map((t) => ({
        value: t.id,
        label: t.name,
        searchText: t.name,
        icon: <TeamAvatar teamKey={t.key} name={t.name} size={16} />,
      }))}
      onChange={(ids) => {
        const next = ids as string[]
        const cur = teams.map((t) => t.id)
        next.filter((id) => !cur.includes(id)).forEach((id) => link.mutate(id))
        cur.filter((id) => !next.includes(id)).forEach((id) => unlink.mutate(id))
      }}
    />
  )
}

/** Members cell — read-only chips (a project's members are derived from its
 *  linked teams, edited via Teams, not here). Same capped chip look as Teams. */
function ProjectMembersCell({ projectId }: { projectId: string }) {
  const { data: members = [] } = useProjectMembers(projectId)
  if (members.length === 0) return <span className="text-foreground-subtle">--</span>
  return (
    <SearchableSelect
      multiple
      readOnly
      variant="cell"
      value={members.map((m) => m.userId)}
      ariaLabel="Members"
      placeholder="--"
      options={members.map((m) => {
        const name = m.displayName || m.email || m.userId
        return {
          value: m.userId,
          label: name,
          searchText: name,
          icon: <OwnerAvatar name={name} size={16} />,
        }
      })}
      onChange={() => {}}
    />
  )
}

// ── Table columns (shared useDataTable engine) ───────────────────────────────

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
    // Same as every work-item/timebox grid: the shared IdCell (type glyph +
    // monospace key link to the detail page).
    cell: (p, ctx) => <IdCell type="project" itemKey={p.key} onOpen={() => ctx.onOpen(p.key)} />,
  },
  {
    key: 'name',
    label: 'Project',
    sortCol: 'name',
    defaultWidth: 280,
    minWidth: 160,
    locked: true,
    cellClassName: 'overflow-hidden px-0',
    cell: (p, ctx) =>
      p.status === 'archived' ? (
        <div className="px-2 py-1.5 text-ui-md break-words whitespace-normal text-foreground">
          {p.name}
        </div>
      ) : (
        <InlineEditableCell
          value={p.name}
          canEdit
          fullCell
          ariaLabel="Name"
          title={p.name}
          className="text-ui-md break-words whitespace-normal text-foreground"
          inputClassName="text-ui-md text-foreground"
          onCommit={(v) => {
            const n = v.trim()
            if (n && n !== p.name) ctx.onPatch?.(p.id, { name: n })
          }}
        />
      ),
  },
  {
    key: 'status',
    label: 'Status',
    sortCol: 'status',
    defaultWidth: 96,
    minWidth: 80,
    cellClassName: 'flex items-center px-0',
    cell: (p, ctx) => (
      <SearchableSelect
        value={p.status}
        ariaLabel="Status"
        options={[
          { value: 'active', label: 'Active' },
          { value: 'archived', label: 'Archived' },
        ]}
        onChange={(v) => ctx.onPatch?.(p.id, { status: v as 'active' | 'archived' })}
      />
    ),
  },
  {
    key: 'owner',
    label: 'Owner',
    defaultWidth: 140,
    minWidth: 90,
    cellClassName: 'flex items-center px-0',
    cell: (p, ctx) => (
      <OwnerSelectCell
        ownerName={
          p.leadId
            ? (p.leadName ?? (p.leadId === ctx.currentUserId ? ctx.currentUserName : null))
            : null
        }
        assigneeId={p.leadId}
        members={ctx.members}
        canEdit={p.status !== 'archived'}
        ariaLabel="Owner"
        onChange={(v) => ctx.onPatch?.(p.id, { leadId: v })}
      />
    ),
  },
  {
    key: 'teams',
    label: 'Teams',
    defaultWidth: 190,
    minWidth: 120,
    cellClassName: 'flex items-center px-0',
    cell: (p) => (
      <ProjectTeamsCell
        projectId={p.id}
        workspaceId={p.workspaceId}
        canEdit={p.status === 'active'}
      />
    ),
  },
  {
    key: 'members',
    label: 'Members',
    sortCol: 'members',
    defaultWidth: 220,
    minWidth: 140,
    cellClassName: 'flex min-w-0 items-center text-ui-sm',
    cell: (p) => <ProjectMembersCell projectId={p.id} />,
  },
  {
    key: 'startDate',
    label: 'Start Date',
    sortCol: 'startDate',
    defaultWidth: 116,
    minWidth: 90,
    cellClassName: 'flex items-center px-0',
    cell: (p, ctx) => (
      <DateField
        value={p.startDate}
        readOnly={p.status === 'archived'}
        ariaLabel="Start Date"
        onChange={(v) => ctx.onPatch?.(p.id, { startDate: v })}
      />
    ),
  },
  {
    key: 'endDate',
    label: 'End Date',
    sortCol: 'endDate',
    defaultWidth: 116,
    minWidth: 90,
    cellClassName: 'flex items-center px-0',
    cell: (p, ctx) => (
      <DateField
        value={p.endDate}
        readOnly={p.status === 'archived'}
        ariaLabel="End Date"
        onChange={(v) => ctx.onPatch?.(p.id, { endDate: v })}
      />
    ),
  },
  {
    key: 'updated',
    label: 'Updated',
    sortCol: 'updated',
    defaultWidth: 128,
    minWidth: 100,
    cellClassName: 'flex items-center text-ui-sm',
    cell: (p) => <span className="text-muted-foreground">{formatDateIso(p.updatedAt)}</span>,
  },
]

// ── Page ─────────────────────────────────────────────────────────────────────
