import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  UserCheck,
  KeyRound,
  Globe,
  Users,
  FolderKanban,
  ShieldCheck,
  Plug,
  FileText,
  Lock,
} from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { PERMISSION, type Permission } from '@/shared/config/permissions'
import type { ComponentType } from 'react'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { EmptyState } from '@/shared/ui/empty-state'
import { ProfileTab } from './ui/profile-tab'
import { WorkspaceSettingsTab } from './ui/workspace-settings-tab'
import { MembersTab } from './ui/members-tab'
import { AuditLogTab } from './ui/audit-log-tab'
// RolesTab removed — no custom roles under the R1 access-level model (RBAC migration).
import { IntegrationsTab } from './ui/integrations-tab'
import { WorkspaceProjectsPanel } from './ui/workspace-projects-panel'
import { MyPermissionsTab } from './ui/my-permissions-tab'
import { PermissionModelTab } from './ui/permission-model-tab'
// NotificationsTab is intentionally NOT wired into the sidebar: Notification
// Preferences is Future Backlog (BA decision 2026-08-06, C6). Phase 4 ships fixed
// in-app notifications only; user-configurable preferences stay out of scope. The
// component file is retained for when the feature returns from backlog.

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

// `group` / `label` hold i18n keys (settings namespace), resolved via t() at render.
const SIDEBAR: SettingsGroup[] = [
  {
    group: 'groups.personal',
    items: [
      { key: 'profile', label: 'nav.profile', icon: UserCheck, requires: null },
      { key: 'my-permissions', label: 'My Permissions', icon: KeyRound, requires: null },
      // Notification Preferences tab removed per BA C6 (Future Backlog).
    ],
  },
  // Project-scoped settings intentionally NOT in the gear sidebar — the single
  // entry point is Manage Projects > Projects (P4-SET-02).
  {
    group: 'groups.workspace',
    items: [
      {
        key: 'workspace',
        label: 'nav.workspace',
        icon: Globe,
        requires: PERMISSION.WORKSPACE_VIEW,
      },
      {
        key: 'members',
        label: 'nav.members',
        icon: Users,
        requires: PERMISSION.USERS_ASSIGN_ROLE,
      },
      {
        key: 'projects-access',
        // `project:view`, not `project:edit`. §3.1 shows this surface to all three levels and
        // varies only its SCOPE — "All Projects" for a Workspace Admin, "Assigned Project, all
        // Teams" for an Admin, "Assigned Project and assigned Teams" for an Editor — so an edit
        // code was never the right gate for visibility. An Editor holds `project:view` and no
        // `project:edit`, and was locked out of a surface the BA gives them read-only.
        // Write controls inside the panel stay gated on their own codes.
        label: 'Workspaces & Projects',
        icon: FolderKanban,
        requires: PERMISSION.PROJECT_VIEW,
      },
      {
        key: 'integrations',
        label: 'nav.integrations',
        icon: Plug,
        requires: PERMISSION.SCM_MANAGE,
      },
      { key: 'audit', label: 'nav.audit', icon: FileText, requires: PERMISSION.AUDIT_VIEW },
      {
        key: 'permission-model',
        label: 'Permission Model',
        icon: ShieldCheck,
        requires: PERMISSION.PROJECT_EDIT,
      },
    ],
  },
]

// ── Coming soon tab ───────────────────────────────────────────────────────────

function ComingSoonTab({ label }: { label: string }) {
  const { t } = useTranslation('settings')
  return (
    <EmptyState
      icon={<Lock size={22} className="text-border-strong" />}
      title={label}
      description={t('comingSoon')}
    />
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const [activeTab, setActiveTab] = useState('profile')
  // Each tab is gated on the exact permission its API enforces, so what the FE shows matches what
  // the backend allows.
  //
  // Resolved against the SELECTED PROJECT rather than the workspace baseline, because two of these
  // tabs require project-tier codes (`projects-access` → `project:view`, `permission-model` →
  // `project:edit`) and a normal user holds those through `work.project_members.access_level`,
  // which never appears in the `/bff/me` baseline. Gating on the baseline padlocked both tabs for
  // every non-Workspace-Admin — including the `Workspaces & Projects` surface that is the BA's
  // project-centric access journey (§5.2).
  //
  // One function covers both tiers: `GET /projects/:id/my-permissions` returns the baseline UNIONED
  // with the project grants, so a workspace-tier code like `audit:view` still resolves, and
  // `workspace:*` still matches everything.
  const { project } = useAppContext()
  const { can: hasPermission } = useProjectPermissions(project?.projectId)

  const allItems = SIDEBAR.flatMap((g) => g.items)
  const activeItem = allItems.find((i) => i.key === activeTab)
  const activeLabel = activeItem ? t(activeItem.label) : t('common:settings')
  const tabEl =
    activeTab === 'profile' ? (
      <ProfileTab />
    ) : activeTab === 'my-permissions' ? (
      <MyPermissionsTab />
    ) : activeTab === 'members' ? (
      <MembersTab />
    ) : activeTab === 'workspace' ? (
      <WorkspaceSettingsTab />
    ) : activeTab === 'audit' ? (
      <AuditLogTab />
    ) : activeTab === 'projects-access' ? (
      <WorkspaceProjectsPanel />
    ) : activeTab === 'permission-model' ? (
      <PermissionModelTab />
    ) : activeTab === 'integrations' ? (
      <IntegrationsTab />
    ) : (
      <ComingSoonTab label={activeLabel} />
    )

  return (
    <div className="flex flex-1 overflow-hidden bg-background">
      {/* ── Left sidebar ── */}
      <aside className="w-52 shrink-0 overflow-y-auto border-r border-border-strong bg-card px-3 py-4">
        {SIDEBAR.map((group) => (
          <div key={group.group} className="mb-4">
            <p className="mb-1 px-2 text-ui-xs font-semibold tracking-wider text-foreground-subtle uppercase">
              {t(group.group)}
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
                  className="mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-ui-md transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    backgroundColor: isActive ? BRAND.primaryLighter : 'transparent',
                    color: isActive ? BRAND.primary : BRAND.textSecondary,
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  <Icon size={13} style={{ color: isActive ? BRAND.primary : BRAND.textMuted }} />
                  {t(item.label)}
                  {locked && <Lock size={10} className="ml-auto text-border-strong" />}
                </button>
              )
            })}
          </div>
        ))}
      </aside>

      {/* ── Content ── */}
      {/* Content surface. Two modes:
          • List tabs (Users/Teams) — a full-bleed WHITE canvas (bg-card), edge
            to edge, no gray gutter or page heading: the tab owns its own header
            bar + toolbar + table + footer, exactly like the Iteration Status
            page. It fills height so the table's own scroll works.
          • Form tabs — the padded gray page with a heading, as before. */}
      {/* Every tab renders its own <SettingsTabHeader> as the first element, so
          the heading size + position are identical across list and form tabs.
          List tabs own a full-height white surface (their own scroll); form tabs
          get the header band (white) followed by a scrolling padded body they
          render themselves. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col bg-card">{tabEl}</div>
      </main>
    </div>
  )
}
