/**
 * User Project Access modal — User-Centric Journey (SRS §5.1 / P4-RBAC-009).
 * Opens from the Members tab. A Workspace Admin can ASSIGN / CHANGE / REMOVE the
 * user's per-Project access (admin / editor / No Access) — the same writes the
 * Project-centric and Team journeys make, so all three stay synchronized.
 */
import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { useProjects } from '@/features/projects/api'
import {
  useProjectMembers,
  useUpdateProjectAccess,
  useAddProjectMember,
} from '@/features/teams/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { PERMISSION } from '@/shared/config/permissions'
import { AppModal, ModalBody } from '@/shared/ui/app-modal'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { IconButton } from '@/shared/ui/icon-button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { notify } from '@/shared/lib/toast'

const ACCESS_OPTIONS: SelectOption[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
]

export function UserAccessModal({
  userId,
  displayName,
  email,
  workspaceId,
  onClose,
}: {
  userId: string
  displayName?: string | null
  email?: string | null
  workspaceId: string
  onClose: () => void
}) {
  const { hasPermission } = useAuthStore()
  const isWA = hasPermission(PERMISSION.WORKSPACE_VIEW)
  const { data: projects = [], isLoading } = useProjects(workspaceId)
  const [removeProject, setRemoveProject] = useState<{ id: string; name: string } | null>(null)

  return (
    <AppModal open onClose={onClose} title="Project Access" width={560}>
      <ModalBody className="space-y-4">
        {/* User identity header */}
        <div className="flex items-center gap-3">
          <OwnerAvatar name={displayName ?? email ?? userId} size={28} />
          <div className="min-w-0">
            <p className="truncate text-ui-sm font-medium text-foreground">
              {displayName ?? email ?? 'Unknown'}
            </p>
            {email && <p className="truncate text-ui-xs text-foreground-subtle">{email}</p>}
          </div>
        </div>

        {/* Per-project access — editable for WA, read-only otherwise */}
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-center text-ui-md text-foreground-subtle">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : projects.length === 0 ? (
          <p className="py-6 text-center text-ui-md text-foreground-subtle">
            No Projects available.
          </p>
        ) : (
          <div className="rounded-lg border border-border-subtle">
            <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
              <span className="flex-1">Project</span>
              <span className="w-32 text-center">Access Level</span>
              {isWA && <span className="w-8 text-center">Action</span>}
            </div>
            {projects.map((p) => (
              <UserProjectAccessRow
                key={p.id}
                projectId={p.id}
                projectKey={p.key}
                projectName={p.name}
                userId={userId}
                isWA={isWA}
                onRemove={() => setRemoveProject({ id: p.id, name: `${p.key} · ${p.name}` })}
              />
            ))}
          </div>
        )}
      </ModalBody>

      <ConfirmDialog
        open={!!removeProject}
        title="Remove project access"
        message={
          removeProject
            ? `Remove this user's access to ${removeProject.name}? They lose all access (No Access) and their Team memberships in that project.`
            : ''
        }
        confirmLabel="Remove Access"
        destructive
        onConfirm={async () => {
          if (!removeProject) return
          try {
            const { error, response } = await apiClient.DELETE(
              '/v1/projects/{id}/members/{userId}',
              { params: { path: { id: removeProject.id, userId } } },
            )
            if (error) throw new Error(apiErrorMessage(error, response.status))
            notify.success('Access removed (No Access)')
          } catch (e) {
            notify.fromError(e, 'Failed to remove access')
          }
          setRemoveProject(null)
        }}
        onCancel={() => setRemoveProject(null)}
      />
    </AppModal>
  )
}

function UserProjectAccessRow({
  projectId,
  projectKey,
  projectName,
  userId,
  isWA,
  onRemove,
}: {
  projectId: string
  projectKey: string
  projectName: string
  userId: string
  isWA: boolean
  onRemove: () => void
}) {
  const { data: members = [] } = useProjectMembers(projectId)
  const me = members.find((m) => m.userId === userId)
  const updateAccess = useUpdateProjectAccess(projectId)
  const addMember = useAddProjectMember(projectId)

  function handleChange(level: 'admin' | 'editor') {
    if (me) {
      updateAccess.mutate(
        { memberId: me.id, accessLevel: level },
        {
          onSuccess: () => notify.success(`Access updated to ${level}`),
          onError: (e) => notify.fromError(e, 'Failed to update access'),
        },
      )
    } else {
      addMember.mutate(
        { userId, accessLevel: level },
        {
          onSuccess: () => notify.success(`Access set to ${level}`),
          onError: (e) => notify.fromError(e, 'Failed to set access'),
        },
      )
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="font-mono text-ui-xs text-foreground-subtle">{projectKey}</span>
        <span className="truncate text-ui-sm text-foreground">{projectName}</span>
      </div>
      <div className="w-32">
        {isWA ? (
          <SearchableSelect
            variant="cell"
            value={me?.accessLevel ?? ''}
            ariaLabel={`Access level for ${projectName}`}
            placeholder="No Access"
            options={ACCESS_OPTIONS}
            onChange={(v) => handleChange(v as 'admin' | 'editor')}
          />
        ) : (
          <span className="text-ui-sm text-foreground-subtle capitalize">
            {me?.accessLevel ?? 'No Access'}
          </span>
        )}
      </div>
      <div className="w-8 text-center">
        {isWA && me && (
          <IconButton
            size="sm"
            aria-label="Remove access"
            title="Remove access (No Access)"
            onClick={onRemove}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 size={13} />
          </IconButton>
        )}
      </div>
    </div>
  )
}
