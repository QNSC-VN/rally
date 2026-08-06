import { useCallback, useMemo, useState } from 'react'
import { SettingsTabHeader } from './settings-tab-header'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { Archive, Loader2, Plus } from 'lucide-react'
import { BulkBarButton } from '@/shared/ui/bulk-action-bar'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

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
import { useProjects } from '@/features/projects/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { OwnerAvatar, OwnerSelectCell, type OwnerSelectMember } from '@/shared/ui/owner-cell'
import { TeamAvatar } from '@/shared/ui/team-cell'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { MetricStrip } from '@/shared/ui/metric-strip'
import { MetricCard } from '@/shared/ui/metric-card'
import {
  SelectableTable,
  useDataTable,
  type ColumnSpec,
  type RowSelection,
} from '@/shared/ui/table'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import { PaginationFooter } from '@/shared/ui/pagination-footer'
import { RowGutter } from '@/shared/ui/row-gutter'
import { useRowSelection } from '@/shared/lib/hooks/use-row-selection'
import { STORAGE_KEYS } from '@/shared/config/storage-keys'
import { formatDateIso } from '@/shared/lib/utils'

type TeamStatus = 'active' | 'archived'

/** Normalise free text into a team key: uppercase alphanumerics, max 10 chars. */
function sanitizeKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10)
}

// ── Config-driven column catalog (rendered by the shared table engine) ─────────
// Per-render context carrying the shared read-data the inline-edit cells need
// (workspace members + option lists). Each editable cell is its own component so
// it can own the per-team mutation hook (useUpdateTeam / add-remove member) —
// mirrors the Projects ProjectTeamsCell pattern. Users adopts the same paradigm:
// Lead / Members / Projects / Status are edited directly in their cells.
interface TeamCtx {
  members: OwnerSelectMember[]
  memberOptions: SelectOption[]
  projectOptions: SelectOption[]
}

type TeamColKey = 'team' | 'lead' | 'members' | 'projects' | 'status' | 'created'

const TEAM_COLUMNS: ColumnSpec<Team, TeamCtx, TeamColKey>[] = [
  {
    key: 'team',
    label: 'Team',
    sortCol: 'team',
    defaultWidth: 260,
    minWidth: 180,
    locked: true,
    grow: true,
    cellClassName: 'flex min-w-0 items-center gap-2',
    // Team glyph + inline-editable name (key stays immutable, like Project key).
    cell: (team) => <TeamNameCell team={team} />,
  },
  {
    key: 'lead',
    label: 'Lead',
    sortCol: 'lead',
    defaultWidth: 200,
    minWidth: 140,
    cellClassName: 'flex min-w-0 items-center',
    cell: (team, ctx) => <TeamLeadCell team={team} members={ctx.members} />,
  },
  {
    key: 'members',
    label: 'Members',
    defaultWidth: 240,
    minWidth: 160,
    cellClassName: 'flex min-w-0 items-center',
    cell: (team, ctx) => <TeamMembersCell team={team} options={ctx.memberOptions} />,
  },
  {
    key: 'projects',
    label: 'Projects',
    defaultWidth: 240,
    minWidth: 160,
    cellClassName: 'flex min-w-0 items-center',
    cell: (team, ctx) => <TeamProjectsCell team={team} options={ctx.projectOptions} />,
  },
  {
    key: 'status',
    label: 'Status',
    sortCol: 'status',
    defaultWidth: 130,
    minWidth: 100,
    cellClassName: 'flex min-w-0 items-center',
    cell: (team) => <TeamStatusCell team={team} />,
  },
  {
    key: 'created',
    label: 'Created',
    sortCol: 'created',
    defaultWidth: 130,
    minWidth: 100,
    cellClassName: 'flex items-center',
    cell: (team) => (
      <span className="truncate text-ui-md text-foreground-subtle">
        {formatDateIso(team.createdAt)}
      </span>
    ),
  },
]

