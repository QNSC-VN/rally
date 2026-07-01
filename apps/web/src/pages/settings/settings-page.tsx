import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  UserCheck,
  Bell,
  SlidersHorizontal,
  Activity,
  Tag,
  Globe,
  Users,
  Shield,
  FileText,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  Check,
  Loader2,
  Mail,
  X,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { getAccessToken, cancelProactiveRefresh } from '@/shared/api/http-client'
import { useNavigate } from '@tanstack/react-router'

// ── Tab config (mirrors mockup SettingsPage.tsx) ──────────────────────────────

const SIDEBAR = [
  {
    group: 'Personal',
    items: [
      { key: 'profile', label: 'Profile & Account', icon: UserCheck, gated: false },
      { key: 'notifications', label: 'Notification Preferences', icon: Bell, gated: false },
    ],
  },
  {
    group: 'Project',
    items: [
      { key: 'project', label: 'Project Settings', icon: SlidersHorizontal, gated: true },
      { key: 'workflow', label: 'Workflow Status', icon: Activity, gated: true },
      { key: 'labels', label: 'Labels', icon: Tag, gated: true },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { key: 'workspace', label: 'Workspace Settings', icon: Globe, gated: true },
      { key: 'members', label: 'User Management', icon: Users, gated: true },
      { key: 'roles', label: 'Roles & Permissions', icon: Shield, gated: true },
      { key: 'audit', label: 'Audit Log', icon: FileText, gated: true },
    ],
  },
]

// ── Profile form schema ───────────────────────────────────────────────────────

const profileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required').max(255).trim(),
  avatarUrl: z.string().optional(),
  locale: z.string().min(2).max(10),
  timezone: z.string().min(1).max(100),
})
type ProfileForm = z.infer<typeof profileSchema>

// ── Password form schema ──────────────────────────────────────────────────────

const PASSWORD_RULES = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Z]/, 'Must include an uppercase letter')
  .regex(/[0-9]/, 'Must include a number')
  .regex(/[^A-Za-z0-9]/, 'Must include a special character')

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: PASSWORD_RULES,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
type PasswordForm = z.infer<typeof passwordSchema>

// ── Profile tab ───────────────────────────────────────────────────────────────

