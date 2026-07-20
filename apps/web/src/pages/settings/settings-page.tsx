import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  Loader2,
  Check,
  Save,
} from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { PERMISSION, type Permission } from '@/shared/config/permissions'
import type { ComponentType } from 'react'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { useSystemRoles, type Role } from './model/use-system-roles'
import { ProfileTab } from './ui/profile-tab'
import { WorkspaceSettingsTab } from './ui/workspace-settings-tab'
import { ProjectSettingsTab } from './ui/project-settings-tab'
import { WorkflowTab } from './ui/workflow-tab'
import { LabelsTab } from './ui/labels-tab'
import { MembersTab } from './ui/members-tab'
import { TeamsTab } from './ui/teams-tab'
import { AuditLogTab } from './ui/audit-log-tab'

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

// ── Roles & Permissions tab ───────────────────────────────────────────────────

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

  const { data: roles = [], isLoading, isError } = useSystemRoles()

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
        body: { permissions: vars.permissions } as never,
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

            {/* Every role renders the same full permission grid; protected roles
                (Workspace Admin) are simply shown read-only. This keeps the view
                consistent instead of a separate chip layout for system roles. */}
            <RolePermissionEditor
              key={selected.id}
              role={selected}
              catalog={catalog}
              saving={updatePermissions.isPending}
              readOnly={!editable}
              onSave={(permissions) =>
                updatePermissions.mutate({ roleId: selected.id, permissions })
              }
            />

            {!editable && !canManage && (
              <p className="mt-3 text-[11px]" style={{ color: BRAND.textMuted }}>
                You need workspace member management permission to edit roles.
              </p>
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
  readOnly = false,
}: {
  role: Role
  catalog: CatalogPermission[]
  saving: boolean
  onSave: (permissions: string[]) => void
  readOnly?: boolean
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
                  onClick={() => !readOnly && toggle(perm.code)}
                  disabled={readOnly}
                  aria-pressed={checked}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left"
                  style={{
                    backgroundColor: checked ? BRAND.surfaceHover : 'transparent',
                    border: `1px solid ${BRAND.border}`,
                    cursor: readOnly ? 'default' : 'pointer',
                    opacity: readOnly && !checked ? 0.55 : 1,
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
          {draft.size} permission{draft.size === 1 ? '' : 's'}
          {readOnly ? '' : ' selected'}
        </p>
        {readOnly ? (
          <div className="flex items-center gap-1.5">
            <Lock size={11} style={{ color: BRAND.textMuted }} />
            <p className="text-[11px]" style={{ color: BRAND.textMuted }}>
              Protected role — permissions are fixed and cannot be edited.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft(new Set(role.permissions))}
              disabled={!dirty || saving}
            >
              Reset
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save changes
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Coming soon tab ───────────────────────────────────────────────────────────

function ComingSoonTab({ label }: { label: string }) {
  return (
    <EmptyState
      icon={<Lock size={22} className="text-border-strong" />}
      title={label}
      description="Available in a future release."
    />
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
                    backgroundColor: isActive ? BRAND.primaryLighter : 'transparent',
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
