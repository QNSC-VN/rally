/**
 * The Users & Permissions roster used by Settings > Workspaces & Projects.
 *
 * Lists a project's members with each access level (admin / editor), lets a Workspace
 * Admin change a level, remove access (No Access = row removed), and ADD an existing
 * workspace user at a chosen level. 3-level access (WA / Admin / Editor); no Viewer.
 *
 * Editor team assignment is managed on the per-project Teams tab (Stage 3) — team
 * membership is a team_members concern, not a project_members one, so it is not wired
 * into this roster's inline picker.
 */
import { useState } from 'react'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useMutation } from '@tanstack/react-query'
import {
  useProjectMembers,
  useUpdateProjectAccess,
  useAddProjectMember,
  type ProjectMember,
} from '@/features/teams/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { IconButton } from '@/shared/ui/icon-button'
import { Button } from '@/shared/ui/button'
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
      {isWA && (
        <div className="mb-3 flex items-center justify-between">
          <p className="text-ui-sm text-foreground-subtle">{members.length} project users</p>
          <Button type="button" onClick={() => setAddOpen(true)}>
            <UserPlus size={14} /> Add existing user
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-ui-md text-foreground-subtle">
          <Loader2 size={14} className="animate-spin" /> Loading members…
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-lg border border-border-subtle px-4 py-8 text-center text-ui-md text-foreground-subtle">
          No members in this project yet.
        </div>
      ) : (
        <div className="rounded-lg border border-border-subtle">
          <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
            <span className="flex-1">User</span>
            <span className="w-24 text-center">Status</span>
            <span className="w-28 text-center">Access Level</span>
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
                  {m.email && (
                    <p className="truncate text-ui-xs text-foreground-subtle">{m.email}</p>
                  )}
                </div>
              </div>
              <div className="w-24 text-center">
                <span className="text-ui-xs text-foreground-subtle capitalize">{m.status}</span>
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
 * add them. The POST persists the level up front (Stage-5 BE fix), so this is one
 * call — no follow-up PATCH.
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
  const addMember = useAddProjectMember(projectId)
  const [userId, setUserId] = useState<string | null>(null)
  const [level, setLevel] = useState<'admin' | 'editor'>('editor')

  const candidates = wsMembers.filter((m) => !existingIds.has(m.userId) && m.status === 'active')
  const options: SelectOption[] = candidates.map((m) => ({
    value: m.userId,
    label: m.displayName ?? m.email ?? m.userId,
    searchText: `${m.displayName ?? ''} ${m.email ?? ''}`,
  }))

  function handleClose() {
    setUserId(null)
    setLevel('editor')
    onClose()
  }

  function handleAdd() {
    if (!userId) return
    addMember.mutate(
      { userId, accessLevel: level },
      {
        onSuccess: () => {
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
              : 'Editor requires team membership — assign on the Teams tab.'}
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={handleClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!userId || addMember.isPending} onClick={handleAdd}>
          {addMember.isPending && <Loader2 size={12} className="animate-spin" />}
          Add to project
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
