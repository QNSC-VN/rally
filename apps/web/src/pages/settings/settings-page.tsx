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
  Search,
  Clock,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Trash2,
  Check,
  Save,
} from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { PERMISSION, type Permission } from '@/shared/config/permissions'
import type { ComponentType } from 'react'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
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
import {
  useProjects,
  useUpdateProject,
  useProjectStatuses,
  useCreateStatus,
  useDeleteStatus,
  useReorderStatuses,
  type ProjectStatus,
  useProjectLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  type ProjectLabel,
} from '@/features/projects/api'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { ConfirmDeleteModal } from '@/shared/ui/confirm-delete-modal'
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
  phone: z.string().max(32).trim().optional(),
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
      phone: user?.phone ?? '',
    },
  })

  async function onSaveProfile(data: ProfileForm) {
    try {
      const body = {
        displayName: data.displayName,
        avatarUrl: data.avatarUrl?.trim() || null,
        locale: data.locale,
        timezone: data.timezone,
        phone: data.phone?.trim() || null,
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
        phone: string | null
        role: string
        permissions: string[]
        emailVerified: boolean
        createdAt: string
        updatedAt: string
      }
      setUser(
        { ...u, avatarUrl: u.avatarUrl ?? undefined, permissions: u.permissions ?? [] },
        useAuthStore.getState().memberships,
      )
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
          <Field label="Phone" error={profile.formState.errors.phone?.message}>
            <input
              {...profile.register('phone')}
              className="w-full rounded-md px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
              placeholder="+84 ..."
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

type MemberWithProfile = components['schemas']['MemberWithProfileResponseDto']

function MembersTab() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const [showInvitePanel, setShowInvitePanel] = useState(false)
  const [selectedMember, setSelectedMember] = useState<MemberWithProfile | null>(null)

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

  // Remove member (revoke workspace access)
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
      toast.success('Member removed')
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
                      className="shrink-0 rounded p-0.5 hover:bg-background disabled:opacity-50"
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
            {['Member', 'Phone', 'Role', 'Status', 'Last Login', 'Joined'].map((h) => (
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
                className="hover:bg-surface-hover"
              >
                {/* Avatar + name */}
                <td className="py-3 pr-4">
                  <button
                    type="button"
                    onClick={() => setSelectedMember(m)}
                    className="flex items-center gap-2 text-left hover:underline"
                  >
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
                  </button>
                </td>
                {/* Phone */}
                <td className="py-3 pr-4" style={{ color: BRAND.textSecondary }}>
                  {m.phone || '—'}
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
                {/* Status */}
                <td className="py-3 pr-4">
                  <MemberStatusBadge status={m.status} />
                </td>
                {/* Last login */}
                <td className="py-3 pr-4" style={{ color: BRAND.textMuted }}>
                  {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString() : 'Never'}
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
  const map: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: 'Active', color: BRAND.success, bg: BRAND.successBg },
    invited: { label: 'Invited', color: BRAND.warning, bg: BRAND.warningBg },
    suspended: { label: 'Suspended', color: BRAND.danger, bg: BRAND.dangerBg },
  }
  const s = map[status] ?? { label: status, color: BRAND.textMuted, bg: BRAND.surfaceSubtle }
  return (
    <span
      className="rounded px-2 py-0.5 text-[11px] font-semibold capitalize"
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      {s.label}
    </span>
  )
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
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
            style={{ backgroundColor: BRAND.primary }}
          >
            {member.displayName?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold" style={{ color: BRAND.textPrimary }}>
              {member.displayName}
            </p>
            <p className="truncate text-[12px]" style={{ color: BRAND.textMuted }}>
              {member.email}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13px]">
          <dt style={{ color: BRAND.textMuted }}>Phone</dt>
          <dd style={{ color: BRAND.textPrimary }}>{member.phone || '—'}</dd>
          <dt style={{ color: BRAND.textMuted }}>Role</dt>
          <dd style={{ color: BRAND.textPrimary }}>{roleName}</dd>
          <dt style={{ color: BRAND.textMuted }}>Status</dt>
          <dd>
            <MemberStatusBadge status={member.status} />
          </dd>
          <dt style={{ color: BRAND.textMuted }}>Last login</dt>
          <dd style={{ color: BRAND.textPrimary }}>
            {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : 'Never'}
          </dd>
          <dt style={{ color: BRAND.textMuted }}>Joined</dt>
          <dd style={{ color: BRAND.textPrimary }}>
            {new Date(member.joinedAt).toLocaleDateString()}
          </dd>
        </dl>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-4 py-2 text-[13px] font-semibold"
          style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
        >
          Close
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove || isRemoving}
          title={
            isCurrentUser
              ? 'You cannot remove yourself'
              : isWorkspaceAdmin
                ? 'Workspace admins cannot be removed here'
                : 'Remove workspace access'
          }
          className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: BRAND.danger }}
        >
          {isRemoving && <Loader2 size={12} className="animate-spin" />}
          Remove access
        </button>
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
        <button onClick={onClose} className="rounded p-0.5 hover:bg-background">
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

  // Read-only workspace admins, derived from the members-with-profile surface.
  const { data: admins = [] } = useQuery({
    queryKey: ['workspace-admins', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return []
      const res = await apiClient.GET('/v1/workspaces/{id}/members-with-profile', {
        params: { path: { id: workspaceId } },
      })
      return (res.data ?? []).filter((m) => m.roleSlug === 'workspace_admin')
    },
    enabled: !!workspaceId,
  })

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
      {/* ── Read-only identity ── */}
      <div className="rounded-md" style={{ border: `1px solid ${BRAND.border}` }}>
        <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2.5 p-4 text-[13px]">
          <dt style={{ color: BRAND.textMuted }}>Slug</dt>
          <dd className="font-mono" style={{ color: BRAND.textPrimary }}>
            {current?.slug ?? workspace?.workspaceSlug ?? '—'}
          </dd>
          <dt style={{ color: BRAND.textMuted }}>Workspace admin</dt>
          <dd style={{ color: BRAND.textPrimary }}>
            {admins.length === 0 ? '—' : admins.map((a) => a.displayName).join(', ')}
          </dd>
        </dl>
      </div>

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

