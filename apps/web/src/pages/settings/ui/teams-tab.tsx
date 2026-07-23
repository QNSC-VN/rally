import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, UsersRound } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useWorkspaceTeams,
  useTeamMembers,
  useCreateTeam,
  useUpdateTeam,
  type Team,
} from '@/features/teams/api'
import { useProjects } from '@/features/projects/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { SearchInput } from '@/shared/ui/search-input'
import { Spinner } from '@/shared/ui/spinner'
import { StatusBadge } from '@/shared/ui/status-badge'
import type { StatusStyle } from '@/shared/config/status-colors'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import { TeamAvatar } from '@/shared/ui/team-cell'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { MetricCard } from '@/shared/ui/metric-card'
import { formatDate } from '@/shared/lib/utils'

type TeamStatus = 'active' | 'archived'

/** Normalise free text into a team key: uppercase alphanumerics, max 10 chars. */
function sanitizeKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10)
}

const ACTIVE_STYLE: StatusStyle = {
  label: 'Active',
  text: BRAND.success,
  bg: BRAND.successBg,
  border: BRAND.successBorder,
}
const DEACTIVE_STYLE: StatusStyle = {
  label: 'Deactive',
  text: BRAND.textSecondary,
  bg: BRAND.surfaceSubtle,
  border: BRAND.border,
}

function TeamStatusBadge({ status }: { status: TeamStatus }) {
  return <StatusBadge style={status === 'active' ? ACTIVE_STYLE : DEACTIVE_STYLE} />
}

// ── Create/Edit Team modal (single inline form, real-Rally style) ───────────────