function ProfileTab() {
  const { user, setUser } = useAuthStore()
  const navigate = useNavigate()
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)

  const profile = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName ?? '',
      avatarUrl: user?.avatarUrl ?? '',
      locale: user?.locale ?? 'en',
      timezone: user?.timezone ?? 'UTC',
    },
  })

  const password = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  async function onSaveProfile(data: ProfileForm) {
    try {
      const body = {
        displayName: data.displayName,
        avatarUrl: data.avatarUrl?.trim() || null,
        locale: data.locale,
        timezone: data.timezone,
      }
      const {
        data: updated,
        error,
        response,
      } = await apiClient.PATCH('/v1/auth/me', {
        body,
      })
      if (error) {
        profile.setError('root', { message: apiErrorMessage(error, response.status) })
        return
      }
      const u = updated as {
        id: string
        email: string
        displayName: string
        avatarUrl: string | null
        locale: string
        timezone: string
        role: string
        permissions: string[]
        emailVerified: boolean
        createdAt: string
        updatedAt: string
      }
      const token = getAccessToken()
      if (token) {
        setUser(
          { ...u, avatarUrl: u.avatarUrl ?? undefined, permissions: u.permissions ?? [] },
          token,
        )
      }
      toast.success('Profile updated')
    } catch {
      profile.setError('root', { message: 'Network error — please try again.' })
    }
  }

  async function onChangePassword(data: PasswordForm) {
    try {
      const body = { currentPassword: data.currentPassword, newPassword: data.newPassword }
      const { error, response } = await apiClient.PATCH('/v1/auth/password', {
        body,
      })
      if (error) {
        password.setError('root', { message: apiErrorMessage(error, response.status) })
        return
      }
      password.reset()
      setPasswordSaved(true)
      setTimeout(() => setPasswordSaved(false), 3000)
      toast.success('Password changed')
    } catch {
      password.setError('root', { message: 'Network error — please try again.' })
    }
  }

  async function handleLogoutAll() {
    try {
      await apiClient.POST('/v1/auth/logout-all', {})
    } catch {
      /* ignore */
    }
    useAuthStore.getState().clearAuth()
    cancelProactiveRefresh()
    toast.success('Signed out from all devices')
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Profile info ── */}
      <section>
        <h3
          className="mb-4 text-[12px] font-semibold tracking-wide uppercase"
          style={{ color: BRAND.textMuted }}
        >
          Personal Information
        </h3>
        <form
          onSubmit={profile.handleSubmit(onSaveProfile)}
          className="flex max-w-md flex-col gap-4"
        >
          <Field label="Display Name" error={profile.formState.errors.displayName?.message}>
            <input
              {...profile.register('displayName')}
              className="w-full rounded-md px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
              placeholder="Your display name"
            />
          </Field>
          <Field label="Avatar URL" error={profile.formState.errors.avatarUrl?.message}>
            <input
              {...profile.register('avatarUrl')}
              className="w-full rounded-md px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
              placeholder="https://..."
            />
          </Field>
          <Field label="Locale">
            <select
              {...profile.register('locale')}
              className="w-full rounded-md bg-white px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
            >
              <option value="en">English</option>
              <option value="vi">Tiếng Việt</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
            </select>
          </Field>
          <Field label="Timezone">
            <select
              {...profile.register('timezone')}
              className="w-full rounded-md bg-white px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
            >
              {[
                'UTC',
                'Asia/Ho_Chi_Minh',
                'Asia/Tokyo',
                'America/New_York',
                'America/Los_Angeles',
                'Europe/London',
                'Europe/Paris',
              ].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
          {profile.formState.errors.root && (
            <p className="text-[12px]" style={{ color: BRAND.danger }}>
              {profile.formState.errors.root.message}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={profile.formState.isSubmitting}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: BRAND.primary }}
            >
              {profile.formState.isSubmitting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : null}
              Save changes
            </button>
          </div>
        </form>
      </section>

      <Divider />

      {/* ── Change password ── */}
      <section>
        <h3
          className="mb-4 text-[12px] font-semibold tracking-wide uppercase"
          style={{ color: BRAND.textMuted }}
        >
          Change Password
        </h3>
        <form
          onSubmit={password.handleSubmit(onChangePassword)}
          className="flex max-w-md flex-col gap-4"
        >
          <Field
            label="Current Password"
            error={password.formState.errors.currentPassword?.message}
          >
            <PasswordInput
              show={showCurrent}
              onToggle={() => setShowCurrent(!showCurrent)}
              {...password.register('currentPassword')}
            />
          </Field>
          <Field label="New Password" error={password.formState.errors.newPassword?.message}>
            <PasswordInput
              show={showNew}
              onToggle={() => setShowNew(!showNew)}
              {...password.register('newPassword')}
            />
          </Field>
          <Field
            label="Confirm New Password"
            error={password.formState.errors.confirmPassword?.message}
          >
            <PasswordInput
              show={showConfirm}
              onToggle={() => setShowConfirm(!showConfirm)}
              {...password.register('confirmPassword')}
            />
          </Field>
          {password.formState.errors.root && (
            <p className="text-[12px]" style={{ color: BRAND.danger }}>
              {password.formState.errors.root.message}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={password.formState.isSubmitting}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: BRAND.primary }}
            >
              {password.formState.isSubmitting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : passwordSaved ? (
                <Check size={13} />
              ) : null}
              {passwordSaved ? 'Password changed!' : 'Change password'}
            </button>
          </div>
        </form>
      </section>

      <Divider />

      {/* ── Account ── */}
      <section>
        <h3
          className="mb-1 text-[12px] font-semibold tracking-wide uppercase"
          style={{ color: BRAND.textMuted }}
        >
          Account
        </h3>
        <p className="mb-4 text-[12px]" style={{ color: BRAND.textSecondary }}>
          Email:{' '}
          <span className="font-medium" style={{ color: BRAND.textPrimary }}>
            {user?.email}
          </span>
          {user?.emailVerified === false && (
            <span className="ml-2 text-[11px] font-semibold" style={{ color: BRAND.warning }}>
              Not verified
            </span>
          )}
        </p>
        <button
          onClick={() => void handleLogoutAll()}
          className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium transition-colors hover:opacity-80"
          style={{
            border: `1px solid ${BRAND.dangerBorder}`,
            color: BRAND.danger,
            backgroundColor: BRAND.dangerBg,
          }}
        >
          <LogOut size={13} />
          Sign out from all devices
        </button>
      </section>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        className="mb-1.5 block text-[12px] font-medium"
        style={{ color: BRAND.textSecondary }}
      >
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[11px]" style={{ color: BRAND.danger }}>
          {error}
        </p>
      )}
    </div>
  )
}

