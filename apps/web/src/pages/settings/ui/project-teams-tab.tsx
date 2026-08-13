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
import { useProjectTeams, useCreateTeam, useUpdateTeam, type Team } from '@/features/teams/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
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

/** Create or edit a team. On create the team is linked to this project (projectIds). */
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
  const createTeam = useCreateTeam()
  const updateTeam = useUpdateTeam(team?.id ?? '')
  const [name, setName] = useState(team?.name ?? '')
  const [key, setKey] = useState(team?.key ?? '')
  const [leadId, setLeadId] = useState<string | null>(team?.leadId ?? null)

  const leadOptions: SelectOption[] = wsMembers
    .filter((m) => m.status === 'active')
    .map((m) => ({ value: m.userId, label: m.displayName ?? m.email ?? m.userId }))

  const valid = name.trim().length >= 2 && /^[A-Z][A-Z0-9]{1,9}$/.test(key)

  function handleSave() {
    if (!valid) return
    const base = { name: name.trim(), key, leadId: leadId ?? null }
    if (team) {
      updateTeam.mutate(base, {
        onSuccess: () => {
          notify.success('Team updated')
          onClose()
        },
        onError: (e) => notify.fromError(e, 'Failed to update team'),
      })
    } else {
      createTeam.mutate(
        { workspaceId: workspaceId ?? '', ...base, projectIds: [projectId] },
        {
          onSuccess: () => {
            notify.success('Team created')
            onClose()
          },
          onError: (e) => notify.fromError(e, 'Failed to create team'),
        },
      )
    }
  }

  const pending = createTeam.isPending || updateTeam.isPending

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
