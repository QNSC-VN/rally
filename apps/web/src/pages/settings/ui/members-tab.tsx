import { useMemo, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Mail, UserPlus, X } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useWorkspaceMembers,
  useUpdateMember,
  type WorkspaceMember,
} from '@/features/workspaces/api'
import { useWorkspaceTeams } from '@/features/teams/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { SearchInput } from '@/shared/ui/search-input'
import { StatusBadge } from '@/shared/ui/status-badge'
import type { StatusStyle } from '@/shared/config/status-colors'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { MetricCard } from '@/shared/ui/metric-card'
import { formatDate, formatDateTime } from '@/shared/lib/utils'
import { useSystemRoles } from '../model/use-system-roles'

type InviteForm = { email: string; roleId: string }
type MemberStatus = 'active' | 'suspended' | 'removed'

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join()

export function MembersTab() {
  const { t } = useTranslation('settings')
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('') // '' = all
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')

  const { data: members = [], isLoading: membersLoading } = useWorkspaceMembers(workspaceId)
  const { data: roles = [] } = useSystemRoles()

  const { data: invitations = [] } = useQuery({
    queryKey: ['workspace-invitations', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return []
      const res = await apiClient.GET('/v1/workspaces/{id}/invitations', {
        params: { path: { id: workspaceId } },
      })
      return (res.data ?? []).filter((i: { status: string }) => i.status === 'pending')
    },
    enabled: !!workspaceId,
  })

  const cancelInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      if (!workspaceId) return
      await apiClient.DELETE('/v1/workspaces/{id}/invitations/{invitationId}', {
        params: { path: { id: workspaceId, invitationId } },
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace-invitations', workspaceId] })
      notify.success(t('members.inviteCancelled'))
    },
    onError: (err) => notify.error(apiErrorMessage(err)),
  })

  const metrics = useMemo(() => {
    const active = members.filter((m) => m.status === 'active').length
    const admins = members.filter((m) => m.roleSlug === 'workspace_admin').length
    return { total: members.length, active, admins }
  }, [members])

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (roleFilter && m.roleId !== roleFilter) return false
      if (!q) return true
      return (
        m.displayName?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.roleName?.toLowerCase().includes(q)
      )
    })
  }, [members, search, roleFilter, statusFilter])

  if (!workspaceId) {
    return <p className="text-ui-lg text-foreground-subtle">{t('members.noWorkspace')}</p>
  }

  if (membersLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-foreground-subtle">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-ui-lg">{t('members.loading')}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Metric strip — Total / Active / Admins (SRS §6.1) */}
      <MetricStrip className="rounded-lg border">
        <MetricCard label="Total Users" value={metrics.total} />
        <MetricCard label="Active" value={metrics.active} valueColor={BRAND.success} />
        <MetricCard label="Admins" value={metrics.admins} />
      </MetricStrip>

      {/* Toolbar: search + role + status + invite */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search users…" width={224} />
        <div className="w-48">
          <SearchableSelect
            variant="field"
            value={roleFilter}
            ariaLabel="Filter by role"
            placeholder="All roles"
            options={[
              { value: '', label: 'All roles' },
              ...roles.map((r) => ({ value: r.id, label: r.name })),
            ]}
            onChange={(v) => setRoleFilter(v as string)}
          />
        </div>
        <div className="w-40">
          <SearchableSelect
            variant="field"
            value={statusFilter}
            ariaLabel="Filter by status"
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Deactive' },
            ]}
            onChange={(v) => setStatusFilter(v as 'all' | 'active' | 'suspended')}
          />
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setShowInviteModal(true)}>
          <UserPlus size={13} /> {t('members.invite')}
        </Button>
      </div>

      {showInviteModal && (
        <InviteUserModal
          workspaceId={workspaceId}
          roles={roles}
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => {
            setShowInviteModal(false)
            void qc.invalidateQueries({ queryKey: ['workspace-invitations', workspaceId] })
          }}
        />
      )}

      {/* Unified users list (SRS §6.2): User, Email, Role, Status, Teams, Last Login. */}
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-4 border-b bg-surface-subtle px-4 py-2 text-ui-sm font-semibold tracking-wide text-foreground-subtle uppercase">
          <div className="min-w-0 flex-1">{t('members.colUser')}</div>
          <div className="hidden w-56 shrink-0 md:block">{t('members.colEmail')}</div>
          <div className="w-32 shrink-0">{t('members.colRole')}</div>
          <div className="w-24 shrink-0">{t('common:status')}</div>
          <div className="hidden w-40 shrink-0 lg:block">{t('members.colTeams')}</div>
          <div className="hidden w-28 shrink-0 xl:block">{t('members.colLastLogin')}</div>
          <div className="w-8 shrink-0" />
        </div>

        {/* Pending invitations render as Invited rows in the same list. */}
        {invitations.map(
          (inv: { id: string; email: string; roleId: string | null; expiresAt: string }) => {
            const roleLabel = roles.find((r) => r.id === inv.roleId)?.name ?? '—'
            return (
              <div
                key={`inv-${inv.id}`}
                className="flex items-center gap-4 border-t px-4 py-3 first:border-t-0"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Mail size={16} className="shrink-0 text-foreground-subtle" />
                  <span className="truncate text-ui-lg text-foreground-subtle">{inv.email}</span>
                </div>
                <div className="hidden w-56 shrink-0 truncate text-ui-md text-muted-foreground md:block">
                  {inv.email}
                </div>
                <div className="w-32 shrink-0 truncate text-ui-md text-muted-foreground">
                  {roleLabel}
                </div>
                <div className="w-24 shrink-0">
                  <MemberStatusBadge status="invited" />
                </div>
                <div className="hidden w-40 shrink-0 text-ui-md text-foreground-disabled lg:block">
                  —
                </div>
                <div className="hidden w-28 shrink-0 text-ui-md text-foreground-disabled xl:block">
                  —
                </div>
                <div className="w-8 shrink-0">
                  <IconButton
                    size="sm"
                    aria-label="Cancel invitation"
                    title="Cancel invitation"
                    onClick={() => cancelInvite.mutate(inv.id)}
                    disabled={cancelInvite.isPending}
                  >
                    <X size={13} />
                  </IconButton>
                </div>
              </div>
            )
          },
        )}

        {filteredMembers.map((m) => {
          const isCurrentUser = m.userId === user?.id
          const teams = m.teams ?? []
          return (
            <button
              key={m.id}
              onClick={() => setSelectedMember(m)}
              className="flex w-full items-center gap-4 border-t px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-surface-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <OwnerAvatar name={m.displayName} avatarUrl={m.avatarUrl} size={28} />
                <span className="truncate text-ui-lg text-foreground">
                  {m.displayName}
                  {isCurrentUser && (
                    <span className="ml-2 rounded bg-primary-lighter px-1 py-0.5 text-ui-xs text-primary">
                      {t('members.you')}
                    </span>
                  )}
                </span>
              </div>
              <div className="hidden w-56 shrink-0 truncate text-ui-md text-muted-foreground md:block">
                {m.email}
              </div>
              <div className="w-32 shrink-0 truncate text-ui-md text-muted-foreground">
                {m.roleName ?? '—'}
              </div>
              <div className="w-24 shrink-0">
                <MemberStatusBadge status={m.status} />
              </div>
              <div className="hidden w-40 shrink-0 truncate text-ui-md text-muted-foreground lg:block">
                {teams.length > 0 ? teams.map((tm) => tm.name).join(', ') : '—'}
              </div>
              <div className="hidden w-28 shrink-0 text-ui-md text-foreground-subtle xl:block">
                {formatDate(m.lastLoginAt, t('members.never'))}
              </div>
              <div className="w-8 shrink-0" />
            </button>
          )
        })}

        {filteredMembers.length === 0 && invitations.length === 0 && (
          <div className="py-10 text-center text-ui-lg text-foreground-subtle">
            {search.trim() || roleFilter || statusFilter !== 'all'
              ? t('members.noMembersSearch')
              : t('members.noMembers')}
          </div>
        )}
      </div>

      {selectedMember && workspaceId && (
        <EditUserModal
          workspaceId={workspaceId}
          member={selectedMember}
          roles={roles}
          isCurrentUser={selectedMember.userId === user?.id}
          onClose={() => setSelectedMember(null)}
        />
      )}
    </div>
  )
}

