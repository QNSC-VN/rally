/**
 * User Project Access modal — User-Centric Journey (SRS §5.1).
 * Opens from the Members tab. Shows the user's per-Project access levels
 * (admin / editor / No Access) across all workspace projects.
 */
import { Loader2 } from 'lucide-react'
import { useProjects } from '@/features/projects/api'
import { useProjectMembers } from '@/features/teams/api'
import { AppModal, ModalBody } from '@/shared/ui/app-modal'
import { OwnerAvatar } from '@/shared/ui/owner-cell'

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
  const { data: projects = [], isLoading } = useProjects(workspaceId)

  return (
    <AppModal open onClose={onClose} title="Project Access" width={520}>
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

        {/* Per-project access list */}
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
            {projects.map((p, i) => (
              <UserProjectAccessRow
                key={p.id}
                projectId={p.id}
                projectKey={p.key}
                projectName={p.name}
                userId={userId}
                isLast={i === projects.length - 1}
              />
            ))}
          </div>
        )}
      </ModalBody>
    </AppModal>
  )
}

function UserProjectAccessRow({
  projectId,
  projectKey,
  projectName,
  userId,
  isLast,
}: {
  projectId: string
  projectKey: string
  projectName: string
  userId: string
  isLast: boolean
}) {
  const { data: members = [] } = useProjectMembers(projectId)
  const me = members.find((m) => m.userId === userId)
  const level = me?.accessLevel

  const levelStyles: Record<string, string> = {
    admin: 'text-success font-medium',
    editor: 'text-warning font-medium',
  }

  return (
    <div
      className={`flex items-center justify-between px-4 py-2 ${
        isLast ? '' : 'border-b border-border-subtle'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-ui-xs text-foreground-subtle">{projectKey}</span>
        <span className="text-ui-sm text-foreground">{projectName}</span>
      </div>
      <span
        className={`text-ui-sm capitalize ${level ? (levelStyles[level] ?? 'text-foreground-subtle') : 'text-foreground-faint'}`}
      >
        {level ?? 'No Access'}
      </span>
    </div>
  )
}
