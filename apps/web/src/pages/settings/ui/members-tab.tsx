import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { SettingsTabHeader } from './settings-tab-header'
import { useForm, Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Loader2, Mail, Send, UserPlus, UserX, X } from 'lucide-react'
import { BulkBarButton } from '@/shared/ui/bulk-action-bar'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

import { BRAND } from '@/shared/config/brand'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import {
  useWorkspaceMembers,
  useUpdateMember,
  type WorkspaceMember,
} from '@/features/workspaces/api'
import { notify } from '@/shared/lib/toast'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { StatusBadge } from '@/shared/ui/status-badge'
import type { StatusStyle } from '@/shared/config/status-colors'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
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
import { useSystemRoles } from '../model/use-system-roles'

type InviteForm = { email: string; roleId: string }
type MemberStatus = 'active' | 'suspended' | 'removed'

/** Best-available display label for a member (typed-confirmation copy). */
function memberName(m: WorkspaceMember): string {
  return m.displayName ?? m.email ?? m.userId
}

interface SelectOption {
  value: string
  label: string
  searchText?: string
  icon?: ReactNode
}

// ── Config-driven column catalog (rendered by the shared table engine) ─────────
// Per-render context carrying the values the cells need (current-user marker +
// resolved i18n strings + inline-edit commit callbacks) without pulling hooks
// into module scope. Users adopts the app's inline-edit paradigm: Role, Status
// and Teams are edited directly in their cells (no per-row modal).
interface MemberCtx {
  currentUserId: string | undefined
  youLabel: string
  neverLabel: string
  roleOptions: SelectOption[]
  statusOptions: SelectOption[]
  labels: {
    role: string
    rolePlaceholder: string
    status: string
  }
  commitRole: (member: WorkspaceMember, roleId: string) => void
  commitStatus: (member: WorkspaceMember, status: MemberStatus) => void
}

type MemberColKey = 'user' | 'email' | 'role' | 'status' | 'lastLogin'