function Divider() {
  return <hr style={{ borderColor: BRAND.borderSubtle }} />
}

import { forwardRef } from 'react'
const PasswordInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { show: boolean; onToggle: () => void }
>(({ show, onToggle, ...props }, ref) => (
  <div className="relative">
    <input
      ref={ref}
      type={show ? 'text' : 'password'}
      className="w-full rounded-md px-3 py-2 pr-9 text-[13px] focus:outline-none"
      style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
      {...props}
    />
    <button
      type="button"
      onClick={onToggle}
      className="absolute top-1/2 right-2.5 -translate-y-1/2"
      tabIndex={-1}
    >
      {show ? (
        <EyeOff size={14} style={{ color: BRAND.textMuted }} />
      ) : (
        <Eye size={14} style={{ color: BRAND.textMuted }} />
      )}
    </button>
  </div>
))
PasswordInput.displayName = 'PasswordInput'

// ── Invite form schema ─────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  roleId: z.string().min(1, 'Select a role'),
})
type InviteForm = z.infer<typeof inviteSchema>

// ── Members tab (User Management) ─────────────────────────────────────────────

function MembersTab() {
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
                      className="shrink-0 rounded p-0.5 hover:bg-[#f0f2f5] disabled:opacity-50"
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

// ── Coming soon tab ───────────────────────────────────────────────────────────

function ComingSoonTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <Lock size={22} style={{ color: BRAND.border }} />
      <p className="text-[13px] font-medium" style={{ color: BRAND.textSecondary }}>
        {label}
      </p>
      <p className="text-[12px]" style={{ color: BRAND.textMuted }}>
        Available in a future release.
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('profile')
  const { hasPermission } = useAuthStore()
  // Workspace admins (workspace:*) can navigate to gated tabs (shows Coming Soon)
  // Non-admins see gated tabs as locked
  const isAdmin = hasPermission('workspace:*')

  const allItems = SIDEBAR.flatMap((g) => g.items)
  const activeLabel = allItems.find((i) => i.key === activeTab)?.label ?? 'Settings'

  return (
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: BRAND.pageBg }}>
      {/* ── Left sidebar ── */}
      <aside
        className="w-52 shrink-0 overflow-y-auto px-3 py-4"
        style={{ borderRight: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
      >
        {SIDEBAR.map((group) => (
          <div key={group.group} className="mb-4">
            <p
              className="mb-1 px-2 text-[10px] font-semibold tracking-wider uppercase"
              style={{ color: BRAND.textMuted }}
            >
              {group.group}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.key
              // Gated items: admin can click (gets coming-soon), non-admin is locked
              const locked = item.gated && !isAdmin
              const clickable = !locked
              return (
                <button
                  key={item.key}
                  onClick={() => clickable && setActiveTab(item.key)}
                  disabled={locked}
                  title={locked ? 'Requires admin role' : undefined}
                  className="mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    backgroundColor: isActive ? '#edf2fb' : 'transparent',
                    color: isActive ? BRAND.primary : BRAND.textSecondary,
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  <Icon size={13} style={{ color: isActive ? BRAND.primary : BRAND.textMuted }} />
                  {item.label}
                  {locked && <Lock size={10} className="ml-auto" style={{ color: BRAND.border }} />}
                </button>
              )
            })}
          </div>
        ))}
      </aside>

      {/* ── Content ── */}
      <main className="flex-1 overflow-y-auto p-8">
        <h2 className="mb-6 text-[15px] font-semibold" style={{ color: BRAND.textPrimary }}>
          {activeLabel}
        </h2>
        {activeTab === 'profile' ? (
          <ProfileTab />
        ) : activeTab === 'members' ? (
          <MembersTab />
        ) : (
          <ComingSoonTab label={activeLabel} />
        )}
      </main>
    </div>
  )
}
