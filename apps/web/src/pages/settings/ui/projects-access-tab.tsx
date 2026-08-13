/**
 * Settings > Workspaces & Projects — per-Project access management (RBAC Phase 7).
 *
 * Workspace Admin picks a Project, then sets each member's access level
 * (admin / editor) or removes their access (No Access = row deleted).
 * When level = editor, a Team multi-select appears (editor requires ≥1 team).
 *
 * Per BA ruling: 3 levels only — workspace_admin + per-Project admin/editor.
 * No viewer, no named No Access level (absence of row = implicit No Access).
 */
import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjects } from '@/features/projects/api'
import {
  useProjectMembers,
  useUpdateProjectAccess,
  useProjectTeams,
  type ProjectMember,
} from '@/features/teams/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { PERMISSION } from '@/shared/config/permissions'
import { SettingsTabHeader } from './settings-tab-header'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { IconButton } from '@/shared/ui/icon-button'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { notify } from '@/shared/lib/toast'
import { useMutation } from '@tanstack/react-query'

const ACCESS_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
] as const

export function ProjectsAccessTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { hasPermission } = useAuthStore()
  const isWA = hasPermission(PERMISSION.WORKSPACE_VIEW)
  const { data: projects = [], isLoading: projectsLoading } = useProjects(workspaceId)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  const projectId =
    selectedProjectId && projects.some((p) => p.id === selectedProjectId) ? selectedProjectId : null

  const projectOptions: SelectOption[] = projects.map((p) => ({
    value: p.id,
    label: `${p.key} · ${p.name}`,
    searchText: `${p.key} ${p.name}`,
  }))

  return (
    <>
      <SettingsTabHeader
        contained
        title="Workspaces & Projects"
        description="Manage per-Project access levels (admin / editor)."
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Project picker */}
          <div className="space-y-2">
            <p className="text-ui-sm font-semibold text-foreground-subtle">Select a Project</p>
            {projectsLoading ? (
              <div className="flex items-center gap-2 py-2 text-ui-md text-foreground-subtle">
                <Loader2 size={14} className="animate-spin" /> Loading projects…
              </div>
            ) : (
              <SearchableSelect
                variant="field"
                value={projectId ?? ''}
                ariaLabel="Select a project"
                placeholder="Choose a project"
                options={projectOptions}
                onChange={(v) => setSelectedProjectId(v as string)}
              />
            )}
          </div>

          {/* Members + access levels */}
          {projectId && <ProjectAccessList projectId={projectId} isWA={isWA} />}
        </div>
      </div>
    </>
  )
}

export function ProjectAccessList({ projectId, isWA }: { projectId: string; isWA: boolean }) {
  const { data: members = [], isLoading } = useProjectMembers(projectId)
  const { data: teams = [] } = useProjectTeams(projectId)
  const updateAccess = useUpdateProjectAccess(projectId)
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null)

  const teamOptions: SelectOption[] = teams.map((t) => ({
    value: t.id,
    label: t.name,
    searchText: t.name,
  }))

  function handleChange(member: ProjectMember, level: 'admin' | 'editor') {
    updateAccess.mutate(
      { memberId: member.id, accessLevel: level },
      {
        onSuccess: () => notify.success(`Access updated to ${level}`),
        onError: (e) => notify.fromError(e, 'Failed to update access'),
      },
    )
  }

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error, response } = await apiClient.DELETE('/v1/projects/{id}/members/{userId}', {
        params: { path: { id: projectId, userId: memberId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['team'] },
  })

  function handleRemove() {
    if (!removeTarget) return
    removeMember.mutate(removeTarget.userId, {
      onSuccess: () => {
        notify.success('Access removed (No Access)')
        setRemoveTarget(null)
      },
      onError: (e) => notify.fromError(e, 'Failed to remove access'),
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-ui-md text-foreground-subtle">
        <Loader2 size={14} className="animate-spin" /> Loading members…
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle px-4 py-8 text-center text-ui-md text-foreground-subtle">
        No members in this project yet.
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg border border-border-subtle">
        <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
          <span className="flex-1">User</span>
          <span className="w-28 text-center">Access Level</span>
          <span className="w-40 text-center">Teams (Editor only)</span>
          {isWA && <span className="w-8 text-center">Action</span>}
        </div>
        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <OwnerAvatar name={m.displayName ?? m.email ?? m.userId} size={20} />
              <div className="min-w-0">
                <p className="truncate text-ui-sm font-medium text-foreground">
                  {m.displayName ?? m.email ?? '--'}
                </p>
                {m.email && <p className="truncate text-ui-xs text-foreground-subtle">{m.email}</p>}
              </div>
            </div>
            <div className="w-28">
              {m.accessLevel && isWA ? (
                <SearchableSelect
                  variant="cell"
                  value={m.accessLevel}
                  ariaLabel={`Access level for ${m.displayName ?? m.email ?? m.userId}`}
                  options={ACCESS_OPTIONS as unknown as SelectOption[]}
                  onChange={(v) => handleChange(m, v as 'admin' | 'editor')}
                />
              ) : (
                <span className="text-ui-sm text-foreground-subtle capitalize">
                  {m.accessLevel ?? '—'}
                </span>
              )}
            </div>
            {/* Team picker (Editor only) */}
            <div className="w-40">
              {m.accessLevel === 'editor' && isWA && teamOptions.length > 0 ? (
                <SearchableSelect
                  variant="cell"
                  multiple
                  value={[]}
                  ariaLabel={`Teams for ${m.displayName ?? m.email ?? m.userId}`}
                  placeholder="--"
                  options={teamOptions}
                  onChange={() => {
                    /* Team membership managed via Team settings; this is a display-only placeholder */
                  }}
                />
              ) : m.accessLevel === 'admin' ? (
                <span className="text-ui-xs text-foreground-subtle">All Teams</span>
              ) : (
                <span className="text-ui-xs text-foreground-faint">—</span>
              )}
            </div>
            {/* Remove action (WA only) */}
            {isWA && (
              <div className="w-8 text-center">
                <IconButton
                  size="sm"
                  aria-label="Remove access"
                  title="Remove access (No Access)"
                  onClick={() => setRemoveTarget(m)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Remove confirmation */}
      <ConfirmDialog
        open={!!removeTarget}
        title="Remove project access"
        message={
          removeTarget
            ? `Remove ${removeTarget.displayName ?? removeTarget.email ?? removeTarget.userId} from this project? They will lose all access (No Access) and their Team memberships will be removed.`
            : ''
        }
        confirmLabel="Remove Access"
        destructive
        pending={removeMember.isPending}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  )
}
