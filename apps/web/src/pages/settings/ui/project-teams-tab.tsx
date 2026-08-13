/**
 * Per-project Teams tab inside Settings > Workspaces & Projects. Lists the project's
 * teams and lets a Workspace Admin create a team (linked to this project), edit, and
 * deactivate/restore. Mirrors the mockup's Teams tab (Key | Team | Lead | Status |
 * Members | Actions + Add Team).
 *
 * Reuses the team hooks (useCreateTeam / useUpdateTeam / useProjectTeams). Team lead
 * candidates come from the workspace roster. A team cannot be deleted — only
 * deactivated (history preserved), per SRS §488.
 */
import { useState } from 'react'
import { Loader2, Plus, Pencil, Archive, RotateCcw } from 'lucide-react'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useProjectTeams,
  useCreateTeam,
  useUpdateTeam,
  useProjectMembers,
  useAddProjectMember,
  useUpdateProjectAccess,
  type Team,
  type ProjectMember,
} from '@/features/teams/api'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { useProjects } from '@/features/projects/api'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { SelectionCheckbox } from '@/shared/ui/selection-checkbox'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { IconButton } from '@/shared/ui/icon-button'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { FormField } from '@/shared/ui/form-field'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { notify } from '@/shared/lib/toast'

export function ProjectTeamsTab({ projectId, isWA }: { projectId: string; isWA: boolean }) {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: teams = [], isLoading } = useProjectTeams(projectId)
  const [editing, setEditing] = useState<Team | null>(null)
  const [creating, setCreating] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<Team | null>(null)
  const updateTeam = useUpdateTeam(deactivateTarget?.id ?? editing?.id ?? '')

  function confirmDeactivate() {
    if (!deactivateTarget) return
    updateTeam.mutate(
      { status: 'archived' },
      {
        onSuccess: () => {
          notify.success(`Deactivated ${deactivateTarget.name}`)
          setDeactivateTarget(null)
        },
        onError: (e) => notify.fromError(e, 'Failed to deactivate team'),
      },
    )
  }

  return (
    <>
      {isWA && (
        <div className="mb-3 flex justify-end">
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus size={14} /> Add team
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-ui-md text-foreground-subtle">
          <Loader2 size={14} className="animate-spin" /> Loading teams…
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-lg border border-border-subtle px-4 py-8 text-center text-ui-md text-foreground-subtle">
          No teams linked to this project yet.
        </div>
      ) : (
        <div className="rounded-lg border border-border-subtle">
          <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
            <span className="w-20">Key</span>
            <span className="flex-1">Team</span>
            <span className="w-24">Status</span>
            <span className="w-20 text-center">Members</span>
            {isWA && <span className="w-20 text-center">Actions</span>}
          </div>
          {teams.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
            >
              <span className="w-20 font-mono text-ui-xs text-foreground-subtle">{t.key}</span>
              <span className="flex-1 truncate text-ui-sm font-medium text-foreground">
                {t.name}
              </span>
              <span className="w-24 text-ui-xs text-foreground-subtle capitalize">
                {t.status === 'active' ? 'Active' : 'Deactivated'}
              </span>
              <span className="w-20 text-center text-ui-sm text-foreground-subtle">
                {t.memberCount ?? 0}
              </span>
              {isWA && (
                <span className="flex w-20 justify-center gap-1">
                  <IconButton
                    size="sm"
                    aria-label="Edit team"
                    title="Edit"
                    onClick={() => setEditing(t)}
                  >
                    <Pencil size={13} />
                  </IconButton>
                  {t.status === 'active' ? (
                    <IconButton
                      size="sm"
                      aria-label="Deactivate team"
                      title="Deactivate"
                      onClick={() => setDeactivateTarget(t)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Archive size={13} />
                    </IconButton>
                  ) : (
                    <RestoreButton teamId={t.id} name={t.name} />
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deactivateTarget}
        title="Deactivate team"
        message={
          deactivateTarget
            ? `Deactivate ${deactivateTarget.name}? It becomes unavailable for new membership. Delivery history is preserved.`
            : ''
        }
        confirmLabel="Deactivate"
        destructive
        pending={updateTeam.isPending}
        onConfirm={confirmDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />

      {(creating || editing) && (
        <TeamFormModal
          projectId={projectId}
          workspaceId={workspaceId}
          team={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

/** Restore needs its own hook instance (per-teamId). Kept tiny on purpose. */
function RestoreButton({ teamId, name }: { teamId: string; name: string }) {
  const updateTeam = useUpdateTeam(teamId)
  return (
    <IconButton
      size="sm"
      aria-label="Restore team"
      title="Restore"
      onClick={() =>
        updateTeam.mutate(
          { status: 'active' },
          {
            onSuccess: () => notify.success(`Restored ${name}`),
            onError: (e) => notify.fromError(e, 'Failed to restore team'),
          },
        )
      }
    >
      <RotateCcw size={13} />
    </IconButton>
  )
}

/** Members of a project other than the tab's own (raw apiClient — the hooks are
 *  single-project). Used by syncMemberAccess to cover every linked project. */
async function fetchMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error, response } = await apiClient.GET('/v1/projects/{id}/members', {
    params: { path: { id: projectId } },
  })
  if (error) throw new Error(apiErrorMessage(error, response.status))
  return (data as ProjectMember[]) ?? []
}

/**
 * Create or edit a team. On create the team defaults to this project only
 * (projectIds: [projectId]) but the WA can add more before submitting. On edit,
 * the Linked Projects field defaults to the team's current project links
 * (`team.projects`) and is included in the PATCH, so this is also the only
 * project-scoped surface that can add/remove which projects a team belongs to
 * — mirrors teams-tab.tsx's TeamProjectsCell, including its "keep >=1 project"
 * guard (a team must always stay linked to at least one project).
 */
function TeamFormModal({
  projectId,
  workspaceId,
  team,
  onClose,
}: {
  projectId: string
  workspaceId: string | undefined
  team: Team | null
  onClose: () => void
}) {
  const { data: wsMembers = [] } = useWorkspaceMembers(workspaceId)
  const { data: projects = [] } = useProjects(workspaceId)
  // Existing project members — only needed on create, to sync access for selected members.
  const { data: projectMembers = [] } = useProjectMembers(team ? undefined : projectId)
  const createTeam = useCreateTeam()
  const updateTeam = useUpdateTeam(team?.id ?? '')
  const addProjectMember = useAddProjectMember(projectId)
  const updateAccess = useUpdateProjectAccess(projectId)
  const [name, setName] = useState(team?.name ?? '')
  const [key, setKey] = useState(team?.key ?? '')
  const [leadId, setLeadId] = useState<string | null>(team?.leadId ?? null)
  const [projectIds, setProjectIds] = useState<string[]>(
    team ? (team.projects ?? []).map((p) => p.projectId) : [projectId],
  )
  // Per-user access map: presence of a userId = included; its value = the level that
  // row gets. Replaces the old (memberUserIds[] + one shared memberLevel) shape, which
  // could only add everyone at the SAME level — the mockup's Members & Access table lets
  // Priya Nair land as Admin while everyone else stays Editor in the same action.
  const [memberAccess, setMemberAccess] = useState<Record<string, 'admin' | 'editor'>>({})

  // Workspace Admin is company-level only — not a Team lead or member candidate (§2).
  const eligible = wsMembers.filter(
    (m) => m.status === 'active' && m.roleSlug !== 'workspace_admin',
  )
  const leadOptions: SelectOption[] = eligible.map((m) => ({
    value: m.userId,
    label: m.displayName ?? m.email ?? m.userId,
  }))
  const projectOptions: SelectOption[] = projects.map((p) => ({
    value: p.id,
    label: `${p.key} · ${p.name}`,
  }))
  const levelOptions: SelectOption[] = [
    { value: 'admin', label: 'Admin' },
    { value: 'editor', label: 'Editor' },
  ]

  const valid = name.trim().length >= 2 && /^[A-Z][A-Z0-9]{1,9}$/.test(key) && projectIds.length > 0

  /** Toggling a row includes/excludes it. A newly-checked row defaults to its CURRENT
   *  project access level (mockup: Priya Nair, already Admin, shows "Admin" once
   *  checked) or 'editor' when it has none yet — never a blanket shared default. */
  function toggleMemberRow(userId: string, currentLevel: 'admin' | 'editor' | null) {
    setMemberAccess((prev) => {
      const next = { ...prev }
      if (userId in next) {
        delete next[userId]
      } else {
        next[userId] = currentLevel ?? 'editor'
      }
      return next
    })
  }

  function setMemberRowLevel(userId: string, level: 'admin' | 'editor') {
    setMemberAccess((prev) => ({ ...prev, [userId]: level }))
  }

  /** P4-RBAC-010: setting up a team assigns each selected member their Project access —
   *  each at ITS OWN level, per `memberAccess` — on EVERY project the team is linked to.
   *  The roster implies membership in all linked projects; syncing only the tab's own
   *  project left an Editor No Access on the others (finding #4). Other projects use
   *  raw apiClient because the mutation hooks are bound to this tab's projectId. */
  async function syncMemberAccess() {
    for (const pid of projectIds) {
      const list: ProjectMember[] =
        pid === projectId ? projectMembers : ((await fetchMembers(pid)) ?? [])
      for (const [uid, level] of Object.entries(memberAccess)) {
        const existing = list.find((pm) => pm.userId === uid)
        if (existing) {
          if (existing.accessLevel === level) continue
          if (pid === projectId) {
            await updateAccess.mutateAsync({ memberId: existing.id, accessLevel: level })
          } else {
            const { error, response } = await apiClient.PATCH(
              '/v1/projects/{id}/members/{memberId}',
              {
                params: { path: { id: pid, memberId: existing.id } },
                body: { accessLevel: level },
              },
            )
            if (error) throw new Error(apiErrorMessage(error, response.status))
          }
        } else if (pid === projectId) {
          await addProjectMember.mutateAsync({ userId: uid, accessLevel: level })
        } else {
          const { error, response } = await apiClient.POST('/v1/projects/{id}/members', {
            params: { path: { id: pid } },
            body: { userId: uid, accessLevel: level } as never,
          })
          if (error) throw new Error(apiErrorMessage(error, response.status))
        }
      }
    }
  }

  async function handleSave() {
    if (!valid) return
    // A team must keep >=1 linked project (API constraint, same as
    // TeamProjectsCell's inline guard) — `valid` already covers this, but
    // guard here too since it's the actual submit path.
    if (projectIds.length === 0) {
      notify.error('A team must stay linked to at least one project')
      return
    }
    const base = { name: name.trim(), key, leadId: leadId ?? null, projectIds }
    if (team) {
      updateTeam.mutate(base, {
        onSuccess: () => {
          notify.success('Team updated')
          onClose()
        },
        onError: (e) => notify.fromError(e, 'Failed to update team'),
      })
      return
    }
    try {
      await createTeam.mutateAsync({
        workspaceId: workspaceId ?? '',
        ...base,
        memberUserIds: Object.keys(memberAccess),
      })
      await syncMemberAccess()
      notify.success('Team created')
      onClose()
    } catch (e) {
      notify.fromError(e, 'Failed to create team')
    }
  }

  const pending =
    createTeam.isPending ||
    updateTeam.isPending ||
    addProjectMember.isPending ||
    updateAccess.isPending

  return (
    <AppModal open onClose={onClose} title={team ? 'Edit team' : 'Create team'} width={460}>
      <ModalBody className="space-y-4">
        <FormField label="Team name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Core Platform"
          />
        </FormField>
        <FormField label="Team key" hint="2–10 uppercase letters/numbers" required>
          <Input
            value={key}
            disabled={!!team}
            onChange={(e) =>
              setKey(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 10),
              )
            }
            placeholder="CP"
            className="font-mono"
          />
        </FormField>
        <FormField
          label="Linked projects"
          hint="A team must stay linked to at least one project."
          required
        >
          <SearchableSelect
            variant="field"
            multiple
            value={projectIds}
            ariaLabel="Linked projects"
            placeholder="Select projects"
            options={projectOptions}
            onChange={(v) => setProjectIds(v as string[])}
          />
        </FormField>
        <FormField label="Team lead">
          <SearchableSelect
            variant="field"
            value={leadId ?? ''}
            ariaLabel="Team lead"
            placeholder="Unassigned"
            options={leadOptions}
            onChange={(v) => setLeadId(v as string | null)}
          />
        </FormField>
        {!team && eligible.length > 0 && (
          <FormField
            label={
              <div className="flex items-center justify-between gap-2">
                <span>Members & access</span>
                <span className="text-ui-xs font-normal text-foreground-subtle">
                  Admin joins All Teams; Editor joins this Team.
                </span>
              </div>
            }
          >
            <div className="rounded-lg border border-border-subtle">
              <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-hover px-3 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
                <span className="w-5" />
                <span className="flex-1">User</span>
                <span className="w-20 text-center">Current</span>
                <span className="w-32 text-center">New access</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {eligible.map((m) => {
                  const currentLevel =
                    projectMembers.find((pm) => pm.userId === m.userId)?.accessLevel ?? null
                  const checked = m.userId in memberAccess
                  const label = m.displayName ?? m.email ?? m.userId
                  return (
                    <div
                      key={m.userId}
                      className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0"
                    >
                      <span className="flex w-5 justify-center">
                        <SelectionCheckbox
                          checked={checked}
                          onChange={() => toggleMemberRow(m.userId, currentLevel)}
                          ariaLabel={`Add ${label} to this team`}
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <OwnerAvatar name={label} size={20} />
                        <span className="truncate text-ui-sm text-foreground">{label}</span>
                      </span>
                      <span className="w-20 text-center text-ui-xs text-foreground-subtle">
                        {currentLevel ? (
                          <span className="capitalize">{currentLevel}</span>
                        ) : (
                          'No Access'
                        )}
                      </span>
                      <span className="w-32">
                        {checked ? (
                          <SearchableSelect
                            variant="field"
                            dense
                            value={memberAccess[m.userId]}
                            ariaLabel={`Access level for ${label}`}
                            options={levelOptions}
                            onChange={(v) => setMemberRowLevel(m.userId, v as 'admin' | 'editor')}
                          />
                        ) : (
                          <span className="block text-center text-ui-xs text-foreground-subtle opacity-60">
                            Not added
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </FormField>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!valid || pending} onClick={handleSave}>
          {pending && <Loader2 size={12} className="animate-spin" />}
          {team ? 'Save' : 'Create team'}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