const MEMBER_COLUMNS: ColumnSpec<WorkspaceMember, MemberCtx, MemberColKey>[] = [
  {
    key: 'user',
    label: 'User',
    sortCol: 'user',
    defaultWidth: 260,
    minWidth: 180,
    locked: true,
    grow: true,
    cellClassName: 'flex min-w-0 items-center gap-2',
    // Read-only PRIMARY identity cell: avatar + name at text-ui-md — matches the
    // Teams grid's Team-name column exactly (OwnerCell is the smaller secondary
    // treatment used for attribute columns like Owner/Lead). Name/avatar are
    // IdP/Profile-owned (not editable here); only Role/Status/Teams are editable.
    cell: (m, ctx) => (
      <>
        <OwnerAvatar name={m.displayName ?? undefined} />
        <span className="truncate text-ui-md text-foreground" title={m.displayName ?? undefined}>
          {m.displayName ?? '--'}
        </span>
        {m.userId === ctx.currentUserId && (
          <span className="shrink-0 rounded bg-primary-lighter px-1 py-0.5 text-ui-xs text-primary">
            {ctx.youLabel}
          </span>
        )}
      </>
    ),
  },
  {
    key: 'email',
    label: 'Email',
    sortCol: 'email',
    defaultWidth: 220,
    minWidth: 140,
    cellClassName: 'flex min-w-0 items-center',
    cell: (m) => (
      <span
        className="text-ui-md break-words whitespace-normal text-muted-foreground"
        title={m.email ?? ''}
      >
        {m.email ?? '--'}
      </span>
    ),
  },
  {
    key: 'role',
    label: 'Role',
    sortCol: 'role',
    defaultWidth: 150,
    minWidth: 100,
    cellClassName: 'flex min-w-0 items-center',
    // Inline role picker — commits a role-assignment change (delete + recreate).
    // Workspace Admin accounts are guarded (P4-SET-07): their role/status/teams
    // are read-only in this grid, so an admin can't casually demote or lock out
    // another workspace owner from the roster.
    cell: (m, ctx) => (
      <div className="min-w-0 flex-1">
        <SearchableSelect
          variant="cell"
          value={m.roleId ?? ''}
          readOnly={m.roleSlug === 'workspace_admin'}
          options={ctx.roleOptions}
          ariaLabel={ctx.labels.role}
          placeholder={ctx.labels.rolePlaceholder}
          onChange={(v) => ctx.commitRole(m, v as string)}
        />
      </div>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    sortCol: 'status',
    defaultWidth: 120,
    minWidth: 90,
    cellClassName: 'flex min-w-0 items-center',
    // Inline status picker — readOnly on your own row (can't change own status).
    cell: (m, ctx) => (
      <div className="min-w-0 flex-1">
        <SearchableSelect
          variant="cell"
          value={m.status}
          readOnly={m.userId === ctx.currentUserId || m.roleSlug === 'workspace_admin'}
          options={ctx.statusOptions}
          ariaLabel={ctx.labels.status}
          onChange={(v) => ctx.commitStatus(m, v as MemberStatus)}
        />
      </div>
    ),
  },
  {
    key: 'lastLogin',
    label: 'Last Login',
    sortCol: 'lastLogin',
    defaultWidth: 150,
    minWidth: 110,
    cellClassName: 'flex items-center',
    cell: (m, ctx) => (
      <span className="truncate text-ui-md text-foreground-subtle">
        {formatDateIso(m.lastLoginAt, ctx.neverLabel)}
      </span>
    ),
  },
]

// Match the iteration-status row look exactly (white rows, subtle divider) so
// the Users grid reads the same as the rest of the app. Rows are not clickable —
// the cells are the interactive surface (inline edit) — so no cursor-pointer.
const ROW_CLASS =
  'group flex min-h-[34px] items-center gap-2 border-b border-border-subtle bg-card px-3 text-ui-md transition-colors duration-100 hover:bg-primary-lighter'

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

/** Client-side sort over the (small, fully-loaded) member roster. */
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

export function MembersTab() {
  const { t } = useTranslation('settings')
  const { user } = useAuthStore()
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('') // '' = all
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')

  const { data: members = [], isLoading: membersLoading } = useWorkspaceMembers(workspaceId)
  const { data: roles = [] } = useSystemRoles()

  const { data: invitations = [] } = useQuery({
    queryKey: ['workspace-invitations', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return []
      const res = await apiClient.GET('/v1/workspaces/{id}/invitations', {
        params: { path: { id: workspaceId } },
      })
      return (res.data ?? []).filter((i: { status: string }) => i.status === 'pending')
    },
    enabled: !!workspaceId,
  })

  const cancelInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      if (!workspaceId) return
      await apiClient.DELETE('/v1/workspaces/{id}/invitations/{invitationId}', {
        params: { path: { id: workspaceId, invitationId } },
      })
    },
    onSuccess: () => notify.success(t('members.inviteCancelled')),
    onError: (err) => notify.error(apiErrorMessage(err)),
    meta: { invalidates: ['workspace'] },
  })

  const resendInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      if (!workspaceId) return
      const { error, response } = await apiClient.POST(
        '/v1/workspaces/{id}/invitations/{invitationId}/resend',
        { params: { path: { id: workspaceId, invitationId } } },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => notify.success(t('members.inviteResent')),
    onError: (err) => notify.error(apiErrorMessage(err)),
    meta: { invalidates: ['workspace'] },
  })

  const metrics = useMemo(() => {
    const active = members.filter((m) => m.status === 'active').length
    const admins = members.filter((m) => m.roleSlug === 'workspace_admin').length
    return { total: members.length, active, admins }
  }, [members])

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (roleFilter && m.roleId !== roleFilter) return false
      if (!q) return true
      return (
        m.displayName?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.roleName?.toLowerCase().includes(q)
      )
    })
  }, [members, search, roleFilter, statusFilter])

  // Shared table engine (resize / reorder / Show-Fields) + click-to-sort header.
  const { sortCol, sortDir, sort } = useColumnSort()
  const table = useDataTable<WorkspaceMember, MemberCtx, MemberColKey>(MEMBER_COLUMNS, {
    storageKey: STORAGE_KEYS.SETTINGS_USERS_COLUMNS,
  })
  // Shared member mutation — drives inline Teams/Status edits + the bulk deactivate.
  const bulkUpdate = useUpdateMember(workspaceId)

  // Inline role change — a workspace role lives in a role-assignment, so a change
  // deletes the current assignment (if any) then creates the new one. Same
  // semantics the removed Edit-User modal used. Invalidates the roster AND the
  // user's effective permissions.
  const changeRole = useMutation({
    mutationFn: async ({ member, roleId }: { member: WorkspaceMember; roleId: string }) => {
      if (member.roleAssignmentId) {
        await apiClient.DELETE('/v1/role-assignments/{id}', {
          params: { path: { id: member.roleAssignmentId } },
        })
      }
      await apiClient.POST('/v1/role-assignments', {
        body: { userId: member.userId, roleId, scopeType: 'workspace' },
      })
    },
    onSuccess: () => notify.success(t('members.roleUpdated')),
    onError: (err) => notify.fromError(err, t('members.roleUpdateError')),
    meta: { invalidates: ['workspace', 'access'] },
  })
  const commitRole = useCallback(
    (member: WorkspaceMember, roleId: string) => {
      if (!roleId || roleId === (member.roleId ?? '')) return
      changeRole.mutate({ member, roleId })
    },
    [changeRole],
  )
  // Holds the member + status pending a destructive confirmation (null = closed).
  const [confirmStatusTarget, setConfirmStatusTarget] = useState<{
    member: WorkspaceMember
    status: MemberStatus
  } | null>(null)
  const commitStatus = useCallback(
    (member: WorkspaceMember, status: MemberStatus) => {
      if (status === member.status) return
      // Deactivate (suspend) and Remove Access are destructive (P4-SET-07): gate
      // them behind a confirmation. Reactivation (-> active) commits directly.
      if (status === 'suspended' || status === 'removed') {
        setConfirmStatusTarget({ member, status })
        return
      }
      bulkUpdate
        .mutateAsync({ memberId: member.id, status })
        .then(() => notify.success(t('members.statusUpdated')))
        .catch((err: unknown) => notify.fromError(err, t('members.statusUpdateError')))
    },
    [bulkUpdate, t],
  )

  const sortedMembers = useMemo(
    () =>
      sortRows(filteredMembers, sortCol, sortDir, (m, col) => {
        switch (col) {
          case 'user':
            return m.displayName?.toLowerCase() ?? ''
          case 'email':
            return m.email?.toLowerCase() ?? ''
          case 'role':
            return m.roleName?.toLowerCase() ?? ''
          case 'status':
            return m.status
          case 'lastLogin':
            return m.lastLoginAt ?? ''
          default:
            return ''
        }
      }),
    [filteredMembers, sortCol, sortDir],
  )

  const roleOptions = useMemo<SelectOption[]>(
    () => roles.map((r) => ({ value: r.id, label: r.name })),
    [roles],
  )
  const statusOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'active', label: t('members.statusActive') },
      { value: 'suspended', label: t('members.statusDeactive') },
      // "Remove Access" is the permanent status='removed' transition. It is an
      // inline status value (not a row action button, per SRS §6.3) and is gated
      // by a typed confirmation (P4-SET-07) — see commitStatus / the dialog below.
      { value: 'removed', label: t('members.statusRemoved', 'Remove Access') },
    ],
    [t],
  )

  const cellCtx = useMemo<MemberCtx>(
    () => ({
      currentUserId: user?.id,
      youLabel: t('members.you'),
      neverLabel: t('members.never'),
      roleOptions,
      statusOptions,
      labels: {
        role: t('members.editRole'),
        rolePlaceholder: t('members.selectRoleOption'),
        status: t('members.editStatus'),
      },
      commitRole,
      commitStatus,
    }),
    [user?.id, t, roleOptions, statusOptions, commitRole, commitStatus],
  )

  const activeFilterCount = (roleFilter ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)

  // ── Client-side pagination over the filtered/sorted roster ──────────────
  // Mirrors the Iteration Status page: paginate the already-loaded rows in the
  // client and drive the shared PaginationFooter (Page N of M, total count).
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(sortedMembers.length / pageSize))
  // Snap back to the first page whenever the view identity changes.
  const pageResetKey = `${search}|${roleFilter}|${statusFilter}|${sortCol ?? ''}|${sortDir}|${pageSize}`
  const [syncedPageKey, setSyncedPageKey] = useState(pageResetKey)
  if (syncedPageKey !== pageResetKey) {
    setSyncedPageKey(pageResetKey)
    setPage(1)
  }
  const currentPage = Math.min(page, pageCount)
  const pagedMembers = useMemo(
    () => sortedMembers.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedMembers, currentPage, pageSize],
  )
  const goPrevPage = useCallback(() => setPage((p) => Math.max(1, p - 1)), [])
  const goNextPage = useCallback(() => setPage((p) => p + 1), [])

  // Row selection over the full filtered roster (bulk actions span pages).
  const selection = useRowSelection(sortedMembers)
  // Holds the selection pending a deactivate confirmation (null = dialog closed).
  const [confirmDeactivate, setConfirmDeactivate] = useState<RowSelection | null>(null)

  // Bulk action over selected rows — deactivate active members (never the
  // current user). Mirrors the per-user status change in the edit modal.
  async function deactivateSelected(sel: RowSelection) {
    const targets = members.filter(
      (m) => sel.selectedIds.has(m.id) && m.status === 'active' && m.userId !== user?.id,
    )
    if (targets.length === 0) {
      sel.clear()
      return
    }
    try {
      await Promise.all(
        targets.map((m) => bulkUpdate.mutateAsync({ memberId: m.id, status: 'suspended' })),
      )
      notify.success(t('members.bulkDeactivated', { count: targets.length }))
    } catch (err) {
      notify.fromError(err, t('members.bulkDeactivateError'))
    } finally {
      sel.clear()
    }
  }

  if (!workspaceId) {
    return <p className="text-ui-lg text-foreground-subtle">{t('members.noWorkspace')}</p>
  }

  if (membersLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-foreground-subtle">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-ui-lg">{t('members.loading')}</span>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SettingsTabHeader title={t('nav.members')} description={t('tabDescriptions.members')} />
      {/* Metric strip + pending invitations render above the toolbar. */}
      <div className="flex shrink-0 flex-col gap-4 px-4 pt-4">
        {/* Metric strip — Total / Active / Admins (SRS §6.1) */}
        <MetricStrip className="rounded-lg border">
          <MetricCard label="Total Users" value={metrics.total} />
          <MetricCard label="Active" value={metrics.active} valueColor={BRAND.success} />
          <MetricCard label="Admins" value={metrics.admins} />
        </MetricStrip>

        {/* Pending invitations — a compact section above the sortable table.
            Height-capped with its own scroll so a long backlog of pending
            invites never pushes the members table off-screen. */}
        {invitations.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-ui-sm font-semibold tracking-wide text-foreground-subtle uppercase">
              {t('members.pendingInvitations')} ({invitations.length})
            </h3>
            <div className="max-h-56 overflow-y-auto rounded-lg border">
              {invitations.map((inv: { id: string; email: string; roleId: string | null }) => {
                const roleLabel = roles.find((r) => r.id === inv.roleId)?.name ?? '--'
                return (
                  <div
                    key={`inv-${inv.id}`}
                    className="flex items-center gap-3 border-t px-4 py-2 first:border-t-0"
                  >
                    <Mail size={16} className="shrink-0 text-foreground-subtle" />
                    <span className="min-w-0 flex-1 truncate text-ui-md text-foreground-subtle">
                      {inv.email}
                    </span>
                    <span className="shrink-0 text-ui-md text-muted-foreground">{roleLabel}</span>
                    <MemberStatusBadge status="invited" />
                    <IconButton
                      size="sm"
                      aria-label={t('members.resendInvitation')}
                      title={t('members.resendInvitation')}
                      onClick={() => resendInvite.mutate(inv.id)}
                      disabled={resendInvite.isPending}
                    >
                      <Send size={13} className={resendInvite.isPending ? 'animate-pulse' : ''} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      aria-label={t('members.cancelInvitation')}
                      title={t('members.cancelInvitation')}
                      onClick={() => cancelInvite.mutate(inv.id)}
                      disabled={cancelInvite.isPending}
                    >
                      <X size={13} />
                    </IconButton>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Toolbar — search · Invite · Filters · Show Fields (same as Iteration Status) */}
      <PageToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('members.searchPlaceholder'),
          ariaLabel: t('members.searchPlaceholder'),
          width: 224,
        }}
        actions={
          <Button size="sm" onClick={() => setShowInviteModal(true)}>
            <UserPlus size={13} /> {t('members.invite')}
          </Button>
        }
        activeFilterCount={activeFilterCount}
        defaultFiltersOpen={activeFilterCount > 0}
        filters={
          <>
            <div className="w-48">
              <SearchableSelect
                variant="field"
                value={roleFilter}
                ariaLabel={t('members.filterByRole')}
                placeholder={t('members.allRoles')}
                options={[
                  { value: '', label: t('members.allRoles') },
                  ...roles.map((r) => ({ value: r.id, label: r.name })),
                ]}
                onChange={(v) => setRoleFilter(v as string)}
              />
            </div>
            <div className="w-40">
              <SearchableSelect
                variant="field"
                value={statusFilter}
                ariaLabel={t('members.filterByStatus')}
                options={[
                  { value: 'all', label: t('members.allStatuses') },
                  { value: 'active', label: t('members.statusActive') },
                  { value: 'suspended', label: t('members.statusDeactive') },
                ]}
                onChange={(v) => setStatusFilter(v as 'all' | 'active' | 'suspended')}
              />
            </div>
          </>
        }
        fields={<ColumnFieldsMenu {...table.fieldsMenuProps} />}
      />

      {/* ── Table — SelectableTable + PaginationFooter (Iteration Status composition) */}
      <SelectableTable
        rows={pagedMembers}
        selection={selection}
        headerProps={table.headerProps}
        sort={sort}
        padClassName="gap-2 px-3"
        selectAllAriaLabel={t('members.selectAll')}
        bulkActions={(sel) => (
          <BulkBarButton
            icon={<UserX size={13} />}
            label={t('members.bulkDeactivate')}
            onClick={() => setConfirmDeactivate(sel)}
          />
        )}
        empty={
          sortedMembers.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-3 py-10 text-center text-ui-sm text-foreground-subtle">
              {search.trim() || roleFilter || statusFilter !== 'all'
                ? t('members.noMembersSearch')
                : t('members.noMembers')}
            </div>
          ) : undefined
        }
        footer={
          sortedMembers.length > 0 ? (
            <PaginationFooter
              pageSize={pageSize}
              setPageSize={setPageSize}
              currentPage={currentPage}
              rangeStart={(currentPage - 1) * pageSize + 1}
              rangeEnd={(currentPage - 1) * pageSize + pagedMembers.length}
              total={sortedMembers.length}
              pageCount={pageCount}
              hasPrevPage={currentPage > 1}
              hasNextPage={currentPage < pageCount}
              onPrevPage={goPrevPage}
              onNextPage={goNextPage}
            />
          ) : undefined
        }
        renderRow={(m, { selected, onToggleSelect }) => (
          // Plain row — the cells (Role/Status/Teams selects) are the interactive
          // surface; there is no whole-row click. The gutter checkbox selects.
          <div
            key={m.id}
            className={`${ROW_CLASS}${selected ? 'bg-accent-bg' : ''}`}
            style={{ minWidth: 'max-content' }}
          >
            <RowGutter
              dragDisabled
              checkbox={{
                checked: selected,
                onChange: onToggleSelect,
                ariaLabel: t('members.selectRow'),
              }}
            />
            {table.renderCells(m, cellCtx)}
          </div>
        )}
      />

      {showInviteModal && (
        <InviteUserModal
          workspaceId={workspaceId}
          roles={roles}
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => setShowInviteModal(false)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDeactivate}
        title={t('members.deactivateTitle', 'Deactivate members')}
        message={t(
          'members.deactivateConfirm',
          'Deactivate the selected members? They lose access until reactivated.',
        )}
        confirmLabel={t('members.bulkDeactivate')}
        destructive
        pending={bulkUpdate.isPending}
        onConfirm={() => {
          const sel = confirmDeactivate
          setConfirmDeactivate(null)
          if (sel) void deactivateSelected(sel)
        }}
        onCancel={() => setConfirmDeactivate(null)}
      />

      {/* Per-row destructive confirmation. Remove Access is high-risk, so it uses
          typed confirmation (type the user's name, per P4-SET-07); Deactivate
          uses a plain modal. Reactivation never reaches this dialog. */}
      <ConfirmDialog
        open={!!confirmStatusTarget}
        title={
          confirmStatusTarget?.status === 'removed'
            ? t('members.removeAccessTitle', 'Remove user access')
            : t('members.deactivateOneTitle', 'Deactivate user')
        }
        message={
          confirmStatusTarget
            ? confirmStatusTarget.status === 'removed'
              ? t('members.removeAccessConfirm', {
                  name: memberName(confirmStatusTarget.member),
                  defaultValue: 'Permanently remove access for "{{name}}". They lose all workspace access.',
                })
              : t('members.deactivateOneConfirm', {
                  name: memberName(confirmStatusTarget.member),
                  defaultValue: 'Deactivate "{{name}}"? They lose access until reactivated.',
                })
            : undefined
        }
        confirmText={
          confirmStatusTarget && confirmStatusTarget.status === 'removed'
            ? memberName(confirmStatusTarget.member)
            : undefined
        }
        confirmLabel={
          confirmStatusTarget?.status === 'removed'
            ? t('members.statusRemoved', 'Remove Access')
            : t('members.statusDeactive')
        }
        destructive
        pending={bulkUpdate.isPending}
        onConfirm={() => {
          const target = confirmStatusTarget
          setConfirmStatusTarget(null)
          if (!target) return
          bulkUpdate
            .mutateAsync({ memberId: target.member.id, status: target.status })
            .then(() => notify.success(t('members.statusUpdated')))
            .catch((err: unknown) => notify.fromError(err, t('members.statusUpdateError')))
        }}
        onCancel={() => setConfirmStatusTarget(null)}
      />
    </div>
  )
}

// ── Member status badge ───────────────────────────────────────────────────────

function MemberStatusBadge({ status }: { status: string }) {
  const map: Record<string, StatusStyle> = {
    active: {
      label: 'Active',
      text: BRAND.success,
      bg: BRAND.successBg,
      border: BRAND.successBorder,
    },
    invited: {
      label: 'Invited',
      text: BRAND.warning,
      bg: BRAND.warningBg,
      border: BRAND.warningBorder,
    },
    suspended: {
      label: 'Deactive',
      text: BRAND.textSecondary,
      bg: BRAND.surfaceSubtle,
      border: BRAND.border,
    },
  }
  const style = map[status] ?? {
    label: status,
    text: BRAND.textMuted,
    bg: BRAND.surfaceSubtle,
    border: BRAND.border,
  }
  return <StatusBadge style={style} />
}

// ── Invite user modal (email + role; rich invite deferred per SRS §6.4) ─────────

function InviteUserModal({
  workspaceId,
  roles,
  onClose,
  onSuccess,
}: {
  workspaceId: string
  roles: { id: string; name: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation('settings')
  const inviteSchema = z.object({
    email: z.string().email(t('members.invalidEmail')),
    roleId: z.string().min(1, t('members.selectRoleError')),
  })
  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', roleId: '' },
  })

  const invite = useMutation({
    mutationFn: async (data: InviteForm) => {
      const { error, response } = await apiClient.POST('/v1/workspaces/{id}/invitations', {
        params: { path: { id: workspaceId } },
        body: { email: data.email, roleId: data.roleId },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      notify.success(t('members.inviteSent'))
      onSuccess()
    },
    onError: (err: Error) => {
      form.setError('root', { message: err.message })
    },
    meta: { invalidates: ['workspace'] },
  })

  return (
    <AppModal open onClose={onClose} title={t('members.invitePanelTitle')} width={460}>
      <form onSubmit={form.handleSubmit((d) => invite.mutate(d))}>
        <ModalBody className="space-y-4">
          <FormField
            label={t('members.emailFieldLabel')}
            required
            error={form.formState.errors.email?.message}
          >
            <Input
              {...form.register('email')}
              type="email"
              autoFocus
              placeholder="colleague@company.com"
            />
          </FormField>
          <FormField
            label={t('members.roleFieldLabel')}
            required
            error={form.formState.errors.roleId?.message}
          >
            <Controller
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <SearchableSelect
                  variant="field"
                  value={field.value ?? ''}
                  ariaLabel={t('members.roleFieldLabel')}
                  placeholder={t('members.selectRoleOption')}
                  options={[
                    { value: '', label: t('members.selectRoleOption') },
                    ...roles.map((r) => ({ value: r.id, label: r.name })),
                  ]}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>
          {form.formState.errors.root && (
            <p role="alert" className="text-ui-md text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            {t('members.sendInvite')}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  )
}
