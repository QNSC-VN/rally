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
  UsersRound,
  Shield,
  FileText,
  Lock,
  LogOut,
  Loader2,
  Mail,
  X,
  UserPlus,
  Plus,
  Pencil,
  ChevronRight,
  ArrowLeft,
  Archive,
} from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { PERMISSION, type Permission } from '@/shared/config/permissions'
import type { ComponentType } from 'react'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { getAccessToken, cancelProactiveRefresh } from '@/shared/api/http-client'
import { useNavigate } from '@tanstack/react-router'
import {
  useWorkspaceTeams,
  useTeamMembers,
  useCreateTeam,
  useUpdateTeam,
  useAddTeamMember,
  useRemoveTeamMember,
  type Team,
} from '@/features/teams/api'
import { useWorkspaces, useUpdateWorkspace } from '@/features/workspaces/api'
import { useProjects, useUpdateProject } from '@/features/projects/api'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'

// ── Tab config (mirrors mockup SettingsPage.tsx) ──────────────────────────────

// `requires`: the permission the tab's underlying API actually enforces, so FE
// gating and backend authorization agree. null = always available. Codes come
// from the shared catalogue (mirrored in shared/config/permissions.ts).
type SettingsTab = {
  key: string
  label: string
  icon: ComponentType<{ size?: number | string; style?: React.CSSProperties }>
  requires: Permission | null
}
type SettingsGroup = { group: string; items: SettingsTab[] }

const SIDEBAR: SettingsGroup[] = [
  {
    group: 'Personal',
    items: [
      { key: 'profile', label: 'Profile & Account', icon: UserCheck, requires: null },
      { key: 'notifications', label: 'Notification Preferences', icon: Bell, requires: null },
    ],
  },
  {
    group: 'Project',
    items: [
      {
        key: 'project',
        label: 'Project Settings',
        icon: SlidersHorizontal,
        requires: PERMISSION.PROJECT_EDIT,
      },
      {
        key: 'workflow',
        label: 'Workflow Status',
        icon: Activity,
        requires: PERMISSION.PROJECT_EDIT,
      },
      { key: 'labels', label: 'Labels', icon: Tag, requires: PERMISSION.PROJECT_EDIT },
    ],
  },
  {
    group: 'Workspace',
    items: [
      {
        key: 'workspace',
        label: 'Workspace Settings',
        icon: Globe,
        requires: PERMISSION.WORKSPACE_VIEW,
      },
      {
        key: 'members',
        label: 'User Management',
        icon: Users,
        requires: PERMISSION.WORKSPACE_MANAGE_MEMBERS,
      },
      {
        key: 'teams',
        label: 'Teams',
        icon: UsersRound,
        requires: PERMISSION.WORKSPACE_MANAGE_TEAMS,
      },
      {
        key: 'roles',
        label: 'Roles & Permissions',
        icon: Shield,
        requires: PERMISSION.WORKSPACE_MANAGE_MEMBERS,
      },
      { key: 'audit', label: 'Audit Log', icon: FileText, requires: PERMISSION.WORKSPACE_ALL },
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

// ── Profile tab ───────────────────────────────────────────────────────────────

function ProfileTab() {
  const { user, setUser } = useAuthStore()
  const navigate = useNavigate()

  const profile = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName ?? '',
      avatarUrl: user?.avatarUrl ?? '',
      locale: user?.locale ?? 'en',
      timezone: user?.timezone ?? 'UTC',
    },
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

      {/* ── Password & security ── */}
      <section>
        <h3
          className="mb-2 text-[12px] font-semibold tracking-wide uppercase"
          style={{ color: BRAND.textMuted }}
        >
          Password &amp; Security
        </h3>
        <p className="max-w-md text-[12px]" style={{ color: BRAND.textSecondary }}>
          Your password and multi-factor authentication are managed by your organisation through
          Microsoft. Sign in with your organisational account to update security settings.
        </p>
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

// ── Workspace Settings tab ────────────────────────────────────────────────────

function WorkspaceSettingsTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const setWorkspace = useAppContext((s) => s.setWorkspace)
  const workspace = useAppContext((s) => s.workspace)
  const { data: workspaces = [] } = useWorkspaces()
  const current = workspaces.find((w) => w.id === workspaceId)
  const update = useUpdateWorkspace(workspaceId)

  const [name, setName] = useState(current?.name ?? workspace?.workspaceName ?? '')
  const [description, setDescription] = useState(current?.description ?? '')

  // Sync form once when workspace data first loads (current.id becomes defined).
  // Tracking the id (not the object) avoids resetting mid-edit on background refetches.
  const [syncedId, setSyncedId] = useState(current?.id)
  if (current && current.id !== syncedId) {
    setSyncedId(current.id)
    setName(current.name)
    setDescription(current.description ?? '')
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !name.trim()) return
    try {
      const updated = await update.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
      })
      setWorkspace({
        workspaceId,
        workspaceSlug: workspace?.workspaceSlug ?? '',
        workspaceName: updated.name,
      })
      toast.success('Workspace settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSave(e)
      }}
      className="max-w-lg space-y-5"
    >
      <FormField label="Workspace name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
      </FormField>
      <FormField label="Description">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this workspace cover?"
          rows={3}
        />
      </FormField>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={update.isPending || !name.trim()}
          className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: BRAND.primary }}
        >
          {update.isPending && <Loader2 size={12} className="animate-spin" />}
          Save changes
        </button>
      </div>
    </form>
  )
}