// Match the iteration-status / Users row look exactly (white rows, subtle
// divider). Rows are not clickable — the cells are the interactive surface.
const ROW_CLASS =
  'group flex min-h-[34px] min-w-max items-center gap-2 border-b border-border-subtle bg-card px-3 text-ui-md transition-colors duration-100 hover:bg-primary-lighter'

// ── Inline-edit cells (each owns its per-team mutation hook) ───────────────────

/** Team name — inline rename (key stays immutable, like Project key); commits
 *  via useUpdateTeam. Empty/unchanged commits are ignored. */
function TeamNameCell({ team }: { team: Team }) {
  const { t } = useTranslation('settings')
  const update = useUpdateTeam(team.id)
  return (
    <>
      <TeamAvatar teamKey={team.key} name={team.name} size={20} />
      <div className="min-w-0 flex-1 px-0">
        <InlineEditableCell
          value={team.name}
          canEdit
          fullCell
          ariaLabel={t('teams.editName')}
          title={team.name}
          className="break-words whitespace-normal text-foreground"
          style={{ fontSize: 12 }}
          inputStyle={{ fontSize: 12 }}
          onCommit={(v) => {
            const next = v.trim()
            if (!next || next === team.name) return
            void update
              .mutateAsync({ name: next })
              .then(() => notify.success(t('teams.nameUpdated')))
              .catch((err: unknown) => notify.fromError(err, t('teams.nameUpdateError')))
          }}
        />
      </div>
    </>
  )
}

/** Lead — inline person picker (OwnerSelectCell); commits via useUpdateTeam. */
function TeamLeadCell({ team, members }: { team: Team; members: OwnerSelectMember[] }) {
  const { t } = useTranslation('settings')
  const update = useUpdateTeam(team.id)
  const lead = team.leadId ? members.find((m) => m.userId === team.leadId) : undefined
  const leadName = lead?.displayName ?? lead?.email ?? null
  return (
    <div className="min-w-0 flex-1">
      <OwnerSelectCell
        ownerName={leadName}
        assigneeId={team.leadId}
        members={members}
        canEdit
        ariaLabel={t('teams.editLead')}
        onChange={(userId) =>
          void update
            .mutateAsync({ leadId: userId })
            .then(() => notify.success(t('teams.leadUpdated')))
            .catch((err: unknown) => notify.fromError(err, t('teams.leadUpdateError')))
        }
      />
    </div>
  )
}

/** Members — inline multi-select chips; commits by diffing add/remove exactly
 *  like the Projects ProjectTeamsCell (link/unlink). */
function TeamMembersCell({ team, options }: { team: Team; options: SelectOption[] }) {
  const { t } = useTranslation('settings')
  const { data: teamMembers = [] } = useTeamMembers(team.id)
  const add = useAddTeamMember(team.id)
  const remove = useRemoveTeamMember(team.id)
  const current = teamMembers.map((m) => m.userId)
  return (
    <div className="min-w-0 flex-1">
      <SearchableSelect
        multiple
        variant="cell"
        value={current}
        options={options}
        ariaLabel={t('teams.editMembers')}
        placeholder="--"
        searchPlaceholder={t('teams.searchMembers')}
        onChange={(ids) => {
          const next = ids as string[]
          next.filter((id) => !current.includes(id)).forEach((id) => add.mutate(id))
          current.filter((id) => !next.includes(id)).forEach((id) => remove.mutate(id))
        }}
      />
    </div>
  )
}

/** Projects — inline multi-select; a team must keep ≥1 project, so committing
 *  the full set via useUpdateTeam({ projectIds }) is guarded against clearing. */
