/**
 * Settings > Workspaces & Projects — per-Project access management (RBAC Phase 7 Stage D).
 *
 * Workspace Admin picks a Project, then sets each member's access level
 * (admin / editor). No Access = remove the member. Uses the shared
 * SearchableSelect + OwnerAvatar for consistency with the rest of the app.
 */
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjects } from '@/features/projects/api'
import { useProjectMembers, useUpdateProjectAccess, type ProjectMember } from '@/features/teams/api'
import { SettingsTabHeader } from './settings-tab-header'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { notify } from '@/shared/lib/toast'

const ACCESS_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
] as const

export function ProjectsAccessTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
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
          {projectId && <ProjectAccessList projectId={projectId} />}
        </div>
      </div>
    </>
  )
}

function ProjectAccessList({ projectId }: { projectId: string }) {
  const { data: members = [], isLoading } = useProjectMembers(projectId)
  const updateAccess = useUpdateProjectAccess(projectId)

  function handleChange(member: ProjectMember, level: 'admin' | 'editor') {
    updateAccess.mutate(
      { memberId: member.id, accessLevel: level },
      {
        onSuccess: () => notify.success(`Access updated to ${level}`),
        onError: (e) => notify.fromError(e, 'Failed to update access'),
      },
    )
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
    <div className="rounded-lg border border-border-subtle">
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
        <span className="flex-1">User</span>
        <span className="w-28 text-center">Access Level</span>
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
            {m.accessLevel ? (
              <SearchableSelect
                variant="cell"
                value={m.accessLevel}
                ariaLabel={`Access level for ${m.displayName ?? m.email ?? m.userId}`}
                options={ACCESS_OPTIONS as unknown as SelectOption[]}
                onChange={(v) => handleChange(m, v as 'admin' | 'editor')}
              />
            ) : (
              <span className="text-ui-xs text-foreground-faint">Team-derived</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