// ── Project Settings tab ──────────────────────────────────────────────────────

function ProjectSettingsTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const activeProject = useAppContext((s) => s.project)
  const setProject = useAppContext((s) => s.setProject)
  const { data: projects = [] } = useProjects(workspaceId)
  const current = projects.find((p) => p.id === activeProject?.projectId)
  const update = useUpdateProject(workspaceId)

  const [name, setName] = useState(current?.name ?? activeProject?.projectName ?? '')
  const [description, setDescription] = useState(current?.description ?? '')

  // Sync form when project data loads or the active project switches.
  // Tracking current.id avoids resetting mid-edit on background refetches
  // while still resetting correctly when the user picks a different project.
  const [syncedId, setSyncedId] = useState(current?.id)
  if (current && current.id !== syncedId) {
    setSyncedId(current.id)
    setName(current.name)
    setDescription(current.description ?? '')
  }

  if (!activeProject) {
    return (
      <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
        No project selected. Navigate into a project first.
      </p>
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!activeProject || !name.trim()) return
    try {
      await update.mutateAsync({
        id: activeProject.projectId,
        input: { name: name.trim(), description: description.trim() || undefined },
      })
      setProject({
        projectId: activeProject.projectId,
        projectKey: activeProject.projectKey,
        projectName: name.trim(),
      })
      toast.success('Project settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSave(e)
      }}
      className="max-w-lg space-y-5"
    >
      <div
        className="mb-2 rounded-md px-3 py-2 text-[12px]"
        style={{
          backgroundColor: BRAND.surface,
          border: `1px solid ${BRAND.border}`,
          color: BRAND.textMuted,
        }}
      >
        Project:{' '}
        <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
          {activeProject.projectKey} — {activeProject.projectName}
        </span>
      </div>
      <FormField label="Project name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
      </FormField>
      <FormField label="Description">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this project deliver?"
          rows={3}
        />
      </FormField>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={update.isPending || !name.trim()}
          className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: BRAND.primary }}
        >
          {update.isPending && <Loader2 size={12} className="animate-spin" />}
          Save changes
        </button>
      </div>
    </form>
  )
}

// ── Teams tab ─────────────────────────────────────────────────────────────────

function CreateTeamModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const create = useCreateTeam()

  // Auto-generate key from name
  function derivedKey(n: string) {
    return n
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8)
  }

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
      toast.success(`Team "${name}" created`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create team')
    }
  }

  return (
    <AppModal open onClose={onClose} title="New Team" width={440}>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
      >
        <ModalBody className="space-y-4">
          <FormField label="Team name" required>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!key || key === derivedKey(name)) setKey(derivedKey(e.target.value))
              }}
              placeholder="Platform Engineering"
              autoFocus
            />
          </FormField>
          <FormField label="Key" required hint="Short alphanumeric identifier (max 8 chars)">
            <Input
              value={key}
              onChange={(e) =>
                setKey(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 8),
                )
              }
              placeholder="PLAT"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this team own?"
              rows={2}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <button
            type="submit"
            disabled={create.isPending || !name.trim() || !key.trim()}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {create.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            Create team
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-80"
            style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
          >
            Cancel
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function EditTeamModal({ team, onClose }: { team: Team; onClose: () => void }) {
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
      toast.success('Team updated')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update team')
    }
  }

  return (
    <AppModal open onClose={onClose} title={`Edit ${team.name}`} width={440}>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
      >
        <ModalBody className="space-y-4">
          <FormField label="Team name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Team lead">
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
              style={{
                borderColor: BRAND.border,
                backgroundColor: BRAND.surface,
                color: BRAND.textPrimary,
              }}
            >
              <option value="">— No lead —</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName ?? m.email ?? m.userId}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <button
            type="submit"
            disabled={update.isPending || !name.trim()}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {update.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-medium"
            style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
          >
            Cancel
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function AddMemberModal({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const [selectedUserId, setSelectedUserId] = useState('')
  const addMember = useAddTeamMember(teamId)
  const { data: members = [] } = useTeamMembers(teamId)

  // Load workspace members for the dropdown
  const { data: workspaceMembers = [] } = useQuery({
    queryKey: ['workspace-members-profile', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return []
      const { data, error, response } = await apiClient.GET('/v1/workspaces/{id}/members', {
        params: { path: { id: workspaceId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return ((data as { data?: unknown[] })?.data ?? []) as Array<{
        userId: string
        displayName?: string
        email?: string
      }>
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  const alreadyAdded = new Set(members.map((m) => m.userId))
  const available = workspaceMembers.filter((m) => !alreadyAdded.has(m.userId))

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUserId) return
    try {
      await addMember.mutateAsync(selectedUserId)
      toast.success('Member added')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add member')
    }
  }

  return (
    <AppModal open onClose={onClose} title="Add team member" width={400}>
      <form
        onSubmit={(e) => {
          void handleAdd(e)
        }}
      >
        <ModalBody className="space-y-4">
          {available.length === 0 ? (
            <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
              All workspace members are already on this team.
            </p>
          ) : (
            <FormField label="Select member" required>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                style={{
                  borderColor: BRAND.border,
                  backgroundColor: BRAND.surface,
                  color: BRAND.textPrimary,
                }}
              >
                <option value="">— Select a member —</option>
                {available.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ?? m.email ?? m.userId}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="submit"
            disabled={addMember.isPending || !selectedUserId || available.length === 0}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {addMember.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <UserPlus size={13} />
            )}
            Add to team
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-medium"
            style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
          >
            Cancel
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function TeamDetail({ team, onBack }: { team: Team; onBack: () => void }) {
  const { data: members = [], isLoading } = useTeamMembers(team.id)
  const remove = useRemoveTeamMember(team.id)
  const update = useUpdateTeam(team.id)
  const [showEdit, setShowEdit] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)

  async function handleRemoveMember(userId: string) {
    try {
      await remove.mutateAsync(userId)
      toast.success('Member removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  async function handleToggleStatus() {
    const next = team.status === 'active' ? 'archived' : 'active'
    if (
      next === 'archived' &&
      !window.confirm(`Archive team "${team.name}"? It will be hidden from active team lists.`)
    ) {
      return
    }
    try {
      await update.mutateAsync({ status: next })
      toast.success(next === 'archived' ? 'Team archived' : 'Team restored')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update team status')
    }
  }

  return (
    <div>
      {/* Back + header */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[12px] transition-opacity hover:opacity-70"
          style={{ color: BRAND.textMuted }}
        >
          <ArrowLeft size={13} /> All teams
        </button>
        <span style={{ color: BRAND.border }}>·</span>
        <span className="text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>
          {team.name}
        </span>
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium"
          style={{
            backgroundColor: BRAND.surface,
            border: `1px solid ${BRAND.border}`,
            color: BRAND.textMuted,
          }}
        >
          {team.key}
        </span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${team.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}
        >
          {team.status}
        </span>
        <button
          onClick={() => setShowEdit(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-100"
          style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
        >
          <Pencil size={12} /> Edit
        </button>
        <button
          onClick={() => {
            void handleToggleStatus()
          }}
          disabled={update.isPending}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-100 disabled:opacity-60"
          style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
        >
          {update.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Archive size={12} />
          )}
          {team.status === 'active' ? 'Archive' : 'Restore'}
        </button>
      </div>

      {team.description && (
        <p className="mb-5 text-[13px]" style={{ color: BRAND.textSecondary }}>
          {team.description}
        </p>
      )}

      {/* Members section */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Members ({members.length})
        </h3>
        <button
          onClick={() => setShowAddMember(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND.primary }}
        >
          <Plus size={12} /> Add member
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={18} className="animate-spin" style={{ color: BRAND.textMuted }} />
        </div>
      ) : members.length === 0 ? (
        <div
          className="rounded-lg py-10 text-center"
          style={{ border: `1px dashed ${BRAND.border}` }}
        >
          <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
            No members yet. Add someone to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg" style={{ border: `1px solid ${BRAND.border}` }}>
          {members.map((member, idx) => (
            <div
              key={member.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                borderTop: idx > 0 ? `1px solid ${BRAND.border}` : undefined,
              }}
            >
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: BRAND.primary }}
              >
                {(member.displayName ?? member.userId).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[13px] font-medium"
                  style={{ color: BRAND.textPrimary }}
                >
                  {member.displayName ?? member.userId}
                </p>
                {member.email && (
                  <p className="truncate text-[11px]" style={{ color: BRAND.textMuted }}>
                    {member.email}
                  </p>
                )}
              </div>
              <span className="text-[11px] capitalize" style={{ color: BRAND.textMuted }}>
                {member.status}
              </span>
              <button
                onClick={() => {
                  void handleRemoveMember(member.userId)
                }}
                disabled={remove.isPending}
                className="ml-2 rounded p-1 transition-colors hover:bg-red-50 hover:text-red-600"
                style={{ color: BRAND.textMuted }}
                title="Remove from team"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showEdit && <EditTeamModal team={team} onClose={() => setShowEdit(false)} />}
      {showAddMember && <AddMemberModal teamId={team.id} onClose={() => setShowAddMember(false)} />}
    </div>
  )
}

function TeamsTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: teams = [], isLoading } = useWorkspaceTeams(workspaceId)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)

  if (selectedTeam) {
    // Sync the selected team with live data (in case members change)
    const live = teams.find((t) => t.id === selectedTeam.id) ?? selectedTeam
    return <TeamDetail team={live} onBack={() => setSelectedTeam(null)} />
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
          Teams group members who collaborate on the same projects.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND.primary }}
        >
          <Plus size={13} /> New team
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin" style={{ color: BRAND.textMuted }} />
        </div>
      ) : teams.length === 0 ? (
        <div
          className="rounded-lg py-16 text-center"
          style={{ border: `1px dashed ${BRAND.border}` }}
        >
          <UsersRound size={28} className="mx-auto mb-3" style={{ color: BRAND.border }} />
          <p className="text-[13px] font-medium" style={{ color: BRAND.textSecondary }}>
            No teams yet
          </p>
          <p className="mt-1 text-[12px]" style={{ color: BRAND.textMuted }}>
            Create a team to group members and assign work items.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg" style={{ border: `1px solid ${BRAND.border}` }}>
          {teams.map((team, idx) => (
            <button
              key={team.id}
              onClick={() => setSelectedTeam(team)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-gray-50"
              style={{
                borderTop: idx > 0 ? `1px solid ${BRAND.border}` : undefined,
              }}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-md text-[12px] font-bold text-white"
                style={{ backgroundColor: BRAND.primary }}
              >
                {team.key.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>
                  {team.name}
                </p>
                {team.description && (
                  <p className="truncate text-[12px]" style={{ color: BRAND.textMuted }}>
                    {team.description}
                  </p>
                )}
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${team.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}
              >
                {team.status}
              </span>
              <ChevronRight size={14} style={{ color: BRAND.textMuted }} />
            </button>
          ))}
        </div>
      )}

      {showCreate && workspaceId && (
        <CreateTeamModal workspaceId={workspaceId} onClose={() => setShowCreate(false)} />
      )}
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
  // Each tab is gated on the exact permission its API enforces, so what the FE
  // shows matches what the backend allows. hasPermission handles the workspace:*
  // and namespace wildcards, so an admin still sees everything.

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
              // Locked when the tab requires a permission the user doesn't hold.
              const locked = item.requires !== null && !hasPermission(item.requires)
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
        ) : activeTab === 'teams' ? (
          <TeamsTab />
        ) : activeTab === 'workspace' ? (
          <WorkspaceSettingsTab />
        ) : activeTab === 'project' ? (
          <ProjectSettingsTab />
        ) : (
          <ComingSoonTab label={activeLabel} />
        )}
      </main>
    </div>
  )
}
