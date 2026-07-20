import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Mail, UserPlus, X } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { useClientPagination } from '@/shared/lib/hooks/use-client-pagination'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { Card, CardHeader, CardBody } from '@/shared/ui/card'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NativeSelect } from '@/shared/ui/native-select'
import { SearchInput } from '@/shared/ui/search-input'
import { StatusBadge } from '@/shared/ui/status-badge'
import type { StatusStyle } from '@/shared/config/status-colors'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { formatDate, formatDateTime } from '@/shared/lib/utils'
import { useSystemRoles } from '../model/use-system-roles'

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  roleId: z.string().min(1, 'Select a role'),
})
type InviteForm = z.infer<typeof inviteSchema>

type MemberWithProfile = components['schemas']['MemberWithProfileResponseDto']

export function MembersTab() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const [showInvitePanel, setShowInvitePanel] = useState(false)
  const [selectedMember, setSelectedMember] = useState<MemberWithProfile | null>(null)
  const [search, setSearch] = useState('')

  const { data: members = [], isLoading: membersLoading } = useWorkspaceMembers(workspaceId)

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

  const { data: roles = [] } = useSystemRoles()

  const changeRole = useMutation({
    mutationFn: async ({
      userId,
      oldAssignmentId,
      newRoleId,
    }: {
      userId: string
      oldAssignmentId: string | null
      newRoleId: string
    }) => {
      if (oldAssignmentId) {
        await apiClient.DELETE('/v1/role-assignments/{id}', {
          params: { path: { id: oldAssignmentId } },
        })
      }
      await apiClient.POST('/v1/role-assignments', {
        body: { userId, roleId: newRoleId, scopeType: 'workspace' },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members-profile', workspaceId] })
      notify.success('Role updated')
    },
    onError: (err) => notify.error(apiErrorMessage(err)),
  })

  const cancelInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      if (!workspaceId) return
      await apiClient.DELETE('/v1/workspaces/{id}/invitations/{invitationId}', {
        params: { path: { id: workspaceId, invitationId } },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-invitations', workspaceId] })
      notify.success('Invitation cancelled')
    },
    onError: (err) => notify.error(apiErrorMessage(err)),
  })

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      if (!workspaceId) return
      await apiClient.DELETE('/v1/workspaces/{id}/members/{userId}', {
        params: { path: { id: workspaceId, userId } },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members-profile', workspaceId] })
      setSelectedMember(null)
      notify.success('Member removed')
    },
    onError: (err) => notify.error(apiErrorMessage(err)),
  })

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        m.displayName?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.phone?.toLowerCase().includes(q),
    )
  }, [members, search])

  const { pageItems: pagedMembers, footerProps } = useClientPagination(filteredMembers, 25)

  if (!workspaceId) {
    return <p className="text-ui-lg text-foreground-subtle">No workspace selected.</p>
  }

  if (membersLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-foreground-subtle">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-ui-lg">Loading members…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header row: count + search + invite button ── */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-ui-md text-foreground-subtle">
          {members.length} workspace member{members.length !== 1 ? 's' : ''}
          {invitations.length > 0 && (
            <span className="ml-2 text-warning">
              · {invitations.length} pending invite{invitations.length !== 1 ? 's' : ''}
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search members…"
            width={224}
          />
          <Button size="sm" onClick={() => setShowInvitePanel((v) => !v)}>
            <UserPlus size={13} />
            Invite member
          </Button>
        </div>
      </div>

      {/* ── Invite panel ── */}
      {showInvitePanel && (
        <InvitePanel
          workspaceId={workspaceId}
          roles={roles}
          onClose={() => setShowInvitePanel(false)}
          onSuccess={() => {
            setShowInvitePanel(false)
            qc.invalidateQueries({ queryKey: ['workspace-invitations', workspaceId] })
          }}
        />
      )}

      {/* ── Pending invitations ── */}
      {invitations.length > 0 && (
        <section>
          <h4 className="mb-2 text-ui-sm font-semibold tracking-wide text-foreground-subtle uppercase">
            Pending Invitations
          </h4>
          <div className="overflow-hidden rounded-md border">
            {invitations.map(
              (inv: { id: string; email: string; roleId: string | null; expiresAt: string }) => {
                const roleLabel = roles.find((r) => r.id === inv.roleId)?.name ?? '—'
                const expired = new Date(inv.expiresAt) < new Date()
                return (
                  <div
                    key={inv.id}
                    className={`flex items-center gap-3 border-b border-border-subtle px-4 py-3 text-ui-lg last:border-0 ${
                      expired ? 'bg-destructive-bg' : ''
                    }`}
                  >
                    <Mail size={14} className="shrink-0 text-foreground-subtle" />
                    <div className="min-w-0 flex-1">
                      <span className="text-foreground">{inv.email}</span>
                      <span className="ml-2 text-ui-sm text-foreground-subtle">as {roleLabel}</span>
                    </div>
                    <span
                      className={`shrink-0 text-ui-sm ${expired ? 'text-destructive' : 'text-foreground-subtle'}`}
                    >
                      {expired ? 'Expired' : `Expires ${formatDate(inv.expiresAt)}`}
                    </span>
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
                )
              },
            )}
          </div>
        </section>
      )}

      {/* ── Members table ── */}
      <table className="w-full border-collapse text-ui-lg">
        <thead>
          <tr className="border-b border-border-strong">
            {['Member', 'Email', 'Phone', 'Role', 'Status', 'Last Login', 'Joined'].map((h) => (
              <th
                key={h}
                className="pb-2 text-left text-ui-sm font-semibold tracking-wide text-foreground-subtle uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pagedMembers.map((m) => {
            const isCurrentUser = m.userId === user?.id
            return (
              <tr key={m.id} className="border-b border-border-subtle hover:bg-surface-hover">
                <td className="py-3 pr-4">
                  <button
                    type="button"
                    onClick={() => setSelectedMember(m)}
                    className="flex items-center gap-2 text-left hover:underline"
                  >
                    <OwnerAvatar name={m.displayName} avatarUrl={m.avatarUrl} size={28} />
                    <span className="text-foreground">
                      {m.displayName}
                      {isCurrentUser && (
                        <span className="ml-2 rounded bg-primary-lighter px-1 py-0.5 text-ui-xs text-primary">
                          you
                        </span>
                      )}
                    </span>
                  </button>
                </td>
                <td className="py-3 pr-4 text-muted-foreground">{m.email}</td>
                <td className="py-3 pr-4 text-muted-foreground">{m.phone || '—'}</td>
                <td className="py-3 pr-4">
                  <NativeSelect
                    className="w-auto px-2 py-1 text-ui-md"
                    value={m.roleId ?? ''}
                    disabled={isCurrentUser || changeRole.isPending}
                    aria-label={`Role for ${m.displayName}`}
                    onChange={(e) =>
                      changeRole.mutate({
                        userId: m.userId,
                        oldAssignmentId: m.roleAssignmentId,
                        newRoleId: e.target.value,
                      })
                    }
                  >
                    {!m.roleId && (
                      <option value="" disabled>
                        — no role —
                      </option>
                    )}
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="py-3 pr-4">
                  <MemberStatusBadge status={m.status} />
                </td>
                <td className="py-3 pr-4 text-foreground-subtle">
                  {formatDate(m.lastLoginAt, 'Never')}
                </td>
                <td className="py-3 text-foreground-subtle">{formatDate(m.joinedAt)}</td>
              </tr>
            )
          })}
          {filteredMembers.length === 0 && (
            <tr>
              <td colSpan={7} className="py-8 text-center text-ui-lg text-foreground-subtle">
                {search.trim() ? 'No members match your search.' : 'No members yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {filteredMembers.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border">
          <PaginationFooter {...footerProps} />
        </div>
      )}

      {selectedMember && (
        <UserDetailModal
          member={selectedMember}
          roles={roles}
          isCurrentUser={selectedMember.userId === user?.id}
          onClose={() => setSelectedMember(null)}
          onRemove={() => removeMember.mutate(selectedMember.userId)}
          isRemoving={removeMember.isPending}
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
      label: 'Suspended',
      text: BRAND.danger,
      bg: BRAND.dangerBg,
      border: BRAND.dangerBorder,
    },
  }
  const style = map[status] ?? {
    label: status,
    text: BRAND.textMuted,
    bg: BRAND.surfaceSubtle,
    border: BRAND.border,
  }
  return <StatusBadge style={style} className="capitalize" />
}

// ── User detail modal ─────────────────────────────────────────────────────────

function UserDetailModal({
  member,
  roles,
  isCurrentUser,
  onClose,
  onRemove,
  isRemoving,
}: {
  member: MemberWithProfile
  roles: { id: string; name: string }[]
  isCurrentUser: boolean
  onClose: () => void
  onRemove: () => void
  isRemoving: boolean
}) {
  const roleName = roles.find((r) => r.id === member.roleId)?.name ?? member.roleName ?? '—'
  const isWorkspaceAdmin = member.roleSlug === 'workspace_admin'
  const canRemove = !isCurrentUser && !isWorkspaceAdmin

  return (
    <AppModal open onClose={onClose} title="Member details" width={440}>
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

        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-ui-lg">
          <dt className="text-foreground-subtle">Phone</dt>
          <dd className="text-foreground">{member.phone || '—'}</dd>
          <dt className="text-foreground-subtle">Role</dt>
          <dd className="text-foreground">{roleName}</dd>
          <dt className="text-foreground-subtle">Status</dt>
          <dd>
            <MemberStatusBadge status={member.status} />
          </dd>
          <dt className="text-foreground-subtle">Last login</dt>
          <dd className="text-foreground">{formatDateTime(member.lastLoginAt, 'Never')}</dd>
          <dt className="text-foreground-subtle">Joined</dt>
          <dd className="text-foreground">{formatDate(member.joinedAt)}</dd>
        </dl>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={onRemove}
          disabled={!canRemove || isRemoving}
          title={
            isCurrentUser
              ? 'You cannot remove yourself'
              : isWorkspaceAdmin
                ? 'Workspace admins cannot be removed here'
                : 'Remove workspace access'
          }
        >
          {isRemoving && <Loader2 size={12} className="animate-spin" />}
          Remove access
        </Button>
      </ModalFooter>
    </AppModal>
  )
}

// ── Invite panel ───────────────────────────────────────────────────────────────

function InvitePanel({
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
      notify.success('Invitation sent')
      onSuccess()
    },
    onError: (err: Error) => {
      form.setError('root', { message: err.message })
    },
  })

  return (
    <Card>
      <CardHeader
        title="Invite a new member"
        actions={
          <IconButton size="sm" aria-label="Close invite panel" onClick={onClose}>
            <X size={14} />
          </IconButton>
        }
      />
      <CardBody>
        <form onSubmit={form.handleSubmit((d) => invite.mutate(d))} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <FormField label="Email address" error={form.formState.errors.email?.message}>
              <Input {...form.register('email')} type="email" placeholder="colleague@company.com" />
            </FormField>
            <FormField label="Role" error={form.formState.errors.roleId?.message}>
              <NativeSelect {...form.register('roleId')}>
                <option value="">Select role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          {form.formState.errors.root && (
            <p className="text-ui-md text-destructive">{form.formState.errors.root.message}</p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Mail size={13} />
              )}
              Send invitation
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}