// ── Member status badge ───────────────────────────────────────────────────────

function MemberStatusBadge({ status }: { status: string }) {
  const map: Record<string, StatusStyle> = {
    active: {
      label: 'Active',
      text: BRAND.success,
      bg: BRAND.successBg,
      border: BRAND.successBorder,
    },
    invited: {
      label: 'Invited',
      text: BRAND.warning,
      bg: BRAND.warningBg,
      border: BRAND.warningBorder,
    },
    suspended: {
      label: 'Deactive',
      text: BRAND.textSecondary,
      bg: BRAND.surfaceSubtle,
      border: BRAND.border,
    },
  }
  const style = map[status] ?? {
    label: status,
    text: BRAND.textMuted,
    bg: BRAND.surfaceSubtle,
    border: BRAND.border,
  }
  return <StatusBadge style={style} />
}

// ── Edit user modal (editable: role, status, teams) ─────────────────────────────

function EditUserModal({
  workspaceId,
  member,
  roles,
  isCurrentUser,
  onClose,
}: {
  workspaceId: string
  member: WorkspaceMember
  roles: { id: string; name: string; slug?: string }[]
  isCurrentUser: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('settings')
  const qc = useQueryClient()
  const { data: teams = [] } = useWorkspaceTeams(workspaceId)
  const updateMember = useUpdateMember(workspaceId)

  const initialTeamIds = useMemo(() => (member.teams ?? []).map((tm) => tm.id), [member.teams])
  const [roleId, setRoleId] = useState(member.roleId ?? '')
  const [status, setStatus] = useState<MemberStatus>(member.status as MemberStatus)
  const [teamIds, setTeamIds] = useState<string[]>(initialTeamIds)
  const [saving, setSaving] = useState(false)

  const changeRole = useMutation({
    mutationFn: async (newRoleId: string) => {
      if (member.roleAssignmentId) {
        await apiClient.DELETE('/v1/role-assignments/{id}', {
          params: { path: { id: member.roleAssignmentId } },
        })
      }
      await apiClient.POST('/v1/role-assignments', {
        body: { userId: member.userId, roleId: newRoleId, scopeType: 'workspace' },
      })
    },
  })

  async function handleSave() {
    setSaving(true)
    try {
      if (roleId && roleId !== (member.roleId ?? '')) {
        await changeRole.mutateAsync(roleId)
      }
      const statusChanged = status !== member.status
      const teamsChanged = !sameSet(teamIds, initialTeamIds)
      if (statusChanged || teamsChanged) {
        await updateMember.mutateAsync({
          memberId: member.id,
          ...(statusChanged ? { status } : {}),
          ...(teamsChanged ? { teamIds } : {}),
        })
      }
      void qc.invalidateQueries({ queryKey: ['workspace-members-profile', workspaceId] })
      notify.success('User updated')
      onClose()
    } catch (err) {
      notify.fromError(err, 'Failed to update user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppModal open onClose={onClose} title="Edit User" width={460}>
      <ModalBody className="space-y-4">
        <div className="flex items-center gap-3">
          <OwnerAvatar name={member.displayName} avatarUrl={member.avatarUrl} size={44} />
          <div className="min-w-0">
            <p className="truncate text-ui-xl font-semibold text-foreground">
              {member.displayName}
            </p>
            <p className="truncate text-ui-md text-foreground-subtle">{member.email}</p>
          </div>
        </div>

        <FormField label="Workspace Role">
          <SearchableSelect
            variant="field"
            value={roleId}
            ariaLabel="Workspace role"
            placeholder="Select a role"
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
            onChange={(v) => setRoleId(v as string)}
          />
        </FormField>

        <FormField
          label="Status"
          hint={isCurrentUser ? 'You cannot change your own status' : undefined}
        >
          <SearchableSelect
            variant="field"
            value={status}
            readOnly={isCurrentUser}
            ariaLabel="Status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Deactive' },
            ]}
            onChange={(v) => setStatus(v as MemberStatus)}
          />
        </FormField>

        <FormField label="Teams" hint="Project access is derived from team membership">
          <SearchableSelect
            variant="field"
            multiple
            value={teamIds}
            ariaLabel="Teams"
            placeholder="Add teams…"
            searchPlaceholder="Search teams"
            options={teams.map((tm) => ({
              value: tm.id,
              label: `${tm.key} · ${tm.name}`,
              searchText: `${tm.key} ${tm.name}`,
            }))}
            onChange={(ids) => setTeamIds(ids as string[])}
          />
        </FormField>

        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-ui-md">
          <dt className="text-foreground-subtle">{t('members.detailLastLogin')}</dt>
          <dd className="text-foreground">
            {formatDateTime(member.lastLoginAt, t('members.never'))}
          </dd>
          <dt className="text-foreground-subtle">{t('members.detailJoined')}</dt>
          <dd className="text-foreground">{formatDate(member.joinedAt)}</dd>
        </dl>
      </ModalBody>
      <ModalFooter>
        <Button type="button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          {t('common:save')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common:cancel')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}

// ── Invite user modal (email + role; rich invite deferred per SRS §6.4) ─────────

function InviteUserModal({
  workspaceId,
  roles,
  onClose,
  onSuccess,
}: {
  workspaceId: string
  roles: { id: string; name: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation('settings')
  const inviteSchema = z.object({
    email: z.string().email(t('members.invalidEmail')),
    roleId: z.string().min(1, t('members.selectRoleError')),
  })
  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', roleId: '' },
  })

  const invite = useMutation({
    mutationFn: async (data: InviteForm) => {
      const { error, response } = await apiClient.POST('/v1/workspaces/{id}/invitations', {
        params: { path: { id: workspaceId } },
        body: { email: data.email, roleId: data.roleId },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      notify.success(t('members.inviteSent'))
      onSuccess()
    },
    onError: (err: Error) => {
      form.setError('root', { message: err.message })
    },
  })

  return (
    <AppModal open onClose={onClose} title={t('members.invitePanelTitle')} width={460}>
      <form onSubmit={form.handleSubmit((d) => invite.mutate(d))}>
        <ModalBody className="space-y-4">
          <FormField
            label={t('members.emailFieldLabel')}
            error={form.formState.errors.email?.message}
          >
            <Input {...form.register('email')} type="email" placeholder="colleague@company.com" />
          </FormField>
          <FormField
            label={t('members.roleFieldLabel')}
            error={form.formState.errors.roleId?.message}
          >
            <Controller
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <SearchableSelect
                  variant="field"
                  value={field.value ?? ''}
                  ariaLabel={t('members.roleFieldLabel')}
                  placeholder={t('members.selectRoleOption')}
                  options={[
                    { value: '', label: t('members.selectRoleOption') },
                    ...roles.map((r) => ({ value: r.id, label: r.name })),
                  ]}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>
          {form.formState.errors.root && (
            <p className="text-ui-md text-destructive">{form.formState.errors.root.message}</p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            {t('members.sendInvite')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}
