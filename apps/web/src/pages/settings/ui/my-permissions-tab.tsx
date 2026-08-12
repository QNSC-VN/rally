/**
 * Settings > My Permissions — shows the current user's effective access.
 * Always visible to every authenticated user (requires: null).
 * SRS Phase 4.3 §1/§3.
 */
import { Loader2 } from 'lucide-react'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useProjects } from '@/features/projects/api'
import { useProjectMembers } from '@/features/teams/api'
import { PERMISSION } from '@/shared/config/permissions'
import { SettingsTabHeader } from './settings-tab-header'
import { StatusBadge } from '@/shared/ui/status-badge'
import { BRAND } from '@/shared/config/brand'

export function MyPermissionsTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { hasPermission, user } = useAuthStore()
  const isWA = hasPermission(PERMISSION.WORKSPACE_VIEW)

  return (
    <>
      <SettingsTabHeader
        contained
        title="My Permissions"
        description="Your effective access across this workspace."
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Workspace authority */}
          <div className="rounded-lg border border-border-subtle p-4">
            <h3 className="text-ui-sm font-semibold text-foreground">Workspace Authority</h3>
            {isWA ? (
              <p className="mt-2 text-ui-md text-foreground">
                You are a <strong>Workspace Admin</strong> with full company authority. You can
                manage all users, Projects, Teams, and Project access.
              </p>
            ) : (
              <p className="mt-2 text-ui-md text-foreground-subtle">
                You are a company member. Your Project access is managed per-Project by the
                Workspace Admin.
              </p>
            )}
            {user?.displayName && (
              <p className="mt-1 text-ui-xs text-foreground-subtle">{user.displayName}</p>
            )}
          </div>

          {/* Per-Project access */}
          {!isWA && (
            <ProjectAccessSummary workspaceId={workspaceId ?? ''} userId={user?.id ?? ''} />
          )}

          {/* Quick capability reference */}
          <div className="rounded-lg border border-border-subtle p-4">
            <h3 className="text-ui-sm font-semibold text-foreground">Access Level Reference</h3>
            <div className="mt-3 space-y-2">
              {CAPABILITY_ROWS.map((row) => (
                <div key={row.level} className="flex items-center gap-3 text-ui-sm">
                  <StatusBadge
                    style={{
                      label: row.level,
                      text: row.color,
                      bg: row.bg,
                      border: row.border,
                    }}
                  />
                  <span className="text-foreground-subtle">{row.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/** Lists the user's access_level per project. */
function ProjectAccessSummary({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const { data: projects = [], isLoading } = useProjects(workspaceId)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-ui-md text-foreground-subtle">
        <Loader2 size={14} className="animate-spin" /> Loading your Projects…
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border-subtle">
      <div className="border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
        Your Project Access
      </div>
      {projects.length === 0 ? (
        <p className="px-4 py-6 text-center text-ui-md text-foreground-subtle">
          No Projects available.
        </p>
      ) : (
        projects.map((p) => (
          <ProjectAccessRow
            key={p.id}
            projectId={p.id}
            name={p.name}
            key_code={p.key}
            userId={userId}
          />
        ))
      )}
    </div>
  )
}

function ProjectAccessRow({
  projectId,
  name,
  key_code,
  userId,
}: {
  projectId: string
  name: string
  key_code: string
  userId: string
}) {
  const { data: members = [] } = useProjectMembers(projectId)
  const me = members.find((m) => m.userId === userId)
  const level = me?.accessLevel

  return (
    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="font-mono text-ui-xs text-foreground-subtle">{key_code}</span>
        <span className="text-ui-sm text-foreground">{name}</span>
      </div>
      <span className="text-ui-sm text-foreground-subtle capitalize">{level ?? 'No Access'}</span>
    </div>
  )
}

const CAPABILITY_ROWS = [
  {
    level: 'Workspace Admin',
    desc: 'Full company authority — manages all users, Projects, Teams, access.',
    color: BRAND.primary,
    bg: BRAND.primaryLighter,
    border: BRAND.primary,
  },
  {
    level: 'Admin',
    desc: 'Full delivery admin in one Project (All Teams). No structural admin.',
    color: BRAND.success,
    bg: BRAND.successBg,
    border: BRAND.successBorder,
  },
  {
    level: 'Editor',
    desc: 'Create/edit/delete team-scoped work in assigned Teams.',
    color: BRAND.warning,
    bg: BRAND.warningBg,
    border: BRAND.warningBorder,
  },
  {
    level: 'No Access',
    desc: 'Project is hidden; direct URLs are denied.',
    color: BRAND.textSecondary,
    bg: BRAND.surfaceSubtle,
    border: BRAND.border,
  },
]
