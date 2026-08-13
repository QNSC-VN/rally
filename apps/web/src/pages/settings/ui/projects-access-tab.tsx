/**
 * The Users & Permissions roster used by Settings > Workspaces & Projects.
 *
 * Lists a project's members with each access level (admin / editor), lets a Workspace
 * Admin change a level, remove access (No Access = row removed), and ADD an existing
 * workspace user at a chosen level plus their Teams in one step. 3-level access
 * (WA / Admin / Editor); no Viewer.
 *
 * Editor team assignment for an EXISTING member's inline access-level change on this
 * roster is still managed on the per-project Teams tab (Stage 3) — this list has no
 * Teams column. `AddExistingUserModal` below is the one place team membership is
 * wired in here, because a brand-new member has no `project_members` row yet for the
 * Teams tab to attach to at the moment they're picked as Editor.
 */
import { useState } from 'react'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useMutation } from '@tanstack/react-query'
import {
  useProjectMembers,
  useUpdateProjectAccess,
  useAddProjectMember,
  useProjectTeams,
  useAddTeamMember,
  type ProjectMember,
} from '@/features/teams/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { IconButton } from '@/shared/ui/icon-button'
import { WarningIndicator } from '@/shared/ui/warning-indicator'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { notify } from '@/shared/lib/toast'

const ACCESS_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
] as const

export function ProjectAccessList({ projectId, isWA }: { projectId: string; isWA: boolean }) {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: members = [], isLoading } = useProjectMembers(projectId)
  const updateAccess = useUpdateProjectAccess(projectId)
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = members.filter((m) =>
    `${m.displayName ?? ''} ${m.email ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  )

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

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users…"
          className="max-w-xs"
          aria-label="Search project users"
        />
        {isWA && (
          <Button type="button" onClick={() => setAddOpen(true)}>
            <UserPlus size={14} /> Add existing user
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-ui-md text-foreground-subtle">
          <Loader2 size={14} className="animate-spin" /> Loading members…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border-subtle px-4 py-8 text-center text-ui-md text-foreground-subtle">
          {query ? 'No users match your search.' : 'No members in this project yet.'}
        </div>
      ) : (
        <div className="rounded-lg border border-border-subtle">
          <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
            <span className="flex-1">User</span>
            <span className="w-24 text-center">Status</span>
            <span className="w-28 text-center">Access Level</span>
            {isWA && <span className="w-8 text-center">Action</span>}
          </div>
          {filtered.map((m) => (
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
                  {m.email && (
                    <p className="truncate text-ui-xs text-foreground-subtle">{m.email}</p>
                  )}
                </div>
              </div>
              <div className="w-24 text-center">
                <span className="text-ui-xs text-foreground-subtle capitalize">{m.status}</span>
              </div>
              <div className="flex w-28 items-center gap-1">
                <WarningIndicator
                  labels={
                    m.accessLevel === 'editor' && m.teamCount === 0
                      ? [`Editor has no assigned team — can't act on any work in this project yet.`]
                      : []
                  }
                />
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
      )}

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

      <AddExistingUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectId={projectId}
        workspaceId={workspaceId}
        existingIds={new Set(members.map((m) => m.userId))}
      />
    </>
  )
}

/**
 * Pick an active workspace user who is not yet a project member, choose a level, and
 * (when Editor) their Teams — all in one modal, one "Add to project" action, matching
 * the BA mockup's single-modal shape. The POST persists the level up front (Stage-5 BE
 * fix); Team membership is a separate write (`team_members`, not `project_members`), so
 * on success this fires one `useAddTeamMember` call per selected team — same hooks and
 * same per-selection call shape as `user-access-modal.tsx`'s `ProjectTeamsField`, just
 * starting from an empty `memberTeamIds` since the user isn't on any team yet.
 *
 * Admin bypasses Team scoping entirely (`access.service.ts`'s `assertTeamScoped`), so
 * the Teams picker only renders for Editor. Matching `ProjectTeamsField`'s `requireTeam`
 * rule, an Editor with zero teams checked is a warning, not a hard block — Rally has no
 * backend rule that makes an Editor invalid without a team, just a UX nudge to assign
 * one, and the mockup itself only ever showed this as inline validation copy, never a
 * disabled submit.
 */
