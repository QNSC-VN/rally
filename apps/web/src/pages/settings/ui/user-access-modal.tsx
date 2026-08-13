/**
 * User Access modal — User-Centric Journey (SRS §5.1 / P4-RBAC-009).
 * Opens from the Members tab. Two tabs:
 *   - General: read-only identity (name/email/avatar are IdP/Profile-owned, same
 *     rule as the Members grid's `user` column) plus the one field that IS
 *     editable per-member today — Status (active/suspended), reusing the exact
 *     `useUpdateMember` + confirm-before-suspend behaviour the Members grid uses
 *     (P4-SET-07).
 *   - Project Access: a Workspace Admin can ASSIGN / CHANGE / REMOVE the user's
 *     per-Project access (admin / editor / No Access) — the same writes the
 *     Project-centric and Team journeys make, so all three stay synchronized —
 *     plus an inline Teams picker per project (P4-RBAC-010/011: team membership
 *     writes through the SAME `useAddTeamMember` / `useRemoveTeamMember` hooks
 *     the project's own Teams tab uses, so both surfaces stay in sync via one
 *     React Query cache).
 *
 * Every mutation here commits on change — there is no draft/batch-review state,
 * matching the rest of this file and `project-teams-tab.tsx`.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useProjects } from '@/features/projects/api'
import {
  useProjectMembers,
  useUpdateProjectAccess,
  useAddProjectMember,
  useProjectTeams,
  useAddTeamMember,
  useRemoveTeamMember,
  useUserTeamMemberships,
} from '@/features/teams/api'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateMember, type WorkspaceMember } from '@/features/workspaces/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { PERMISSION } from '@/shared/config/permissions'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { IconButton } from '@/shared/ui/icon-button'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { notify } from '@/shared/lib/toast'

const ACCESS_OPTIONS: SelectOption[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
]

// "Remove Access" is a permanent status='removed' transition (SRS §6.3: an
// inline status value, not a row action button) — same three values, same
// typed-confirmation rule, as the Members grid's inline Status cell.
const GENERAL_STATUS_OPTIONS: SelectOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Deactive' },
  { value: 'removed', label: 'Remove Access' },
]

type MemberStatus = 'active' | 'suspended' | 'removed'

type ModalTab = 'general' | 'access'

export function UserAccessModal({
  member,
  workspaceId,
  onClose,
}: {
  member: WorkspaceMember
  workspaceId: string
  onClose: () => void
}) {
  const { hasPermission, user } = useAuthStore()
  const isWA = hasPermission(PERMISSION.WORKSPACE_VIEW)
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<ModalTab>('general')
  const { data: projects = [], isLoading } = useProjects(workspaceId)
  const [removeProject, setRemoveProject] = useState<{ id: string; name: string } | null>(null)
  /* Mockup parity: the roster lists only projects the user HAS access to; the
   * rest surface through the "+ Add project access" picker. Membership is resolved
   * by the same per-project probe each row already runs — the row reports back. */
  const [membership, setMembership] = useState<Record<string, boolean>>({})
  const reportMembership = (projectId: string, hasAccess: boolean) => {
    setMembership((prev) =>
      prev[projectId] === hasAccess ? prev : { ...prev, [projectId]: hasAccess },
    )
  }

  // ── General tab: Status (active/suspended) — same hook + confirm-before-
  // suspend behaviour as the Members grid's inline status cell (P4-SET-07).
  const updateMember = useUpdateMember(workspaceId)
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const statusLocked = member.userId === user?.id || member.roleSlug === 'workspace_admin'
  const displayLabel = member.displayName ?? member.email ?? member.userId

  function commitStatus(status: MemberStatus) {
    if (status === member.status) return
    // Deactivate and Remove Access are destructive (P4-SET-07): confirm first.
    // Reactivating commits directly — mirrors the Members grid's commitStatus.
    if (status === 'suspended') {
      setConfirmSuspend(true)
      return
    }
    if (status === 'removed') {
      setConfirmRemove(true)
      return
    }
    updateMember.mutate(
      { memberId: member.id, status },
      {
        onSuccess: () => notify.success('Status updated'),
        onError: (e) => notify.fromError(e, 'Failed to update status'),
      },
    )
  }

  return (
    <AppModal open onClose={onClose} title="Manage Access" width={560}>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as ModalTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-5 pt-3">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="access">Project Access</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general" className="flex min-h-0 flex-1 flex-col">
          <ModalBody className="space-y-5">
            <div className="flex items-center gap-3">
              <OwnerAvatar name={displayLabel} avatarUrl={member.avatarUrl} size={32} />
              <div className="min-w-0">
                <p className="truncate text-ui-sm font-medium text-foreground">{displayLabel}</p>
                {member.email && (
                  <p className="truncate text-ui-xs text-foreground-subtle">{member.email}</p>
                )}
              </div>
            </div>
            <p className="text-ui-xs text-foreground-subtle">
              Name, email and avatar come from your identity provider and cannot be edited here.
            </p>

            <FormField label="Status">
              {isWA && !statusLocked ? (
                <SearchableSelect
                  variant="field"
                  value={member.status}
                  ariaLabel="Status"
                  options={GENERAL_STATUS_OPTIONS}
                  onChange={(v) => commitStatus(v as MemberStatus)}
                />
              ) : (
                <span className="text-ui-sm text-foreground capitalize">
                  {member.status === 'suspended' ? 'Deactive' : member.status}
                </span>
              )}
            </FormField>
          </ModalBody>
        </TabsContent>

        <TabsContent value="access" className="flex min-h-0 flex-1 flex-col">
          <ModalBody className="space-y-4">
            {isLoading ? (
              <div className="flex items-center gap-2 py-6 text-center text-ui-md text-foreground-subtle">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : projects.length === 0 ? (
              <p className="py-6 text-center text-ui-md text-foreground-subtle">
                No Projects available.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {projects
                  .filter((p) => membership[p.id] === true)
                  .map((p) => (
                    <UserProjectAccessRow
                      key={p.id}
                      projectId={p.id}
                      projectKey={p.key}
                      projectName={p.name}
                      userId={member.userId}
                      isWA={isWA}
                      onMembership={reportMembership}
                      onRemove={() => setRemoveProject({ id: p.id, name: `${p.key} · ${p.name}` })}
                    />
                  ))}
                {/* Probes for not-yet-assigned projects: resolve membership (and
                    re-report after an Add/Remove) without rendering a row. */}
                {projects
                  .filter((p) => membership[p.id] !== true)
                  .map((p) => (
                    <MembershipProbe
                      key={p.id}
                      projectId={p.id}
                      userId={member.userId}
                      onMembership={reportMembership}
                    />
                  ))}
                {Object.keys(membership).length > 0 &&
                  projects.every((p) => membership[p.id] !== true) && (
                    <p className="py-2 text-center text-ui-sm text-foreground-subtle">
                      No project access yet.
                    </p>
                  )}
                {isWA && projects.some((p) => membership[p.id] === false) && (
                  <AddProjectAccess
                    userId={member.userId}
                    candidates={projects
                      .filter((p) => membership[p.id] === false)
                      .map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))}
                  />
                )}
              </div>
            )}
          </ModalBody>
        </TabsContent>
      </Tabs>

      <ModalFooter className="justify-start">
        {/* AccessService.invalidateUser(s) busts the permission cache on write,
            so this is accurate: a grant/revocation lands on the user's NEXT
            request, not their next sign-in. */}
        <p className="text-ui-xs text-foreground-subtle">
          Changes take effect on your next request.
        </p>
      </ModalFooter>

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
              { params: { path: { id: removeProject.id, userId: member.userId } } },
            )
            if (error) throw new Error(apiErrorMessage(error, response.status))
            // Same staleness bug as Add: raw DELETE must bust the member caches
            // or the removed row lingers until refetch-by-staleTime.
            await queryClient.invalidateQueries({ queryKey: ['teams'] })
            notify.success('Access removed (No Access)')
          } catch (e) {
            notify.fromError(e, 'Failed to remove access')
          }
          setRemoveProject(null)
        }}
        onCancel={() => setRemoveProject(null)}
      />

      <ConfirmDialog
        open={confirmSuspend}
        title="Deactivate user"
        message={`Deactivate "${displayLabel}"? They lose access until reactivated.`}
        confirmLabel="Deactive"
        destructive
        pending={updateMember.isPending}
        onConfirm={() => {
          setConfirmSuspend(false)
          updateMember.mutate(
            { memberId: member.id, status: 'suspended' },
            {
              onSuccess: () => notify.success('Status updated'),
              onError: (e) => notify.fromError(e, 'Failed to update status'),
            },
          )
        }}
        onCancel={() => setConfirmSuspend(false)}
      />

      {/* Remove Access is high-risk: typed confirmation (type the user's name),
          same rule as the Members grid's per-row Remove Access (P4-SET-07). */}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove user access"
        message={`Permanently remove access for "${displayLabel}". They lose all workspace access.`}
        confirmText={displayLabel}
        confirmLabel="Remove Access"
        destructive
        pending={updateMember.isPending}
        onConfirm={() => {
          setConfirmRemove(false)
          updateMember.mutate(
            { memberId: member.id, status: 'removed' },
            {
              onSuccess: () => {
                notify.success('Status updated')
                onClose()
              },
              onError: (e) => notify.fromError(e, 'Failed to update status'),
            },
          )
        }}
        onCancel={() => setConfirmRemove(false)}
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
  onMembership,
  onRemove,
}: {
  projectId: string
  projectKey: string
  projectName: string
  userId: string
  isWA: boolean
  onMembership: (projectId: string, hasAccess: boolean) => void
  onRemove: () => void
}) {
  const { data: members = [], isLoading } = useProjectMembers(projectId)
  const me = members.find((m) => m.userId === userId)
  const updateAccess = useUpdateProjectAccess(projectId)
  const addMember = useAddProjectMember(projectId)
  const reported = useRef<boolean | null>(null)
  useEffect(() => {
    if (isLoading) return
    const has = !!me && me.accessLevel !== null && me.status === 'active'
    if (reported.current !== has) {
      reported.current = has
      onMembership(projectId, has)
    }
  }, [isLoading, me, projectId, onMembership])

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

  // Teams are only assignable where the user actually has Project access — a
  // "No Access" row has nothing to assign a team into (matches this file's own
  // Remove-Access copy above: losing Project access also clears Team membership).
  const canAssignTeams = isWA && (me?.accessLevel === 'admin' || me?.accessLevel === 'editor')

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4">
      <div className="flex items-end justify-between gap-2">
        <FormField label="Project" className="min-w-0 flex-1">
          {/* Not a picker — this row's project identity is fixed (Rally lists
              every workspace project already, there's nothing to "choose" here).
              Disabled Input keeps the same field-box weight as Access Level/
              Teams below it instead of a bare heading. */}
          <Input
            value={`${projectKey} · ${projectName}`}
            disabled
            aria-label="Project"
            className="disabled:opacity-100"
          />
        </FormField>
        {isWA && me && (
          <IconButton
            size="sm"
            aria-label="Remove access"
            title="Remove access (No Access)"
            variant="destructive"
            onClick={onRemove}
            className="mb-0.5"
          >
            <X size={14} />
          </IconButton>
        )}
      </div>

      <FormField label="Access Level">
        {isWA ? (
          <SearchableSelect
            variant="field"
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
      </FormField>

      {canAssignTeams && (
        <ProjectTeamsField
          projectId={projectId}
          projectName={projectName}
          userId={userId}
          requireTeam={me?.accessLevel === 'editor'}
        />
      )}
    </div>
  )
}

/** Invisible membership probe for a not-yet-assigned project: reports whether
 *  the user has access so the list and the Add picker stay truthful, without
 *  rendering a row. Re-reports after the cache invalidation an Add fires. */
function MembershipProbe({
  projectId,
  userId,
  onMembership,
}: {
  projectId: string
  userId: string
  onMembership: (projectId: string, hasAccess: boolean) => void
}) {
  const { data: members = [], isLoading } = useProjectMembers(projectId)
  useEffect(() => {
    if (isLoading) return
    const me = members.find((m) => m.userId === userId)
    onMembership(projectId, !!me && me.accessLevel !== null && me.status === 'active')
  }, [isLoading, members, projectId, userId, onMembership])
  return null
}

/** "+ Add project access" — pick an unassigned project + level, assign in one POST. */
function AddProjectAccess({ userId, candidates }: { userId: string; candidates: SelectOption[] }) {
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [level, setLevel] = useState<'admin' | 'editor'>('editor')
  const [pending, setPending] = useState(false)
  // Raw apiClient carries no `meta.invalidates` — without this the member caches
  // stay stale, the probe never re-reports, and the new row/Teams field never
  // appear. `['teams']` is the teamKeys root: covers projectMembers by prefix.
  const qc = useQueryClient()

  async function handleAdd() {
    if (!projectId) return
    setPending(true)
    try {
      const { error, response } = await apiClient.POST('/v1/projects/{id}/members', {
        params: { path: { id: projectId! } },
        body: { userId, accessLevel: level } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      await qc.invalidateQueries({ queryKey: ['teams'] })
      notify.success('Project access added')
      setProjectId(null)
      setLevel('editor')
      setOpen(false)
    } catch (e) {
      notify.fromError(e, 'Failed to add project access')
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add project access
      </Button>
    )
  }
  return (
    <div className="space-y-3 rounded-lg border border-border-subtle p-4">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Project" required>
          <SearchableSelect
            variant="field"
            value={projectId ?? ''}
            ariaLabel="Project to add"
            placeholder="Select project"
            options={candidates}
            onChange={(v) => setProjectId(v as string)}
          />
        </FormField>
        <FormField label="Access Level" required>
          <SearchableSelect
            variant="field"
            value={level}
            ariaLabel="Access level"
            options={ACCESS_OPTIONS}
            onChange={(v) => setLevel(v as 'admin' | 'editor')}
          />
        </FormField>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="button" disabled={!projectId || pending} onClick={handleAdd}>
          {pending && <Loader2 size={12} className="animate-spin" />} Add
        </Button>
      </div>
      <p className="text-ui-xs text-foreground-subtle">
        {level === 'editor'
          ? 'After adding, assign teams on the row below — an Editor needs at least one.'
          : 'Admin automatically covers all teams in the project.'}
      </p>
    </div>
  )
}

/**
 * Inline Teams multi-select for one project row (P4-RBAC-010/011). Writes
 * through the same `useAddTeamMember` / `useRemoveTeamMember` hooks the
 * project's own Teams tab uses (`project-teams-tab.tsx`), so this is not a
 * second write surface — both stay in sync via the shared `team` cache tag.
 *
 * `requireTeam` (Editor only — Admin bypasses Team scoping entirely per
 * `access.service.ts`'s `assertTeamScoped`, so a Team row is never load-bearing
 * for Admin): surfaces the SRS's "Editor must be assigned to at least one active
 * Team" rule inline rather than blocking the Access Level select itself — Rally
 * writes Access Level and Team membership as two independent immediate calls
 * (no batch/review step), so there's no single save action left to gate.
 */
function ProjectTeamsField({
  projectId,
  projectName,
  userId,
  requireTeam = false,
}: {
  projectId: string
  projectName: string
  userId: string
  requireTeam?: boolean
}) {
  const { data: teams = [] } = useProjectTeams(projectId)
  const teamIds = teams.map((t) => t.id)
  const { memberTeamIds, isLoading } = useUserTeamMemberships(teamIds, userId)
  // Unbound instances (no fixed teamId): the same team varies per selection
  // here, unlike the Teams tab's per-team cell, so the teamId travels with
  // each mutate() call instead of being bound at the hook call site.
  const addTeamMember = useAddTeamMember()
  const removeTeamMember = useRemoveTeamMember()

  if (teams.length === 0) return null

  const options: SelectOption[] = teams.map((t) => ({ value: t.id, label: t.name }))

  function handleChange(next: string[]) {
    for (const teamId of next.filter((id) => !memberTeamIds.includes(id))) {
      const team = teams.find((t) => t.id === teamId)
      addTeamMember.mutate(
        { teamId, userId },
        {
          onSuccess: () => notify.success(`Added to ${team?.name ?? 'team'}`),
          onError: (e) => notify.fromError(e, 'Failed to add to team'),
        },
      )
    }
    for (const teamId of memberTeamIds.filter((id) => !next.includes(id))) {
      const team = teams.find((t) => t.id === teamId)
      removeTeamMember.mutate(
        { teamId, userId },
        {
          onSuccess: () => notify.success(`Removed from ${team?.name ?? 'team'}`),
          onError: (e) => notify.fromError(e, 'Failed to remove from team'),
        },
      )
    }
  }

  return (
    <FormField label="Teams">
      <SearchableSelect
        multiple
        variant="field"
        value={memberTeamIds}
        readOnly={isLoading}
        options={options}
        ariaLabel={`Teams for ${projectName}`}
        placeholder="No teams"
        searchPlaceholder="Search teams"
        onChange={handleChange}
      />
      {requireTeam && !isLoading && memberTeamIds.length === 0 && (
        <p className="mt-1 text-ui-xs text-warning">
          Select at least one team — an Editor with no team can&apos;t act on any work in this
          project yet.
        </p>
      )}
    </FormField>
  )
}