function TeamProjectsCell({ team, options }: { team: Team; options: SelectOption[] }) {
  const { t } = useTranslation('settings')
  const update = useUpdateTeam(team.id)
  const current = (team.projects ?? []).map((p) => p.projectId)
  return (
    <div className="min-w-0 flex-1">
      <SearchableSelect
        multiple
        variant="cell"
        value={current}
        options={options}
        ariaLabel={t('teams.editProjects')}
        placeholder="--"
        searchPlaceholder={t('teams.searchProjects')}
        onChange={(ids) => {
          const next = ids as string[]
          if (next.length === 0) {
            notify.error(t('teams.projectsMinError'))
            return
          }
          void update
            .mutateAsync({ projectIds: next })
            .then(() => notify.success(t('teams.projectsUpdated')))
            .catch((err: unknown) => notify.fromError(err, t('teams.projectsUpdateError')))
        }}
      />
    </div>
  )
}

/** Status — inline active/archived picker; commits via useUpdateTeam({ status }). */
function TeamStatusCell({ team }: { team: Team }) {
  const { t } = useTranslation('settings')
  const update = useUpdateTeam(team.id)
  // Archive is a destructive transition (P4-SET-07): confirm before committing.
  // Restoring an archived team (archived -> active) is not destructive, so it
  // goes through directly — same reversible framing as the bulk-archive dialog.
  const [pendingArchive, setPendingArchive] = useState(false)
  function commitStatus(next: TeamStatus) {
    void update
      .mutateAsync({ status: next })
      .then(() => notify.success(t('teams.statusUpdated')))
      .catch((err: unknown) => notify.fromError(err, t('teams.statusUpdateError')))
  }
  return (
    <>
      <div className="min-w-0 flex-1">
        <SearchableSelect
          variant="cell"
          value={team.status}
          options={[
            { value: 'active', label: t('teams.statusActive') },
            { value: 'archived', label: t('teams.statusArchived') },
          ]}
          ariaLabel={t('teams.editStatus')}
          onChange={(v) => {
            const next = v as TeamStatus
            if (next === team.status) return
            if (next === 'archived') {
              setPendingArchive(true)
              return
            }
            commitStatus(next)
          }}
        />
      </div>
      <ConfirmDialog
        open={pendingArchive}
        title={t('teams.archiveOneTitle', 'Archive team')}
        message={t('teams.archiveOneConfirm', {
          name: team.name,
          defaultValue: 'Archive "{{name}}"? You can restore it later.',
        })}
        confirmLabel={t('teams.statusArchived')}
        destructive
        pending={update.isPending}
        onConfirm={() => {
          setPendingArchive(false)
          commitStatus('archived')
        }}
        onCancel={() => setPendingArchive(false)}
      />
    </>
  )
}

/** Click-to-sort state for the shared header (same contract as the list pages). */
function useColumnSort() {
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const onSort = useCallback(
    (col: string) => {
      if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      else {
        setSortCol(col)
        setSortDir('asc')
      }
    },
    [sortCol],
  )
  return { sortCol, sortDir, sort: { col: sortCol, dir: sortDir, onSort } }
}

/** Client-side sort over the (small, fully-loaded) team roster. */
function sortRows<T>(
  rows: T[],
  sortCol: string | null,
  sortDir: 'asc' | 'desc',
  keyOf: (row: T, col: string) => string | number,
): T[] {
  if (!sortCol) return rows
  const dir = sortDir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = keyOf(a, sortCol)
    const bv = keyOf(b, sortCol)
    if (av < bv) return -1 * dir
    if (av > bv) return 1 * dir
    return 0
  })
}

