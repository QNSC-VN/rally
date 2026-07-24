import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  UserCheck,
  Bell,
  Globe,
  Users,
  UsersRound,
  Shield,
  Plug,
  FileText,
  Lock,
} from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { PERMISSION, type Permission } from '@/shared/config/permissions'
import type { ComponentType } from 'react'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { EmptyState } from '@/shared/ui/empty-state'
import { ProfileTab } from './ui/profile-tab'
import { WorkspaceSettingsTab } from './ui/workspace-settings-tab'
import { MembersTab } from './ui/members-tab'
import { TeamsTab } from './ui/teams-tab'
import { AuditLogTab } from './ui/audit-log-tab'
import { RolesTab } from './ui/roles-tab'
import { IntegrationsTab } from './ui/integrations-tab'

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
      { key: 'notifications', label: 'nav.notifications', icon: Bell, requires: null },
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
        requires: PERMISSION.WORKSPACE_MANAGE_MEMBERS,
      },
      {
        key: 'teams',
        label: 'nav.teams',
        icon: UsersRound,
        requires: PERMISSION.WORKSPACE_MANAGE_TEAMS,
      },
      {
        key: 'roles',
        label: 'nav.roles',
        icon: Shield,
        requires: PERMISSION.WORKSPACE_MANAGE_MEMBERS,
      },
      {
        key: 'integrations',
        label: 'nav.integrations',
        icon: Plug,
        requires: PERMISSION.WORKSPACE_MANAGE_MEMBERS,
      },
      { key: 'audit', label: 'nav.audit', icon: FileText, requires: PERMISSION.WORKSPACE_ALL },
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
  const { hasPermission } = useAuthStore()
  // Each tab is gated on the exact permission its API enforces, so what the FE
  // shows matches what the backend allows. hasPermission handles the workspace:*
  // and namespace wildcards, so an admin still sees everything.

  const allItems = SIDEBAR.flatMap((g) => g.items)
  const activeItem = allItems.find((i) => i.key === activeTab)
  const activeLabel = activeItem ? t(activeItem.label) : t('common:settings')

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
      <main className="flex-1 overflow-y-auto p-8">
        <h2 className="mb-6 text-base font-semibold text-foreground">{activeLabel}</h2>
        {activeTab === 'profile' ? (
          <ProfileTab />
        ) : activeTab === 'members' ? (
          <MembersTab />
        ) : activeTab === 'teams' ? (
          <TeamsTab />
        ) : activeTab === 'workspace' ? (
          <WorkspaceSettingsTab />
        ) : activeTab === 'audit' ? (
          <AuditLogTab />
        ) : activeTab === 'roles' ? (
          <RolesTab />
        ) : activeTab === 'integrations' ? (
          <IntegrationsTab />
        ) : (
          <ComingSoonTab label={activeLabel} />
        )}
      </main>
    </div>
  )
}
