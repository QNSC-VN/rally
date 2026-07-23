import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2,
  UserPlus,
  Pencil,
  Archive,
  ArrowLeft,
  Plus,
  X,
  Users,
  UsersRound,
  ChevronRight,
} from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import type { components } from '@/shared/api/generated/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useWorkspaceTeams,
  useTeamMembers,
  useCreateTeam,
  useUpdateTeam,
  useAddTeamMember,
  useRemoveTeamMember,
  type Team,
  type TeamMember,
} from '@/features/teams/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { useClientPagination } from '@/shared/lib/hooks/use-client-pagination'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { EmptyState } from '@/shared/ui/empty-state'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { SearchInput } from '@/shared/ui/search-input'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { Spinner } from '@/shared/ui/spinner'
import { StatusBadge } from '@/shared/ui/status-badge'
import type { StatusStyle } from '@/shared/config/status-colors'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { TeamAvatar } from '@/shared/ui/team-cell'
import { formatDate } from '@/shared/lib/utils'

type MemberWithProfile = components['schemas']['MemberWithProfileResponseDto']

/** Normalise free text into a team key: uppercase alphanumerics, max 8 chars. */
function sanitizeKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
}

function CreateTeamModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const create = useCreateTeam()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !key.trim()) return
    try {
      await create.mutateAsync({
        workspaceId,
        name: name.trim(),
        key: key.trim(),
        description: description.trim() || undefined,
      })
      notify.success(t('teams.teamCreated', { name }))
      onClose()
    } catch (err) {
      notify.fromError(err, t('teams.createFailed'))
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('teams.newTeamTitle')} width={440}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <ModalBody className="space-y-4">
          <FormField label={t('teams.teamNameLabel')} required>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!key || key === sanitizeKey(name)) setKey(sanitizeKey(e.target.value))
              }}
              placeholder="Platform Engineering"
              autoFocus
            />
          </FormField>
          <FormField label={t('teams.keyLabel')} required hint={t('teams.keyHint')}>
            <Input
              value={key}
              onChange={(e) => setKey(sanitizeKey(e.target.value))}
              placeholder="PLAT"
            />
          </FormField>
          <FormField label={t('common:description')}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this team own?"
              rows={2}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button type="submit" disabled={create.isPending || !name.trim() || !key.trim()}>
            {create.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('teams.createTeam')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function EditTeamModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const [leadId, setLeadId] = useState(team.leadId ?? '')
  const update = useUpdateTeam(team.id)
  const { data: members = [] } = useTeamMembers(team.id)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await update.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        leadId: leadId || null,
      })
      notify.success(t('teams.teamUpdated'))
      onClose()
    } catch (err) {
      notify.fromError(err, t('teams.updateFailed'))
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('teams.editTitle', { name: team.name })} width={440}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <ModalBody className="space-y-4">
          <FormField label={t('teams.teamNameLabel')} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
          <FormField label={t('teams.teamLeadLabel')} hint={t('teams.teamLeadHint')}>
            <SearchableSelect
              variant="field"
              value={leadId}
              ariaLabel="Team lead"
              placeholder={t('teams.noLeadOption')}
              options={[
                { value: '', label: t('teams.noLeadOption') },
                ...members.map((m) => {
                  const n = m.displayName ?? m.email ?? m.userId
                  return { value: m.userId, label: n, icon: <OwnerAvatar name={n} size={16} /> }
                }),
              ]}
              onChange={setLeadId}
            />
          </FormField>
          <FormField label={t('common:description')}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button type="submit" disabled={update.isPending || !name.trim()}>
            {update.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('common:save')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function AddMemberModal({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const [selectedUserId, setSelectedUserId] = useState('')
  const addMember = useAddTeamMember(teamId)
  const { data: members = [] } = useTeamMembers(teamId)
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId)

  const alreadyAdded = new Set(members.map((m) => m.userId))
  const available = workspaceMembers.filter((m) => !alreadyAdded.has(m.userId))

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUserId) return
    try {
      await addMember.mutateAsync(selectedUserId)
      notify.success(t('teams.memberAdded'))
      onClose()
    } catch (err) {
      notify.fromError(err, t('teams.addMemberFailed'))
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('teams.addMemberTitle')} width={400}>
      <form onSubmit={(e) => void handleAdd(e)}>
        <ModalBody className="space-y-4">
          {available.length === 0 ? (
            <p className="text-ui-lg text-foreground-subtle">{t('teams.allMembersOnTeam')}</p>
          ) : (
            <FormField label={t('teams.selectMemberLabel')} required>
              <SearchableSelect
                variant="field"
                value={selectedUserId}
                ariaLabel={t('teams.selectMemberLabel')}
                placeholder={t('teams.selectMemberOption')}
                options={[
                  { value: '', label: t('teams.selectMemberOption') },
                  ...available.map((m) => {
                    const n = m.displayName ?? m.email ?? m.userId
                    return { value: m.userId, label: n, icon: <OwnerAvatar name={n} size={16} /> }
                  }),
                ]}
                onChange={setSelectedUserId}
              />
            </FormField>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            type="submit"
            disabled={addMember.isPending || !selectedUserId || available.length === 0}
          >
            {addMember.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <UserPlus size={13} />
            )}
            {t('teams.addToTeam')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function TeamStatusBadge({ status }: { status: 'active' | 'archived' }) {
  const style: StatusStyle =
    status === 'active'
      ? { label: 'Active', text: BRAND.success, bg: BRAND.successBg, border: BRAND.successBorder }
      : {
          label: 'Deactive',
          text: BRAND.textSecondary,
          bg: BRAND.surfaceSubtle,
          border: BRAND.border,
        }
  return <StatusBadge style={style} />
}

function TeamDetail({
  team,
  lead,
  roster,
  onBack,
}: {
  team: Team
  lead: MemberWithProfile | null
  roster: Map<string, MemberWithProfile>
  onBack: () => void
}) {
  const { t } = useTranslation('settings')
  const { data: members = [], isLoading } = useTeamMembers(team.id)
  const remove = useRemoveTeamMember(team.id)
  const update = useUpdateTeam(team.id)
  const [showEdit, setShowEdit] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null)

  async function handleRemoveMember(userId: string) {
    try {
      await remove.mutateAsync(userId)
      notify.success(t('teams.memberRemoved'))
    } catch (err) {
      notify.fromError(err, t('teams.removeMemberFailed'))
    } finally {
      setMemberToRemove(null)
    }
  }

  async function handleToggleStatus() {
    const next = team.status === 'active' ? 'archived' : 'active'
    try {
      await update.mutateAsync({ status: next })
      notify.success(next === 'archived' ? t('teams.teamArchived') : t('teams.teamRestored'))
    } catch (err) {
      notify.fromError(err, t('teams.updateStatusFailed'))
    } finally {
      setConfirmArchive(false)
    }
  }

  return (
    <div>
      {/* Back + header */}
      <div className="mb-5 flex items-center gap-3">
        <Button variant="link" size="sm" onClick={onBack} className="px-0">
          <ArrowLeft size={13} /> {t('teams.allTeams')}
        </Button>
        <span className="text-border">·</span>
        <span className="text-ui-lg font-semibold text-foreground">{team.name}</span>
        <span className="rounded border bg-surface-subtle px-1.5 py-0.5 font-mono text-ui-sm font-medium text-foreground-subtle">
          {team.key}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <TeamStatusBadge status={team.status} />
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>
            <Pencil size={12} /> {t('common:edit')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              team.status === 'active' ? setConfirmArchive(true) : void handleToggleStatus()
            }
            disabled={update.isPending}
          >
            {update.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Archive size={12} />
            )}
            {team.status === 'active' ? t('common:archive') : t('common:restore')}
          </Button>
        </div>
      </div>

      {team.description && (
        <p className="mb-4 text-ui-lg text-muted-foreground">{team.description}</p>
      )}

      {/* Meta: lead + created date */}
      <div className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-ui-sm font-semibold tracking-wide text-foreground-subtle uppercase">
            {t('teams.leadLabel')}
          </span>
          {lead ? (
            <span className="flex items-center gap-1.5">
              <OwnerAvatar name={lead.displayName} avatarUrl={lead.avatarUrl} size={20} />
              <span className="text-ui-lg text-foreground">{lead.displayName}</span>
            </span>
          ) : (
            <span className="text-ui-lg text-foreground-disabled">{t('teams.noLeadAssigned')}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-ui-sm font-semibold tracking-wide text-foreground-subtle uppercase">
            {t('teams.createdLabel')}
          </span>
          <span className="text-ui-lg text-foreground">{formatDate(team.createdAt)}</span>
        </div>
      </div>

      {/* Members section */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-ui-lg font-semibold text-foreground">
          {t('teams.membersCount', { count: members.length })}
        </h3>
        <Button size="sm" onClick={() => setShowAddMember(true)}>
          <Plus size={12} /> {t('teams.addMember')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner size="lg" />
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center">
          <p className="text-ui-lg text-foreground-subtle">{t('teams.noMembersYet')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {members.map((member, idx) => {
            const isLead = member.userId === team.leadId
            const profile = roster.get(member.userId)
            const name = profile?.displayName ?? member.displayName ?? member.userId
            const email = profile?.email ?? member.email
            const avatarUrl = profile?.avatarUrl ?? member.avatarUrl
            return (
              <div
                key={member.id}
                className={`flex items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t' : ''}`}
              >
                <OwnerAvatar name={name} avatarUrl={avatarUrl} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-ui-lg font-medium text-foreground">
                    {name}
                    {isLead && (
                      <span className="rounded bg-primary-lighter px-1.5 py-0.5 text-ui-xs font-semibold text-primary">
                        {t('teams.leadBadge')}
                      </span>
                    )}
                  </p>
                  {email && <p className="truncate text-ui-sm text-foreground-subtle">{email}</p>}
                </div>
                <span className="text-ui-sm text-foreground-subtle capitalize">
                  {member.status}
                </span>
                <IconButton
                  className="ml-2"
                  aria-label="Remove from team"
                  title="Remove from team"
                  onClick={() => setMemberToRemove(member)}
                  disabled={remove.isPending}
                >
                  <X size={13} />
                </IconButton>
              </div>
            )
          })}
        </div>
      )}

      {showEdit && <EditTeamModal team={team} onClose={() => setShowEdit(false)} />}
      {showAddMember && <AddMemberModal teamId={team.id} onClose={() => setShowAddMember(false)} />}

      <ConfirmDialog
        open={confirmArchive}
        title={t('teams.archiveTitle', { name: team.name })}
        message={t('teams.archiveMessage')}
        confirmLabel={t('teams.archiveConfirm')}
        destructive
        pending={update.isPending}
        onConfirm={() => void handleToggleStatus()}
        onCancel={() => setConfirmArchive(false)}
      />

      <ConfirmDialog
        open={memberToRemove !== null}
        title={t('teams.removeMemberTitle')}
        message={
          memberToRemove
            ? t('teams.removeMemberMessage', {
                member: memberToRemove.displayName ?? t('teams.thisMember'),
                team: team.name,
              })
            : undefined
        }
        confirmLabel={t('teams.removeConfirm')}
        destructive
        pending={remove.isPending}
        onConfirm={() => memberToRemove && void handleRemoveMember(memberToRemove.userId)}
        onCancel={() => setMemberToRemove(null)}
      />
    </div>
  )
}

export function TeamsTab() {
  const { t } = useTranslation('settings')
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: teams = [], isLoading } = useWorkspaceTeams(workspaceId)
  const { data: members = [] } = useWorkspaceMembers(workspaceId)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [search, setSearch] = useState('')

  const memberById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])

  const visibleTeams = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return teams
    return teams.filter(
      (team) => team.name.toLowerCase().includes(q) || team.key.toLowerCase().includes(q),
    )
  }, [teams, search])

  const { pageItems, footerProps } = useClientPagination(visibleTeams, 25)

  if (selectedTeam) {
    const live = teams.find((team) => team.id === selectedTeam.id) ?? selectedTeam
    return (
      <TeamDetail
        team={live}
        lead={live.leadId ? (memberById.get(live.leadId) ?? null) : null}
        roster={memberById}
        onBack={() => setSelectedTeam(null)}
      />
    )
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-ui-lg text-muted-foreground">{t('teams.intro')}</p>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={13} /> {t('teams.newTeam')}
        </Button>
      </div>

      <div className="mb-4 flex items-center justify-end gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search teams…" width={224} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : visibleTeams.length === 0 ? (
        <EmptyState
          icon={<UsersRound size={28} className="text-border-strong" />}
          title={search.trim() ? t('teams.emptySearch') : t('teams.empty')}
          description={t('teams.emptyDescription')}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {pageItems.map((team, idx) => {
            const lead = team.leadId ? memberById.get(team.leadId) : undefined
            return (
              <button
                key={team.id}
                onClick={() => setSelectedTeam(team)}
                className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-hover ${
                  idx > 0 ? 'border-t' : ''
                }`}
              >
                <TeamAvatar teamKey={team.key} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-ui-lg font-semibold text-foreground">{team.name}</p>
                  {team.description && (
                    <p className="truncate text-ui-md text-foreground-subtle">{team.description}</p>
                  )}
                </div>
                <div className="hidden w-40 shrink-0 items-center gap-1.5 sm:flex">
                  {lead ? (
                    <>
                      <OwnerAvatar name={lead.displayName} avatarUrl={lead.avatarUrl} size={20} />
                      <span className="truncate text-ui-md text-muted-foreground">
                        {lead.displayName}
                      </span>
                    </>
                  ) : (
                    <span className="text-ui-md text-foreground-disabled">{t('teams.noLead')}</span>
                  )}
                </div>
                {typeof team.memberCount === 'number' && (
                  <div
                    className="flex shrink-0 items-center gap-1 text-ui-md text-foreground-subtle"
                    title={`${team.memberCount} member${team.memberCount === 1 ? '' : 's'}`}
                  >
                    <Users size={13} />
                    {team.memberCount}
                  </div>
                )}
                <TeamStatusBadge status={team.status} />
                <ChevronRight size={14} className="text-foreground-subtle" />
              </button>
            )
          })}
        </div>
      )}

      {!isLoading && visibleTeams.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border">
          <PaginationFooter {...footerProps} />
        </div>
      )}

      {showCreate && workspaceId && (
        <CreateTeamModal workspaceId={workspaceId} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