export function TeamsTab() {
  const { t } = useTranslation('settings')
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  // Management needs every team (metrics + status filter) — include archived.
  const { data: teams = [], isLoading } = useWorkspaceTeams(workspaceId, true)
  const { data: members = [] } = useWorkspaceMembers(workspaceId)
  const { data: projects = [] } = useProjects(workspaceId)

  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all')

  const memberById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])

  const metrics = useMemo(() => {
    const active = teams.filter((tm) => tm.status === 'active').length
    return { total: teams.length, active, archived: teams.length - active }
  }, [teams])

  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase()
    return teams.filter((team) => {
      if (statusFilter !== 'all' && team.status !== statusFilter) return false
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
  }, [teams, search, statusFilter, memberById])

  // Shared table engine (resize / reorder / Show-Fields) + click-to-sort header.
  const { sortCol, sortDir, sort } = useColumnSort()
  const table = useDataTable<Team, TeamCtx, TeamColKey>(TEAM_COLUMNS, {
    storageKey: STORAGE_KEYS.SETTINGS_TEAMS_COLUMNS,
  })

  const sortedTeams = useMemo(
    () =>
      sortRows(filteredTeams, sortCol, sortDir, (team, col) => {
        switch (col) {
          case 'team':
            return team.name.toLowerCase()
          case 'status':
            return team.status
          case 'created':
            return team.createdAt
          case 'lead': {
            const lead = team.leadId ? memberById.get(team.leadId) : undefined
            return (lead?.displayName ?? '').toLowerCase()
          }
          default:
            return ''
        }
      }),
    [filteredTeams, sortCol, sortDir, memberById],
  )

  const ownerMembers = useMemo<OwnerSelectMember[]>(
    () => members.map((m) => ({ userId: m.userId, displayName: m.displayName, email: m.email })),
    [members],
  )
  const memberOptions = useMemo<SelectOption[]>(
    () =>
      members.map((m) => {
        const n = m.displayName ?? m.email ?? m.userId
        return {
          value: m.userId,
          label: n,
          searchText: n,
          icon: <OwnerAvatar name={n} size={16} />,
        }
      }),
    [members],
  )
  const projectOptions = useMemo<SelectOption[]>(
    () =>
      projects.map((p) => ({
        value: p.id,
        label: `${p.key} · ${p.name}`,
        searchText: `${p.key} ${p.name}`,
      })),
    [projects],
  )

  const cellCtx = useMemo<TeamCtx>(
    () => ({ members: ownerMembers, memberOptions, projectOptions }),
    [ownerMembers, memberOptions, projectOptions],
  )

  const activeFilterCount = statusFilter !== 'all' ? 1 : 0

  // ── Client-side pagination over the filtered/sorted roster ──────────────
  // Mirrors the Users tab / Iteration Status page.
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(sortedTeams.length / pageSize))
  const pageResetKey = `${search}|${statusFilter}|${sortCol ?? ''}|${sortDir}|${pageSize}`
  const [syncedPageKey, setSyncedPageKey] = useState(pageResetKey)
  if (syncedPageKey !== pageResetKey) {
    setSyncedPageKey(pageResetKey)
    setPage(1)
  }
  const currentPage = Math.min(page, pageCount)
  const pagedTeams = useMemo(
    () => sortedTeams.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedTeams, currentPage, pageSize],
  )
  const goPrevPage = useCallback(() => setPage((p) => Math.max(1, p - 1)), [])
  const goNextPage = useCallback(() => setPage((p) => p + 1), [])

  // Row selection over the full filtered roster (bulk actions span pages).
  const selection = useRowSelection(sortedTeams)
  // Holds the selection pending an archive confirmation (null = dialog closed).
  const [archiveTarget, setArchiveTarget] = useState<RowSelection | null>(null)

  // Bulk archive — archive selected active teams. useUpdateTeam bakes the team
  // id into the hook, so a bulk action over arbitrary selected ids uses a small
  // component-local mutation over the SAME PATCH /v1/teams/{id} endpoint (no API
  // layer change; mirrors the Users tab's inline role mutation).
  const archiveTeam = useMutation({
    mutationFn: async (teamId: string) => {
      const { error, response } = await apiClient.PATCH('/v1/teams/{id}', {
        params: { path: { id: teamId } },
        body: { status: 'archived' } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['team'] },
  })
  async function archiveSelected(sel: RowSelection) {
    const targets = teams.filter((tm) => sel.selectedIds.has(tm.id) && tm.status === 'active')
    if (targets.length === 0) {
      sel.clear()
      return
    }
    try {
      await Promise.all(targets.map((tm) => archiveTeam.mutateAsync(tm.id)))
      notify.success(t('teams.bulkArchived', { count: targets.length }))
    } catch (err) {
      notify.fromError(err, t('teams.bulkArchiveError'))
    } finally {
      sel.clear()
    }
  }

  if (!workspaceId) {
    return <p className="text-ui-lg text-foreground-subtle">{t('members.noWorkspace')}</p>
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-foreground-subtle">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-ui-lg">{t('teams.loading')}</span>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SettingsTabHeader title={t('nav.teams')} description={t('tabDescriptions.teams')} />

      {/* Metric strip — Total / Active / Deactive. */}
      <div className="flex shrink-0 flex-col gap-4 px-4 pt-4">
        <MetricStrip className="rounded-lg border">
          <MetricCard label="Total Teams" value={metrics.total} />
          <MetricCard label="Active" value={metrics.active} valueColor={BRAND.success} />
          <MetricCard label="Deactive" value={metrics.archived} valueColor={BRAND.textSecondary} />
        </MetricStrip>
      </div>

      {/* ── Toolbar — search · New Team · Filters · Show Fields (same as Users) */}
      <PageToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('teams.searchPlaceholder'),
          ariaLabel: t('teams.searchPlaceholder'),
          width: 224,
        }}
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={13} /> {t('teams.newTeam')}
          </Button>
        }
        activeFilterCount={activeFilterCount}
        defaultFiltersOpen={activeFilterCount > 0}
        filters={
          <div className="w-40">
            <SearchableSelect
              variant="field"
              value={statusFilter}
              ariaLabel={t('teams.filterByStatus')}
              options={[
                { value: 'all', label: t('teams.allStatuses') },
                { value: 'active', label: t('teams.statusActive') },
                { value: 'archived', label: t('teams.statusArchived') },
              ]}
              onChange={(v) => setStatusFilter(v as 'all' | 'active' | 'archived')}
            />
          </div>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* ── Table — SelectableTable + PaginationFooter (Users composition) */}
      <SelectableTable
        rows={pagedTeams}
        selection={selection}
        headerProps={table.headerProps}
        sort={sort}
        padClassName="gap-2 px-3"
        selectAllAriaLabel={t('teams.selectAll')}
        bulkActions={(sel) => (
          <BulkBarButton
            icon={<Archive size={13} />}
            label={t('teams.bulkArchive')}
            onClick={() => setArchiveTarget(sel)}
          />
        )}
        empty={
          sortedTeams.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-3 py-10 text-center text-ui-sm text-foreground-subtle">
              {search.trim() || statusFilter !== 'all' ? t('teams.emptySearch') : t('teams.empty')}
            </div>
          ) : undefined
        }
        footer={
          sortedTeams.length > 0 ? (
            <PaginationFooter
              pageSize={pageSize}
              setPageSize={setPageSize}
              currentPage={currentPage}
              rangeStart={(currentPage - 1) * pageSize + 1}
              rangeEnd={(currentPage - 1) * pageSize + pagedTeams.length}
              total={sortedTeams.length}
              pageCount={pageCount}
              hasPrevPage={currentPage > 1}
              hasNextPage={currentPage < pageCount}
              onPrevPage={goPrevPage}
              onNextPage={goNextPage}
            />
          ) : undefined
        }
        renderRow={(team, { selected, onToggleSelect }) => (
          // Plain row — the cells (Lead/Members/Projects/Status selects) are the
          // interactive surface; there is no whole-row click. The gutter selects.
          <div key={team.id} className={`${ROW_CLASS}${selected ? 'bg-accent-bg' : ''}`}>
            <RowGutter
              dragDisabled
              checkbox={{
                checked: selected,
                onChange: onToggleSelect,
                ariaLabel: t('teams.selectRow'),
              }}
            />
            {table.renderCells(team, cellCtx)}
          </div>
        )}
      />

      {showCreate && (
        <NewTeamModal workspaceId={workspaceId} onClose={() => setShowCreate(false)} />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        title={t('teams.archiveTitle', 'Archive teams')}
        message={t(
          'teams.archiveConfirm',
          'Archive the selected teams? You can restore them later.',
        )}
        confirmLabel={t('teams.bulkArchive')}
        pending={archiveTeam.isPending}
        onConfirm={() => {
          const sel = archiveTarget
          setArchiveTarget(null)
          if (sel) void archiveSelected(sel)
        }}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  )
}

