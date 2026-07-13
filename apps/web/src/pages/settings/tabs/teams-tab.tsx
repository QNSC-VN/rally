import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, UserPlus, Plus, Pencil, ChevronRight, ArrowLeft, Archive, UsersRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useWorkspaceTeams,
  useTeamMembers,
  useCreateTeam,
  useUpdateTeam,
  useAddTeamMember,
  useRemoveTeamMember,
  type Team,
} from '@/features/teams/api'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'

// ── Teams tab ─────────────────────────────────────────────────────────────────

function CreateTeamModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const create = useCreateTeam()

  // Auto-generate key from name
  function derivedKey(n: string) {
    return n
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !key.trim()) return
    try {
      await create.mutateAsync({ workspaceId, name: name.trim(), key: key.trim(), description: description.trim() || undefined })
      toast.success(`Team "${name}" created`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create team')
    }
  }

  return (
    <AppModal open onClose={onClose} title="New Team" width={440}>
      <form onSubmit={(e) => { void handleSubmit(e) }}>
        <ModalBody className="space-y-4">
          <FormField label="Team name" required>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!key || key === derivedKey(name)) setKey(derivedKey(e.target.value))
              }}
              placeholder="Platform Engineering"
              autoFocus
            />
          </FormField>
          <FormField label="Key" required hint="Short alphanumeric identifier (max 8 chars)">
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder="PLAT"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this team own?"
              rows={2}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <button
            type="submit"
            disabled={create.isPending || !name.trim() || !key.trim()}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {create.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            Create team
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-80"
            style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
          >
            Cancel
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function EditTeamModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description ?? '')
  const [leadId, setLeadId] = useState(team.leadId ?? '')
  const update = useUpdateTeam(team.id)
  const { data: members = [] } = useTeamMembers(team.id)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await update.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        leadId: leadId || null,
      })
      toast.success('Team updated')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update team')
    }
  }

  return (
    <AppModal open onClose={onClose} title={`Edit ${team.name}`} width={440}>
      <form onSubmit={(e) => { void handleSubmit(e) }}>
        <ModalBody className="space-y-4">
          <FormField label="Team name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Team lead">
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
              style={{ borderColor: BRAND.border, backgroundColor: BRAND.surface, color: BRAND.textPrimary }}
            >
              <option value="">— No lead —</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName ?? m.email ?? m.userId}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <button
            type="submit"
            disabled={update.isPending || !name.trim()}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {update.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            Save
          </button>
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-[13px] font-medium" style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}>
            Cancel
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function AddMemberModal({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const [selectedUserId, setSelectedUserId] = useState('')
  const addMember = useAddTeamMember(teamId)
  const { data: members = [] } = useTeamMembers(teamId)

  // Load workspace members for the dropdown
  const { data: workspaceMembers = [] } = useQuery({
    queryKey: ['workspace-members-profile', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return []
      const { data, error, response } = await apiClient.GET('/v1/workspaces/{id}/members', {
        params: { path: { id: workspaceId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return ((data as { data?: unknown[] })?.data ?? []) as Array<{ userId: string; displayName?: string; email?: string }>
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  const alreadyAdded = new Set(members.map((m) => m.userId))
  const available = workspaceMembers.filter((m) => !alreadyAdded.has(m.userId))

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUserId) return
    try {
      await addMember.mutateAsync(selectedUserId)
      toast.success('Member added')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add member')
    }
  }

  return (
    <AppModal open onClose={onClose} title="Add team member" width={400}>
      <form onSubmit={(e) => { void handleAdd(e) }}>
        <ModalBody className="space-y-4">
          {available.length === 0 ? (
            <p className="text-[13px]" style={{ color: BRAND.textMuted }}>
              All workspace members are already on this team.
            </p>
          ) : (
            <FormField label="Select member" required>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
                style={{ borderColor: BRAND.border, backgroundColor: BRAND.surface, color: BRAND.textPrimary }}
              >
                <option value="">— Select a member —</option>
                {available.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ?? m.email ?? m.userId}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="submit"
            disabled={addMember.isPending || !selectedUserId || available.length === 0}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: BRAND.primary }}
          >
            {addMember.isPending ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={13} />}
            Add to team
          </button>
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-[13px] font-medium" style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}>
            Cancel
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

function TeamDetail({ team, onBack }: { team: Team; onBack: () => void }) {
  const { data: members = [], isLoading } = useTeamMembers(team.id)
  const remove = useRemoveTeamMember(team.id)
  const update = useUpdateTeam(team.id)
  const [showEdit, setShowEdit] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  async function handleRemoveMember(userId: string) {
    try {
      await remove.mutateAsync(userId)
      toast.success('Member removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  async function handleToggleStatus() {
    const next = team.status === 'active' ? 'archived' : 'active'
    if (next === 'archived') {
      setConfirmArchive(true)
      return
    }
    try {
      await update.mutateAsync({ status: next })
      toast.success('Team restored')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update team status')
    }
  }

  async function confirmArchiveAction() {
    setConfirmArchive(false)
    try {
      await update.mutateAsync({ status: 'archived' })
      toast.success(`Team "${team.name}" archived`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to archive team')
    }
  }

  return (
    <div>
      {/* Back + header */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[12px] transition-opacity hover:opacity-70"
          style={{ color: BRAND.textMuted }}
        >
          <ArrowLeft size={13} /> All teams
        </button>
        <span style={{ color: BRAND.border }}>·</span>
        <span className="text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>
          {team.name}
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-mono font-medium"
          style={{ backgroundColor: BRAND.surface, border: `1px solid ${BRAND.border}`, color: BRAND.textMuted }}
        >
          {team.key}
        </span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${team.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}
        >
          {team.status}
        </span>
        <button
          onClick={() => setShowEdit(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-100"
          style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
        >
          <Pencil size={12} /> Edit
        </button>
        <button
          onClick={() => { void handleToggleStatus() }}
          disabled={update.isPending}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-100 disabled:opacity-60"
          style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
        >
          {update.isPending ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
          {team.status === 'active' ? 'Archive' : 'Restore'}
        </button>
      </div>

      {team.description && (
        <p className="mb-5 text-[13px]" style={{ color: BRAND.textSecondary }}>
          {team.description}
        </p>
      )}

      {/* Members section */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>
          Members ({members.length})
        </h3>
        <button
          onClick={() => setShowAddMember(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND.primary }}
        >
          <Plus size={12} /> Add member
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={18} className="animate-spin" style={{ color: BRAND.textMuted }} />
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-lg py-10 text-center" style={{ border: `1px dashed ${BRAND.border}` }}>
          <p className="text-[13px]" style={{ color: BRAND.textMuted }}>No members yet. Add someone to get started.</p>
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BRAND.border}` }}>
          {members.map((member, idx) => (
            <div
              key={member.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                borderTop: idx > 0 ? `1px solid ${BRAND.border}` : undefined,
              }}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: BRAND.primary }}>
                {(member.displayName ?? member.userId).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate" style={{ color: BRAND.textPrimary }}>
                  {member.displayName ?? member.userId}
                </p>
                {member.email && (
                  <p className="text-[11px] truncate" style={{ color: BRAND.textMuted }}>{member.email}</p>
                )}
              </div>
              <span className="text-[11px] capitalize" style={{ color: BRAND.textMuted }}>{member.status}</span>
              <button
                onClick={() => { void handleRemoveMember(member.userId) }}
                disabled={remove.isPending}
                className="ml-2 rounded p-1 transition-colors hover:bg-red-50 hover:text-red-600"
                style={{ color: BRAND.textMuted }}
                title="Remove from team"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showEdit && <EditTeamModal team={team} onClose={() => setShowEdit(false)} />}
      {showAddMember && <AddMemberModal teamId={team.id} onClose={() => setShowAddMember(false)} />}
      <AppModal open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archive Team" width={380}>
        <ModalBody>
          <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
            Archive <strong>{team.name}</strong>? It will be hidden from active team lists.
          </p>
        </ModalBody>
        <ModalFooter>
          <button onClick={() => setConfirmArchive(false)} className="rounded-md px-3 py-1.5 text-[12px]" style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}>
            Cancel
          </button>
          <button onClick={() => void confirmArchiveAction()} className="rounded-md px-3 py-1.5 text-[12px] text-white" style={{ backgroundColor: BRAND.danger }}>
            Archive
          </button>
        </ModalFooter>
      </AppModal>
    </div>
  )
}

export function TeamsTab() {
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const { data: teams = [], isLoading } = useWorkspaceTeams(workspaceId)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)

  if (selectedTeam) {
    // Sync the selected team with live data (in case members change)
    const live = teams.find((t) => t.id === selectedTeam.id) ?? selectedTeam
    return <TeamDetail team={live} onBack={() => setSelectedTeam(null)} />
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
          Teams group members who collaborate on the same projects.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND.primary }}
        >
          <Plus size={13} /> New team
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin" style={{ color: BRAND.textMuted }} />
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-lg py-16 text-center" style={{ border: `1px dashed ${BRAND.border}` }}>
          <UsersRound size={28} className="mx-auto mb-3" style={{ color: BRAND.border }} />
          <p className="text-[13px] font-medium" style={{ color: BRAND.textSecondary }}>No teams yet</p>
          <p className="mt-1 text-[12px]" style={{ color: BRAND.textMuted }}>Create a team to group members and assign work items.</p>
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${BRAND.border}` }}>
          {teams.map((team, idx) => (
            <button
              key={team.id}
              onClick={() => setSelectedTeam(team)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-gray-50"
              style={{
                borderTop: idx > 0 ? `1px solid ${BRAND.border}` : undefined,
              }}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md text-[12px] font-bold text-white" style={{ backgroundColor: BRAND.primary }}>
                {team.key.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>{team.name}</p>
                {team.description && (
                  <p className="text-[12px] truncate" style={{ color: BRAND.textMuted }}>{team.description}</p>
                )}
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${team.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}
              >
                {team.status}
              </span>
              <ChevronRight size={14} style={{ color: BRAND.textMuted }} />
            </button>
          ))}
        </div>
      )}

      {showCreate && workspaceId && (
        <CreateTeamModal workspaceId={workspaceId} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
