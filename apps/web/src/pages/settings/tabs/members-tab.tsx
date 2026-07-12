import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Mail, X, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { Field } from './shared'

// ── Invite form schema ─────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  roleId: z.string().min(1, 'Select a role'),
})
type InviteForm = z.infer<typeof inviteSchema>

// ── Members tab (User Management) ─────────────────────────────────────────────

export function MembersTab() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const [showInvitePanel, setShowInvitePanel] = useState(false)

  // Load members with profile + role info
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['workspace-members-profile', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return []
      const res = await apiClient.GET('/v1/workspaces/{id}/members-with-profile', {
        params: { path: { id: workspaceId } },
      })
      return res.data ?? []
    },
    enabled: !!workspaceId,
  })

  // Load pending invitations
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

  // Load available roles
  const { data: roles = [] } = useQuery({
    queryKey: ['system-roles'],
    queryFn: async () => {
      const res = await apiClient.GET('/v1/roles')
      return res.data ?? []
    },
  })

  // Change role mutation: revoke old, assign new
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
      toast.success('Role updated')
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  // Cancel invitation mutation
  const cancelInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      if (!workspaceId) return
      await apiClient.DELETE('/v1/workspaces/{id}/invitations/{invitationId}', {
        params: { path: { id: workspaceId, invitationId } },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-invitations', workspaceId] })
      toast.success('Invitation cancelled')
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  if (!workspaceId) {
    return (
      <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
        No workspace selected.
      </p>
    )
  }

  if (membersLoading) {
    return (
      <div className="flex items-center gap-2 py-10" style={{ color: BRAND.textMuted }}>
        <Loader2 size={16} className="animate-spin" />
        <span className="text-[13px]">Loading members…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header row: count + invite button ── */}
      <div className="flex items-center justify-between">
        <p className="text-[12px]" style={{ color: BRAND.textMuted }}>
          {members.length} workspace member{members.length !== 1 ? 's' : ''}
          {invitations.length > 0 && (
            <span className="ml-2" style={{ color: BRAND.warning }}>
              · {invitations.length} pending invite{invitations.length !== 1 ? 's' : ''}
            </span>
          )}
        </p>
        <button
          onClick={() => setShowInvitePanel((v) => !v)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND.primary }}
        >
          <UserPlus size={13} />
          Invite member
        </button>
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
          <h4
            className="mb-2 text-[11px] font-semibold tracking-wide uppercase"
            style={{ color: BRAND.textMuted }}
          >
            Pending Invitations
          </h4>
          <div
            className="overflow-hidden rounded-md"
            style={{ border: `1px solid ${BRAND.border}` }}
          >
            {invitations.map(
              (
                inv: { id: string; email: string; roleId: string | null; expiresAt: string },
                idx: number,
              ) => {
                const roleLabel = roles.find((r) => r.id === inv.roleId)?.name ?? '—'
                const expiresDate = new Date(inv.expiresAt)
                const expired = expiresDate < new Date()
                return (
                  <div
                    key={inv.id}
                    className="flex items-center gap-3 px-4 py-3 text-[13px]"
                    style={{
                      borderBottom:
                        idx < invitations.length - 1
                          ? `1px solid ${BRAND.borderSubtle}`
                          : undefined,
                      backgroundColor: expired ? BRAND.dangerBg : undefined,
                    }}
                  >
                    <Mail size={14} style={{ color: BRAND.textMuted, flexShrink: 0 }} />
                    <div className="min-w-0 flex-1">
                      <span style={{ color: BRAND.textPrimary }}>{inv.email}</span>
                      <span className="ml-2 text-[11px]" style={{ color: BRAND.textMuted }}>
                        as {roleLabel}
                      </span>
                    </div>
                    <span
                      className="shrink-0 text-[11px]"
                      style={{ color: expired ? BRAND.danger : BRAND.textMuted }}
                    >
                      {expired ? 'Expired' : `Expires ${expiresDate.toLocaleDateString()}`}
                    </span>
                    <button
                      onClick={() => cancelInvite.mutate(inv.id)}
                      disabled={cancelInvite.isPending}
                      title="Cancel invitation"
                      className="shrink-0 rounded p-0.5 hover:bg-[#f0f2f5]"
                    >
                      <X size={13} style={{ color: BRAND.textMuted }} />
                    </button>
                  </div>
                )
              },
            )}
          </div>
        </section>
      )}

      {/* ── Members table ── */}
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
            {['Member', 'Email', 'Role', 'Joined'].map((h) => (
              <th
                key={h}
                className="pb-2 text-left text-[11px] font-semibold tracking-wide uppercase"
                style={{ color: BRAND.textMuted }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const isCurrentUser = m.userId === user?.id
            return (
              <tr
                key={m.id}
                style={{ borderBottom: `1px solid ${BRAND.borderSubtle}` }}
                className="hover:bg-[#f7f8fa]"
              >
                {/* Avatar + name */}
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: BRAND.primary }}
                    >
                      {m.displayName?.charAt(0)?.toUpperCase() ?? '?'}
                    </div>
                    <span style={{ color: BRAND.textPrimary }}>
                      {m.displayName}
                      {isCurrentUser && (
                        <span
                          className="ml-2 rounded px-1 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: '#edf2fb',
                            color: BRAND.primary,
                          }}
                        >
                          you
                        </span>
                      )}
                    </span>
                  </div>
                </td>
                {/* Email */}
                <td className="py-3 pr-4" style={{ color: BRAND.textSecondary }}>
                  {m.email}
                </td>
                {/* Role dropdown */}
                <td className="py-3 pr-4">
                  <select
                    className="rounded border px-2 py-1 text-[12px] focus:outline-none"
                    style={{
                      borderColor: BRAND.border,
                      color: BRAND.textPrimary,
                      backgroundColor: BRAND.surface,
                    }}
                    value={m.roleId ?? ''}
                    disabled={isCurrentUser || changeRole.isPending}
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
                  </select>
                </td>
                {/* Joined date */}
                <td className="py-3" style={{ color: BRAND.textMuted }}>
                  {new Date(m.joinedAt).toLocaleDateString()}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
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
      toast.success('Invitation sent')
      onSuccess()
    },
    onError: (err: Error) => {
      form.setError('root', { message: err.message })
    },
  })

  return (
    <div
      className="rounded-lg p-5"
      style={{ border: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Invite a new member
        </h4>
        <button onClick={onClose} className="rounded p-0.5 hover:bg-[#f0f2f5]">
          <X size={14} style={{ color: BRAND.textMuted }} />
        </button>
      </div>
      <form onSubmit={form.handleSubmit((d) => invite.mutate(d))} className="flex flex-col gap-4">
        <div className="flex gap-3">
          <Field label="Email address" error={form.formState.errors.email?.message}>
            <input
              {...form.register('email')}
              type="email"
              placeholder="colleague@company.com"
              className="w-full rounded-md px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
            />
          </Field>
          <Field label="Role" error={form.formState.errors.roleId?.message}>
            <select
              {...form.register('roleId')}
              className="w-full rounded-md bg-white px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
            >
              <option value="">Select role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {form.formState.errors.root && (
          <p className="text-[12px]" style={{ color: BRAND.danger }}>
            {form.formState.errors.root.message}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={invite.isPending}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {invite.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            Send invitation
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-80"
            style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