function AddExistingUserModal({
  open,
  onClose,
  projectId,
  workspaceId,
  existingIds,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  workspaceId: string | undefined
  existingIds: Set<string>
}) {
  const { data: wsMembers = [] } = useWorkspaceMembers(workspaceId)
  const { data: teams = [] } = useProjectTeams(projectId)
  const addMember = useAddProjectMember(projectId)
  const addTeamMember = useAddTeamMember()
  const [userId, setUserId] = useState<string | null>(null)
  const [level, setLevel] = useState<'admin' | 'editor'>('editor')
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])

  // Workspace Admin is company-level only — never a Project member candidate (§2).
  const candidates = wsMembers.filter(
    (m) => !existingIds.has(m.userId) && m.status === 'active' && m.roleSlug !== 'workspace_admin',
  )
  const options: SelectOption[] = candidates.map((m) => ({
    value: m.userId,
    label: m.displayName ?? m.email ?? m.userId,
    searchText: `${m.displayName ?? ''} ${m.email ?? ''}`,
  }))
  const teamOptions: SelectOption[] = teams.map((t) => ({ value: t.id, label: t.name }))

  function handleClose() {
    setUserId(null)
    setLevel('editor')
    setSelectedTeamIds([])
    onClose()
  }

  function handleAdd() {
    if (!userId) return
    const newUserId = userId
    addMember.mutate(
      { userId: newUserId, accessLevel: level },
      {
        onSuccess: async () => {
          if (level === 'editor' && selectedTeamIds.length > 0) {
            await Promise.all(
              selectedTeamIds.map((teamId) =>
                addTeamMember
                  .mutateAsync({ teamId, userId: newUserId })
                  .catch((e) => notify.fromError(e, 'Failed to add to team')),
              ),
            )
          }
          notify.success('User added to project')
          handleClose()
        },
        onError: (e) => notify.fromError(e, 'Failed to add user'),
      },
    )
  }

  return (
    <AppModal open={open} onClose={handleClose} title="Add existing user" width={460}>
      <ModalBody className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-ui-sm font-medium text-foreground">User</p>
          <SearchableSelect
            variant="field"
            value={userId ?? ''}
            ariaLabel="Select a workspace user"
            placeholder="Choose a user"
            options={options}
            onChange={(v) => setUserId(v as string)}
          />
          {candidates.length === 0 && (
            <p className="text-ui-xs text-foreground-subtle">
              No eligible workspace users — everyone is already a member.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-ui-sm font-medium text-foreground">Access Level</p>
          <SearchableSelect
            variant="field"
            value={level}
            ariaLabel="Access level"
            options={ACCESS_OPTIONS as unknown as SelectOption[]}
            onChange={(v) => setLevel(v as 'admin' | 'editor')}
          />
          <p className="text-ui-xs text-foreground-subtle">
            {level === 'admin'
              ? 'Admin has access to all teams in this project.'
              : 'Editor access is scoped to the teams selected below.'}
          </p>
        </div>
        {level === 'editor' && (
          <div className="space-y-1.5">
            <p className="text-ui-sm font-medium text-foreground">Teams</p>
            <SearchableSelect
              multiple
              variant="field"
              value={selectedTeamIds}
              ariaLabel="Teams"
              placeholder="No teams"
              searchPlaceholder="Search teams"
              options={teamOptions}
              onChange={(v) => setSelectedTeamIds(v as string[])}
            />
            {selectedTeamIds.length === 0 && (
              <p className="text-ui-xs text-warning">
                Select at least one team — an Editor with no team can&apos;t act on any work in this
                project yet.
              </p>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!userId || addMember.isPending || addTeamMember.isPending}
          onClick={handleAdd}
        >
          {(addMember.isPending || addTeamMember.isPending) && (
            <Loader2 size={12} className="animate-spin" />
          )}
          Add to project
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