// ── Workflow status tab ────────────────────────────────────────────────────────

const STATUS_CATEGORIES = [
  { value: 'to_do', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
] as const

type StatusCategory = (typeof STATUS_CATEGORIES)[number]['value']

/** Brand-consistent badge colours for a workflow-status category. */
function statusCategoryStyle(category: StatusCategory): { bg: string; text: string } {
  switch (category) {
    case 'in_progress':
      return { bg: BRAND.warningBg, text: BRAND.warning }
    case 'done':
      return { bg: BRAND.successBg, text: BRAND.success }
    case 'to_do':
    default:
      return { bg: BRAND.surfaceSubtle, text: BRAND.textSecondary }
  }
}

function categoryLabel(category: string): string {
  return STATUS_CATEGORIES.find((c) => c.value === category)?.label ?? category
}

function AddStatusModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<StatusCategory>('to_do')
  const [color, setColor] = useState('#6b7280')
  const create = useCreateStatus(projectId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await create.mutateAsync({ name: name.trim(), category, color })
      toast.success(`Status "${name.trim()}" added`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add status')
    }
  }

  return (
    <AppModal open onClose={onClose} title="Add Status" width={420}>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
      >
        <ModalBody className="space-y-4">
          <FormField label="Status name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="In Review"
              autoFocus
            />
          </FormField>
          <FormField label="Category" required>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as StatusCategory)}
              className="w-full rounded-md bg-white px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
            >
              {STATUS_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Colour">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-16 cursor-pointer rounded-md bg-white p-1"
              style={{ border: `1px solid ${BRAND.border}` }}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-semibold"
            style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending || !name.trim()}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {create.isPending && <Loader2 size={12} className="animate-spin" />}
            Add Status
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function WorkflowTab() {
  const activeProject = useAppContext((s) => s.project)
  const { hasPermission } = useAuthStore()
  const canManage = hasPermission(PERMISSION.PROJECT_EDIT)
  const projectId = activeProject?.projectId

  const { data: statuses = [], isLoading, isError } = useProjectStatuses(projectId)
  const reorder = useReorderStatuses(projectId)
  const remove = useDeleteStatus(projectId)
  const [showAdd, setShowAdd] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectStatus | null>(null)

  if (!activeProject) {
    return (
      <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
        No project selected. Navigate into a project first.
      </p>
    )
  }

  const ordered = [...statuses].sort((a, b) => a.position - b.position)

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    const ids = ordered.map((s) => s.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      await reorder.mutateAsync(ids)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reorder statuses')
    }
  }

  async function handleDelete(status: ProjectStatus) {
    try {
      await remove.mutateAsync(status.id)
      toast.success(`Status "${status.name}" deleted`)
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete status')
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
          Define the statuses work items move through in{' '}
          <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
            {activeProject.projectKey}
          </span>
          .
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold"
            style={{ border: `1px solid ${BRAND.primary}`, color: BRAND.primary }}
          >
            <Plus size={13} /> Add Status
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={18} className="animate-spin" style={{ color: BRAND.textMuted }} />
        </div>
      ) : isError ? (
        <p className="py-20 text-center text-[13px]" style={{ color: BRAND.textSecondary }}>
          Unable to load statuses. Please try again.
        </p>
      ) : ordered.length === 0 ? (
        <p className="py-20 text-center text-[13px]" style={{ color: BRAND.textMuted }}>
          No statuses defined yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md" style={{ border: `1px solid ${BRAND.border}` }}>
          <div
            className="flex items-center gap-2 px-3 py-2 text-[10px] font-semibold tracking-wider uppercase"
            style={{ backgroundColor: BRAND.surfaceHover, color: BRAND.textMuted }}
          >
            <div className="flex-1">Status Name</div>
            <div className="w-28">Category</div>
            <div className="w-16 text-center">Default</div>
            <div className="w-24 text-right">Actions</div>
          </div>
          {ordered.map((status, index) => {
            const badge = statusCategoryStyle(status.category as StatusCategory)
            return (
              <div
                key={status.id}
                className="flex items-center gap-2 px-3 py-2.5"
                style={{ borderTop: `1px solid ${BRAND.borderInner}` }}
              >
                <div className="flex flex-1 items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: status.color ?? BRAND.textMuted }}
                  />
                  <span className="text-[13px] font-medium" style={{ color: BRAND.textPrimary }}>
                    {status.name}
                  </span>
                </div>
                <div className="w-28">
                  <span
                    className="rounded px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: badge.bg, color: badge.text }}
                  >
                    {categoryLabel(status.category)}
                  </span>
                </div>
                <div className="w-16 text-center">
                  {status.isDefault && (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase"
                      style={{ backgroundColor: BRAND.surfaceHover, color: BRAND.textSecondary }}
                    >
                      Default
                    </span>
                  )}
                </div>
                <div className="flex w-24 items-center justify-end gap-0.5">
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => void move(index, -1)}
                        disabled={index === 0 || reorder.isPending}
                        className="rounded p-1 disabled:opacity-30"
                        style={{ color: BRAND.textMuted }}
                        title="Move up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void move(index, 1)}
                        disabled={index === ordered.length - 1 || reorder.isPending}
                        className="rounded p-1 disabled:opacity-30"
                        style={{ color: BRAND.textMuted }}
                        title="Move down"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(status)}
                        disabled={remove.isPending}
                        className="rounded p-1 disabled:opacity-30"
                        style={{ color: BRAND.textMuted }}
                        title="Delete status"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && projectId && (
        <AddStatusModal projectId={projectId} onClose={() => setShowAdd(false)} />
      )}

      <ConfirmDeleteModal
        open={!!deleteTarget}
        title="Delete status"
        confirmText={deleteTarget?.name ?? ''}
        description="Work items in this status must be moved elsewhere first. This cannot be undone."
        confirmLabel="Delete status"
        isPending={remove.isPending}
        onConfirm={() => deleteTarget && void handleDelete(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ── Labels tab ────────────────────────────────────────────────────────────────

const DEFAULT_LABEL_COLOR = '#6b7280'

function LabelsTab() {
  const activeProject = useAppContext((s) => s.project)
  const { hasPermission } = useAuthStore()
  const canManage = hasPermission(PERMISSION.PROJECT_EDIT)
  const projectId = activeProject?.projectId

  const { data: labels = [], isLoading, isError } = useProjectLabels(projectId)
  const remove = useDeleteLabel(projectId)
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<ProjectLabel | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectLabel | null>(null)

  if (!activeProject) {
    return (
      <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
        No project selected. Navigate into a project first.
      </p>
    )
  }

  const ordered = [...labels].sort((a, b) => a.name.localeCompare(b.name))

  async function handleDelete(label: ProjectLabel) {
    try {
      await remove.mutateAsync(label.id)
      toast.success(`Label "${label.name}" deleted`)
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete label')
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
          Labels categorise work items in{' '}
          <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
            {activeProject.projectKey}
          </span>
          .
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold"
            style={{ border: `1px solid ${BRAND.primary}`, color: BRAND.primary }}
          >
            <Plus size={13} /> Add Label
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={18} className="animate-spin" style={{ color: BRAND.textMuted }} />
        </div>
      ) : isError ? (
        <p className="py-20 text-center text-[13px]" style={{ color: BRAND.textSecondary }}>
          Unable to load labels. Please try again.
        </p>
      ) : ordered.length === 0 ? (
        <p className="py-20 text-center text-[13px]" style={{ color: BRAND.textMuted }}>
          No labels defined yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md" style={{ border: `1px solid ${BRAND.border}` }}>
          <div
            className="flex items-center gap-2 px-3 py-2 text-[10px] font-semibold tracking-wider uppercase"
            style={{ backgroundColor: BRAND.surfaceHover, color: BRAND.textMuted }}
          >
            <div className="flex-1">Label</div>
            <div className="w-28">Colour</div>
            <div className="w-20 text-right">Actions</div>
          </div>
          {ordered.map((label) => (
            <div
              key={label.id}
              className="flex items-center gap-2 px-3 py-2.5"
              style={{ borderTop: `1px solid ${BRAND.borderInner}` }}
            >
              <div className="flex flex-1 items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="text-[13px] font-medium" style={{ color: BRAND.textPrimary }}>
                  {label.name}
                </span>
              </div>
              <div className="w-28">
                <span className="font-mono text-[11px]" style={{ color: BRAND.textMuted }}>
                  {label.color}
                </span>
              </div>
              <div className="flex w-20 items-center justify-end gap-0.5">
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditTarget(label)}
                      className="rounded p-1"
                      style={{ color: BRAND.textMuted }}
                      title="Edit label"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(label)}
                      disabled={remove.isPending}
                      className="rounded p-1 disabled:opacity-30"
                      style={{ color: BRAND.textMuted }}
                      title="Delete label"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && projectId && (
        <LabelModal projectId={projectId} onClose={() => setShowAdd(false)} />
      )}
      {editTarget && projectId && (
        <LabelModal projectId={projectId} label={editTarget} onClose={() => setEditTarget(null)} />
      )}

      <ConfirmDeleteModal
        open={!!deleteTarget}
        title="Delete label"
        confirmText={deleteTarget?.name ?? ''}
        description="This permanently removes the label from every work item that uses it."
        confirmLabel="Delete label"
        isPending={remove.isPending}
        onConfirm={() => deleteTarget && void handleDelete(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function LabelModal({
  projectId,
  label,
  onClose,
}: {
  projectId: string
  label?: ProjectLabel
  onClose: () => void
}) {
  const isEdit = !!label
  const [name, setName] = useState(label?.name ?? '')
  const [color, setColor] = useState(label?.color ?? DEFAULT_LABEL_COLOR)
  const create = useCreateLabel(projectId)
  const update = useUpdateLabel(projectId)
  const pending = create.isPending || update.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      if (isEdit) {
        await update.mutateAsync({ labelId: label.id, input: { name: name.trim(), color } })
        toast.success(`Label "${name.trim()}" updated`)
      } else {
        await create.mutateAsync({ name: name.trim(), color })
        toast.success(`Label "${name.trim()}" added`)
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save label')
    }
  }

  return (
    <AppModal open onClose={onClose} title={isEdit ? 'Edit Label' : 'Add Label'} width={420}>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
      >
        <ModalBody className="space-y-4">
          <FormField label="Label name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="bug"
              autoFocus
            />
          </FormField>
          <FormField label="Colour">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-16 cursor-pointer rounded-md bg-white p-1"
              style={{ border: `1px solid ${BRAND.border}` }}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-semibold"
            style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {pending && <Loader2 size={12} className="animate-spin" />}
            {isEdit ? 'Save Label' : 'Add Label'}
          </button>
        </ModalFooter>
      </form>
    </AppModal>
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

// ── Audit Log tab ─────────────────────────────────────────────────────────────

const AUDIT_PAGE_SIZE = 50

function formatAuditTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Audit action codes are dotted/underscored (e.g. `workspace.member.invited`). */
function humanizeAuditAction(action: string): string {
  return action.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function AuditLogTab() {
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', offset],
    queryFn: async () => {
      const res = await apiClient.GET('/v1/audit-logs', {
        params: { query: { limit: AUDIT_PAGE_SIZE, offset } },
      })
      return res.data
    },
    placeholderData: (prev) => prev,
  })

  const rows = data?.data ?? []
  const hasNextPage = data?.pageInfo?.hasNextPage ?? false

  // Server paginates; this box narrows the loaded page by actor / action / resource.
  const q = search.trim().toLowerCase()
  const filtered = q
    ? rows.filter(
        (a) =>
          (a.actorEmail ?? '').toLowerCase().includes(q) ||
          a.action.toLowerCase().includes(q) ||
          a.resourceType.toLowerCase().includes(q),
      )
    : rows

  return (
    <div>
      {/* ── Header: note + search ── */}
      <div className="mb-3 flex items-end justify-between gap-3">
        <p className="text-[12px]" style={{ color: BRAND.textMuted }}>
          Administrative and settings changes for this workspace.
        </p>
        <div className="relative">
          <Search
            size={12}
            className="absolute top-1/2 left-2.5 -translate-y-1/2"
            style={{ color: BRAND.textMuted }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter actor, action, resource…"
            className="w-64 rounded py-1.5 pr-3 pl-7 text-[11px] focus:outline-none"
            style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-hidden rounded" style={{ border: `1px solid ${BRAND.border}` }}>
        <div
          className="flex h-8 items-center gap-2 px-3"
          style={{ backgroundColor: BRAND.pageBg, borderBottom: `1px solid ${BRAND.border}` }}
        >
          {[
            ['w-44', 'Time'],
            ['w-48', 'Actor'],
            ['w-40', 'Action'],
            ['flex-1', 'Detail'],
          ].map(([c, l]) => (
            <div
              key={l}
              className={`${c} text-[9px] font-semibold tracking-wider uppercase`}
              style={{ color: BRAND.textMuted }}
            >
              {l}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div
            className="flex items-center justify-center gap-2 py-10"
            style={{ color: BRAND.textMuted }}
          >
            <Loader2 size={16} className="animate-spin" />
            <span className="text-[12px]">Loading audit log…</span>
          </div>
        ) : isError ? (
          <div className="px-3 py-6 text-center text-[11px]" style={{ color: BRAND.danger }}>
            Failed to load audit log. Please try again.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px]" style={{ color: BRAND.textMuted }}>
            No audit events found.
          </div>
        ) : (
          filtered.map((a) => {
            const changeKeys =
              a.changes && typeof a.changes === 'object' ? Object.keys(a.changes) : []
            return (
              <div
                key={a.id}
                className="flex min-h-10 items-center gap-2 px-3 py-1.5"
                style={{ borderBottom: `1px solid ${BRAND.borderInner}` }}
              >
                <div
                  className="flex w-44 items-center gap-1 text-[10px]"
                  style={{ color: BRAND.textMuted }}
                >
                  <Clock size={10} />
                  {formatAuditTime(a.occurredAt)}
                </div>
                <div
                  className="w-48 truncate text-[11px] font-medium"
                  style={{ color: BRAND.textPrimary }}
                  title={a.actorEmail ?? a.actorId ?? undefined}
                >
                  {a.actorEmail ?? a.actorId ?? 'System'}
                </div>
                <div className="w-40 truncate text-[11px]" style={{ color: BRAND.textSecondary }}>
                  {humanizeAuditAction(a.action)}
                </div>
                <div className="flex-1 truncate text-[11px]" style={{ color: BRAND.textSecondary }}>
                  {a.resourceType} · {a.resourceId}
                  {changeKeys.length > 0 && (
                    <span style={{ color: BRAND.textMuted }}>
                      {' '}
                      ({changeKeys.length} field
                      {changeKeys.length !== 1 ? 's' : ''} changed)
                    </span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── Pagination ── */}
      {(offset > 0 || hasNextPage) && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={() => setOffset((o) => Math.max(0, o - AUDIT_PAGE_SIZE))}
            disabled={offset === 0}
            className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
          >
            <ChevronLeft size={12} />
            Prev
          </button>
          <button
            onClick={() => setOffset((o) => o + AUDIT_PAGE_SIZE)}
            disabled={!hasNextPage}
            className="flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
          >
            Next
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Roles & Permissions tab ───────────────────────────────────────────────────

type Role = {
  id: string
  workspaceId: string | null
  name: string
  slug: string
  description: string | null
  isSystem: boolean
  permissions: string[]
}

/** Group a role's flat permission codes by their `namespace:action` prefix. */
function groupPermissions(permissions: string[]): { namespace: string; actions: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const perm of [...permissions].sort()) {
    const [namespace, action = '*'] = perm.split(':')
    const actions = groups.get(namespace) ?? []
    actions.push(action)
    groups.set(namespace, actions)
  }
  return [...groups.entries()].map(([namespace, actions]) => ({ namespace, actions }))
}

/** Turn `workspace_admin` / `workspace.manage_members` into `Workspace Admin`. */
function humanizeSlug(value: string): string {
  return value.replace(/[._:]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** A single assignable permission with its scope tier. */
type CatalogPermission = { code: string; tier: 'workspace' | 'project' }

/** A workspace-custom role can be edited; built-in/global roles are read-only. */
function isRoleEditable(role: Role): boolean {
  return !role.isSystem && role.workspaceId !== null
}

function RolesTab() {
  const qc = useQueryClient()
  const { hasPermission } = useAuthStore()
  const canManage = hasPermission(PERMISSION.WORKSPACE_MANAGE_MEMBERS)

  const {
    data: roles = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['system-roles'],
    queryFn: async () => {
      const res = await apiClient.GET('/v1/roles')
      return (res.data ?? []) as Role[]
    },
  })

  // The assignable-permission catalogue is the single source of truth for the
  // editable matrix; only workspace admins may fetch or act on it.
  const { data: catalog = [] } = useQuery({
    queryKey: ['permission-catalog'],
    enabled: canManage,
    queryFn: async () => {
      const res = await apiClient.GET('/v1/permissions')
      return (res.data?.permissions ?? []) as CatalogPermission[]
    },
  })

  const updatePermissions = useMutation({
    mutationFn: async (vars: { roleId: string; permissions: string[] }) => {
      const res = await apiClient.PATCH('/v1/roles/{roleId}/permissions', {
        params: { path: { roleId: vars.roleId } },
        body: { permissions: vars.permissions },
      })
      if (res.error) throw new Error(apiErrorMessage(res.error))
      return res.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['system-roles'] })
      toast.success('Role permissions updated')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to update role'),
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={18} className="animate-spin" style={{ color: BRAND.textMuted }} />
      </div>
    )
  }

  if (isError) {
    return (
      <p className="py-20 text-center text-[13px]" style={{ color: BRAND.textSecondary }}>
        Unable to load roles. Please try again.
      </p>
    )
  }

  if (roles.length === 0) {
    return (
      <p className="py-20 text-center text-[13px]" style={{ color: BRAND.textSecondary }}>
        No roles are defined for this workspace.
      </p>
    )
  }

  const editable = selected != null && canManage && isRoleEditable(selected)

  return (
    <div className="flex gap-6">
      {/* ── Role list ── */}
      <div className="w-64 shrink-0 space-y-1">
        <p
          className="mb-2 text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: BRAND.textMuted }}
        >
          Roles
        </p>
        {roles.map((r) => {
          const isActive = selected?.id === r.id
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className="w-full rounded px-3 py-2 text-left"
              style={{
                backgroundColor: isActive ? BRAND.surfaceHover : 'transparent',
                border: `1px solid ${isActive ? BRAND.border : 'transparent'}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold" style={{ color: BRAND.textPrimary }}>
                  {humanizeSlug(r.name)}
                </span>
                {r.isSystem && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase"
                    style={{ backgroundColor: BRAND.surfaceHover, color: BRAND.textMuted }}
                  >
                    System
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[10px]" style={{ color: BRAND.textMuted }}>
                {r.slug}
              </p>
            </button>
          )
        })}
      </div>

      {/* ── Permissions for the selected role ── */}
      <div className="min-w-0 flex-1">
        {selected && (
          <>
            <div className="mb-4 flex items-center gap-2">
              <Shield size={15} style={{ color: BRAND.textSecondary }} />
              <h3 className="text-[14px] font-semibold" style={{ color: BRAND.textPrimary }}>
                {humanizeSlug(selected.name)}
              </h3>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: BRAND.surfaceHover, color: BRAND.textSecondary }}
              >
                {selected.permissions.length} permissions
              </span>
            </div>

            {selected.description && (
              <p className="mb-5 text-[12px]" style={{ color: BRAND.textSecondary }}>
                {selected.description}
              </p>
            )}

            {editable ? (
              <RolePermissionEditor
                key={selected.id}
                role={selected}
                catalog={catalog}
                saving={updatePermissions.isPending}
                onSave={(permissions) =>
                  updatePermissions.mutate({ roleId: selected.id, permissions })
                }
              />
            ) : (
              <>
                {selected.permissions.length === 0 ? (
                  <p className="text-[12px]" style={{ color: BRAND.textMuted }}>
                    This role has no explicit permissions.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {groupPermissions(selected.permissions).map(({ namespace, actions }) => (
                      <div key={namespace}>
                        <p
                          className="mb-1.5 text-[11px] font-semibold"
                          style={{ color: BRAND.textPrimary }}
                        >
                          {humanizeSlug(namespace)}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {actions.map((action) => (
                            <span
                              key={`${namespace}:${action}`}
                              className="rounded px-2 py-1 font-mono text-[11px]"
                              style={{
                                backgroundColor: BRAND.surfaceHover,
                                color: BRAND.textSecondary,
                                border: `1px solid ${BRAND.border}`,
                              }}
                            >
                              {action === '*' ? 'All actions' : action}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="mt-6 text-[11px]" style={{ color: BRAND.textMuted }}>
                  {selected.isSystem
                    ? 'Built-in system roles are read-only. Assign roles to users from User Management.'
                    : 'You need workspace member management permission to edit this role.'}
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Editable permission matrix for a custom role. Draft state is keyed on the
 * role id (via the parent `key`) so switching roles resets cleanly. Codes the
 * role holds that are not in the catalogue (e.g. a wildcard) are preserved on
 * save rather than silently dropped.
 */
function RolePermissionEditor({
  role,
  catalog,
  saving,
  onSave,
}: {
  role: Role
  catalog: CatalogPermission[]
  saving: boolean
  onSave: (permissions: string[]) => void
}) {
  const initial = new Set(role.permissions)
  const [draft, setDraft] = useState<Set<string>>(() => new Set(role.permissions))

  const catalogCodes = new Set(catalog.map((c) => c.code))
  // Codes held by the role but absent from the catalogue (e.g. wildcards) are
  // not rendered as toggles, but must survive a save.
  const preserved = [...initial].filter((code) => !catalogCodes.has(code))

  const groups = new Map<string, CatalogPermission[]>()
  for (const perm of catalog) {
    const namespace = perm.code.split(':')[0]
    const list = groups.get(namespace) ?? []
    list.push(perm)
    groups.set(namespace, list)
  }

  const dirty = draft.size !== initial.size || [...draft].some((code) => !initial.has(code))

  function toggle(code: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function handleSave() {
    const selectedCatalog = [...draft].filter((code) => catalogCodes.has(code))
    onSave([...new Set([...preserved, ...selectedCatalog])].sort())
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([namespace, perms]) => (
        <div key={namespace}>
          <p className="mb-1.5 text-[11px] font-semibold" style={{ color: BRAND.textPrimary }}>
            {humanizeSlug(namespace)}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {perms.map((perm) => {
              const checked = draft.has(perm.code)
              const action = perm.code.split(':')[1] ?? perm.code
              return (
                <button
                  key={perm.code}
                  type="button"
                  onClick={() => toggle(perm.code)}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left"
                  style={{
                    backgroundColor: checked ? BRAND.surfaceHover : 'transparent',
                    border: `1px solid ${BRAND.border}`,
                  }}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                    style={{
                      backgroundColor: checked ? BRAND.primary : 'transparent',
                      border: `1px solid ${checked ? BRAND.primary : BRAND.border}`,
                    }}
                  >
                    {checked && <Check size={11} style={{ color: BRAND.surface }} />}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: BRAND.textSecondary }}>
                    {action}
                  </span>
                  <span
                    className="ml-auto text-[9px] tracking-wide uppercase"
                    style={{ color: BRAND.textMuted }}
                  >
                    {perm.tier}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div
        className="flex items-center justify-between pt-3"
        style={{ borderTop: `1px solid ${BRAND.border}` }}
      >
        <p className="text-[11px]" style={{ color: BRAND.textMuted }}>
          {draft.size} permission{draft.size === 1 ? '' : 's'} selected
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft(new Set(role.permissions))}
            disabled={!dirty || saving}
            className="rounded px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
            style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
            style={{ backgroundColor: BRAND.primary, color: BRAND.surface }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save changes
          </button>
        </div>
      </div>
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
        ) : activeTab === 'workflow' ? (
          <WorkflowTab />
        ) : activeTab === 'labels' ? (
          <LabelsTab />
        ) : activeTab === 'audit' ? (
          <AuditLogTab />
        ) : activeTab === 'roles' ? (
          <RolesTab />
        ) : (
          <ComingSoonTab label={activeLabel} />
        )}
      </main>
    </div>
  )
}