// ── New Team modal (create-only; inline cells replace the edit path) ────────────

function NewTeamModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const create = useCreateTeam()
  const { data: projects = [] } = useProjects(workspaceId)
  const { data: members = [] } = useWorkspaceMembers(workspaceId)

  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TeamStatus>('active')
  const [leadId, setLeadId] = useState('')
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [memberUserIds, setMemberUserIds] = useState<string[]>([])

  // A team must link to ≥1 project (API constraint), so Projects stays required.
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
      notify.success(t('teams.teamCreated', { name: name.trim() }))
      onClose()
    } catch (err) {
      notify.fromError(err, t('teams.createFailed'))
    }
  }

  return (
    <AppModal open onClose={onClose} title={t('teams.newTeamTitle')} width={480}>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <ModalBody className="space-y-4">
          <FormField label={t('teams.teamNameLabel')} required>
            <Input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!key || key === sanitizeKey(name)) setKey(sanitizeKey(e.target.value))
              }}
              placeholder={t('teams.namePlaceholder')}
            />
          </FormField>

          <FormField label={t('teams.keyLabel')} required hint={t('teams.keyHint')}>
            <Input
              value={key}
              onChange={(e) => setKey(sanitizeKey(e.target.value))}
              placeholder={t('teams.keyPlaceholder')}
            />
          </FormField>

          <FormField label={t('teams.projectsLabel')} required hint={t('teams.projectsHint')}>
            <SearchableSelect
              variant="field"
              multiple
              value={projectIds}
              ariaLabel={t('teams.projectsLabel')}
              placeholder={t('teams.projectsPlaceholder')}
              searchPlaceholder={t('teams.searchProjects')}
              options={projectOptions}
              onChange={(ids) => setProjectIds(ids as string[])}
            />
          </FormField>

          <FormField label={t('teams.teamLeadLabel')}>
            <SearchableSelect
              variant="field"
              value={leadId}
              ariaLabel={t('teams.teamLeadLabel')}
              placeholder={t('teams.noLeadOption')}
              searchPlaceholder={t('teams.searchMembers')}
              options={[{ value: '', label: t('teams.noLeadOption') }, ...memberOptions]}
              onChange={(v) => setLeadId(v as string)}
            />
          </FormField>

          <FormField label={t('teams.membersLabel')}>
            <SearchableSelect
              variant="field"
              multiple
              value={memberUserIds}
              ariaLabel={t('teams.membersLabel')}
              placeholder={t('teams.membersPlaceholder')}
              searchPlaceholder={t('teams.searchMembers')}
              options={memberOptions}
              onChange={(ids) => setMemberUserIds(ids as string[])}
            />
          </FormField>

          <FormField label={t('teams.descriptionLabel')}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('teams.descriptionPlaceholder')}
              rows={2}
            />
          </FormField>

          <FormField label={t('teams.statusLabel')} required>
            <SearchableSelect
              variant="field"
              value={status}
              ariaLabel={t('teams.statusLabel')}
              options={[
                { value: 'active', label: t('teams.statusActive') },
                { value: 'archived', label: t('teams.statusArchived') },
              ]}
              onChange={(v) => setStatus(v as TeamStatus)}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending || !canSubmit}>
            {create.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('teams.createTeam')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}