function TeamFormModal({
  workspaceId,
  team,
  onClose,
}: {
  workspaceId: string
  team: Team | null
  onClose: () => void
}) {
  const isEdit = team !== null
  const create = useCreateTeam()
  const update = useUpdateTeam(team?.id ?? '')
  const pending = create.isPending || update.isPending

  const { data: projects = [] } = useProjects(workspaceId)
  const { data: members = [] } = useWorkspaceMembers(workspaceId)
  const { data: teamMembers = [], isFetched: membersFetched } = useTeamMembers(team?.id)

  const [name, setName] = useState(team?.name ?? '')
  const [key, setKey] = useState(team?.key ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [status, setStatus] = useState<TeamStatus>(team?.status ?? 'active')
  const [leadId, setLeadId] = useState(team?.leadId ?? '')
  const [projectIds, setProjectIds] = useState<string[]>(
    team?.projects?.map((p) => p.projectId) ?? [],
  )
  const [memberUserIds, setMemberUserIds] = useState<string[]>([])

  // On edit, seed the member selection once the team's roster resolves.
  const seededRef = useRef(false)
  useEffect(() => {
    if (isEdit && membersFetched && !seededRef.current) {
      setMemberUserIds(teamMembers.map((m) => m.userId))
      seededRef.current = true
    }
  }, [isEdit, membersFetched, teamMembers])

  const canSubmit = name.trim() !== '' && key.trim() !== '' && projectIds.length > 0

  const projectOptions = projects.map((p) => ({
    value: p.id,
    label: `${p.key} · ${p.name}`,
    searchText: `${p.key} ${p.name}`,
  }))
  const memberOptions = members.map((m) => {
    const n = m.displayName ?? m.email ?? m.userId
    return { value: m.userId, label: n, searchText: n, icon: <OwnerAvatar name={n} size={16} /> }
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    try {
      if (isEdit) {
        await update.mutateAsync({
          name: name.trim(),
          description: description.trim() || null,
          leadId: leadId || null,
          status,
          projectIds,
          memberUserIds,
        })
        notify.success('Team updated')
      } else {
        await create.mutateAsync({
          workspaceId,
          name: name.trim(),
          key: key.trim(),
          description: description.trim() || undefined,
          leadId: leadId || null,
          status,
          projectIds,
          memberUserIds,
        })
        notify.success(`Team "${name.trim()}" created`)
      }
      onClose()
    } catch (err) {
      notify.fromError(err, isEdit ? 'Failed to update team' : 'Failed to create team')
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${team.name}` : 'Create Team'}
      width={480}
    >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <ModalBody className="space-y-4">
          <FormField label="Team Name" required>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!isEdit && (!key || key === sanitizeKey(name))) {
                  setKey(sanitizeKey(e.target.value))
                }
              }}
              placeholder="Platform Engineering"
            />
          </FormField>

          <FormField label="Team Key" required hint="Uppercase, unique in workspace (max 10)">
            <Input
              value={key}
              onChange={(e) => setKey(sanitizeKey(e.target.value))}
              placeholder="PLAT"
              disabled={isEdit}
            />
          </FormField>

          <FormField label="Projects" required hint="A team must belong to at least one project">
            <SearchableSelect
              variant="field"
              multiple
              value={projectIds}
              ariaLabel="Projects"
              placeholder="Select projects…"
              searchPlaceholder="Search projects"
              options={projectOptions}
              onChange={(ids) => setProjectIds(ids as string[])}
            />
          </FormField>

          <FormField label="Team Lead">
            <SearchableSelect
              variant="field"
              value={leadId}
              ariaLabel="Team lead"
              placeholder="No lead"
              searchPlaceholder="Search members"
              options={[{ value: '', label: 'No lead' }, ...memberOptions]}
              onChange={(v) => setLeadId(v as string)}
            />
          </FormField>

          <FormField label="Members">
            <SearchableSelect
              variant="field"
              multiple
              value={memberUserIds}
              ariaLabel="Members"
              placeholder="Add members…"
              searchPlaceholder="Search members"
              options={memberOptions}
              onChange={(ids) => setMemberUserIds(ids as string[])}
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

          <FormField label="Status" required>
            <SearchableSelect
              variant="field"
              value={status}
              ariaLabel="Status"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Deactive' },
              ]}
              onChange={(v) => setStatus(v as TeamStatus)}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button type="submit" disabled={pending || !canSubmit}>
            {pending ? <Loader2 size={12} className="animate-spin" /> : null}
            {isEdit ? 'Save' : 'Create'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}

// ── Teams list ──────────────────────────────────────────────────────────────

export function TeamsTab() {
  const { t } = useTranslation('settings')
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  // Management needs every team (metrics + status filter) — include deactive.
  const { data: teams = [], isLoading } = useWorkspaceTeams(workspaceId, true)
  const { data: members = [] } = useWorkspaceMembers(workspaceId)
  const { data: projects = [] } = useProjects(workspaceId)

  const [showCreate, setShowCreate] = useState(false)
  const [editTeam, setEditTeam] = useState<Team | null>(null)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('') // '' = all
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('active')

  const memberById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])

  const metrics = useMemo(() => {
    const active = teams.filter((t) => t.status === 'active').length
    return { total: teams.length, active, deactive: teams.length - active }
  }, [teams])

  const visibleTeams = useMemo(() => {
    const q = search.trim().toLowerCase()
    return teams.filter((team) => {
      if (statusFilter !== 'all' && team.status !== statusFilter) return false
      if (projectFilter && !(team.projects ?? []).some((p) => p.projectId === projectFilter)) {
        return false
      }
      if (!q) return true
      const lead = team.leadId ? memberById.get(team.leadId) : undefined
      const haystack = [
        team.key,
        team.name,
        ...(team.projects ?? []).flatMap((p) => [p.key, p.name]),
        lead?.displayName ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [teams, search, projectFilter, statusFilter, memberById])

  return (
    <div>
      {/* Metric strip — Total / Active / Deactive (SRS §5.1) */}
      <MetricStrip className="mb-5 rounded-lg border">
        <MetricCard label="Total Teams" value={metrics.total} />
        <MetricCard label="Active" value={metrics.active} valueColor={BRAND.success} />
        <MetricCard label="Deactive" value={metrics.deactive} valueColor={BRAND.textSecondary} />
      </MetricStrip>

      {/* Toolbar: filters + create */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search teams…" width={224} />
        <div className="w-48">
          <SearchableSelect
            variant="field"
            value={projectFilter}
            ariaLabel="Filter by project"
            placeholder="All projects"
            options={[
              { value: '', label: 'All projects' },
              ...projects.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` })),
            ]}
            onChange={(v) => setProjectFilter(v as string)}
          />
        </div>
        <div className="w-40">
          <SearchableSelect
            variant="field"
            value={statusFilter}
            ariaLabel="Filter by status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Deactive' },
              { value: 'all', label: 'All statuses' },
            ]}
            onChange={(v) => setStatusFilter(v as 'all' | 'active' | 'archived')}
          />
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setShowCreate(true)}>
          <Plus size={13} /> Create Team
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : visibleTeams.length === 0 ? (
        <EmptyState
          icon={<UsersRound size={28} className="text-border-strong" />}
          title={teams.length === 0 ? 'No teams yet' : 'No teams match your filters'}
          description="Create a team and link it to a project to start assigning work."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {/* Column header */}
          <div className="flex items-center gap-4 border-b bg-surface-subtle px-4 py-2 text-ui-sm font-semibold tracking-wide text-foreground-subtle uppercase">
            <div className="w-20 shrink-0">{t('teams.colKey')}</div>
            <div className="min-w-0 flex-1">{t('teams.colTeam')}</div>
            <div className="hidden w-48 shrink-0 md:block">{t('teams.colProject')}</div>
            <div className="w-24 shrink-0">{t('common:status')}</div>
            <div className="hidden w-40 shrink-0 sm:block">{t('teams.colLead')}</div>
            <div className="hidden w-24 shrink-0 lg:block">{t('teams.colUpdated')}</div>
          </div>
          {visibleTeams.map((team, idx) => {
            const lead = team.leadId ? memberById.get(team.leadId) : undefined
            const primary = team.projects?.[0]
            const extra = (team.projects?.length ?? 0) - 1
            return (
              <button
                key={team.id}
                onClick={() => setEditTeam(team)}
                className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-hover ${
                  idx > 0 ? 'border-t' : ''
                }`}
              >
                <div className="w-20 shrink-0">
                  <span className="rounded border bg-surface-subtle px-1.5 py-0.5 font-mono text-ui-sm font-medium text-foreground-subtle">
                    {team.key}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <TeamAvatar teamKey={team.key} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-ui-lg font-semibold text-foreground">{team.name}</p>
                    {team.description && (
                      <p className="truncate text-ui-sm text-foreground-subtle">
                        {team.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="hidden w-48 shrink-0 truncate text-ui-md text-muted-foreground md:block">
                  {primary ? (
                    <>
                      <span className="font-mono text-ui-sm">{primary.key}</span> / {primary.name}
                      {extra > 0 && <span className="text-foreground-subtle"> +{extra}</span>}
                    </>
                  ) : (
                    <span className="text-foreground-disabled">—</span>
                  )}
                </div>
                <div className="w-24 shrink-0">
                  <TeamStatusBadge status={team.status} />
                </div>
                <div className="hidden w-40 shrink-0 items-center gap-1.5 sm:flex">
                  {lead ? (
                    <>
                      <OwnerAvatar name={lead.displayName} avatarUrl={lead.avatarUrl} size={20} />
                      <span className="truncate text-ui-md text-muted-foreground">
                        {lead.displayName}
                      </span>
                    </>
                  ) : (
                    <span className="text-ui-md text-foreground-disabled">{t('teams.noLead')}</span>
                  )}
                </div>
                <div className="hidden w-24 shrink-0 text-ui-md text-foreground-subtle lg:block">
                  {formatDate(team.updatedAt)}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {showCreate && workspaceId && (
        <TeamFormModal workspaceId={workspaceId} team={null} onClose={() => setShowCreate(false)} />
      )}
      {editTeam && workspaceId && (
        <TeamFormModal
          workspaceId={workspaceId}
          team={editTeam}
          onClose={() => setEditTeam(null)}
        />
      )}
    </div>
  )
}
