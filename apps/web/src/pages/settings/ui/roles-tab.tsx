import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Plus, Trash2 } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/icon-button'
import { InlineSelect } from '@/shared/ui/native-select'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { SaveCancelBar } from '@/shared/ui/save-cancel-bar'
import { EmptyState } from '@/shared/ui/empty-state'
import { Spinner } from '@/shared/ui/spinner'
import { notify } from '@/shared/lib/toast'
import type { Permission } from '@/shared/config/permissions'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { SettingsTabHeader } from './settings-tab-header'
import { CreateRoleDialog } from './role-editor-dialog'
import { useSystemRoles, type Role } from '../model/use-system-roles'
import { useDeleteRole, useUpdateRolePermissions } from '../model/use-role-mutations'
import {
  BUILTIN_ROLE_ORDER,
  CAPABILITIES,
  type CapabilityRow,
  type Cell,
  cellFor,
  codesForState,
  editableState,
  permissionsFromStates,
  statesFor,
  statesFromRole,
} from '../model/role-capabilities'

/**
 * Roles & Permissions — a capability grid.
 *
 * The 3 built-in roles (by slug) are IMMUTABLE and read-only with a lock.
 * Workspace admins create custom roles and tune them INLINE: each custom cell is
 * a Manage/View/No-access select that writes the role's full permission set back
 * (optimistic; the tooltip shows the exact codes). Every cell is DERIVED from the
 * role's real codes, so the view can never drift from enforcement.
 */
export function RolesTab() {
  const { t } = useTranslation('settings')
  const { data: roles = [], isLoading, isError } = useSystemRoles()
  const canManage = useAuthStore((s) => s.hasPermission)('roles:edit')
  const deleteRole = useDeleteRole()
  const update = useUpdateRolePermissions()

  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<Role | null>(null)
  // Buffered edits — a touched custom role's full capability-state map lives here
  // until Save; nothing persists on individual cell changes.
  const [edits, setEdits] = useState<Record<string, Record<string, Cell>>>({})
  const [saving, setSaving] = useState(false)
  const isDirty = Object.keys(edits).length > 0

  // Built-ins are the 3 canonical roles BY SLUG — a workspace may store an
  // editable copy of a tier role (isSystem=false), so slug is the reliable
  // discriminator. Everything else is a workspace custom role.
  const isBuiltin = (r: Role) => (BUILTIN_ROLE_ORDER as readonly string[]).includes(r.slug)
  const builtins = BUILTIN_ROLE_ORDER.map((slug) => roles.find((r) => r.slug === slug)).filter(
    (r): r is Role => !!r,
  )
  const customs = roles.filter((r) => !isBuiltin(r))
  const columns = [...builtins, ...customs]
  const GRID = `240px repeat(${Math.max(columns.length, 1)}, 168px)`

  const stateLabel: Record<Cell, string> = {
    full: t('roles.legendManageShort', 'Manage'),
    view: t('roles.legendView', 'View'),
    none: t('roles.legendNone', 'No access'),
  }

  // The displayed state for a cell: the pending edit if the role is being edited,
  // else the role's persisted state.
  const cellState = (role: Role, row: CapabilityRow): Cell =>
    edits[role.id]?.[row.label] ?? editableState(role, row)

  // Buffer a cell change (seed the role's full map on first touch).
  const setCell = (role: Role, row: CapabilityRow, next: Cell) => {
    setEdits((prev) => {
      const base = prev[role.id] ?? statesFromRole(role)
      return { ...prev, [role.id]: { ...base, [row.label]: next } }
    })
  }

  const cancelEdits = () => setEdits({})

  const saveEdits = async () => {
    const byId = new Map(roles.map((r) => [r.id, r]))
    setSaving(true)
    try {
      await Promise.all(
        Object.entries(edits).map(([roleId, states]) => {
          // Guard: only persist roles that still exist and are editable.
          const role = byId.get(roleId)
          if (!role || isBuiltin(role)) return Promise.resolve()
          return update.mutateAsync({
            roleId,
            permissions: permissionsFromStates(states) as Permission[],
          })
        }),
      )
      setEdits({})
      notify.success(t('roles.saved', 'Roles saved'))
    } catch (err) {
      notify.fromError(err, t('roles.saveError', 'Could not save the role'))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await deleteRole.mutateAsync(deleting.id)
      notify.success(t('roles.deleted', 'Role deleted'))
      setDeleting(null)
    } catch (err) {
      notify.fromError(err, t('roles.deleteError', 'Could not delete the role'))
    }
  }

  return (
    <>
      <SettingsTabHeader
        title={t('nav.roles')}
        description={t('roles.subtitle', 'What each role can do. Built-in roles are fixed.')}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> {t('roles.create', 'Create role')}
            </Button>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="space-y-5">

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner size="lg" />
            </div>
          ) : isError ? (
            <EmptyState title={t('roles.loadError')} />
          ) : columns.length === 0 ? (
            <EmptyState title={t('roles.empty')} />
          ) : (
            <>
              {/* Legend — spells out each level so "Manage/View" are unambiguous. */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-ui-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Dot state="full" /> {t('roles.legendManage', 'Manage — create, edit & delete')}
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot state="view" /> {t('roles.legendViewFull', 'View — read only')}
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot state="none" /> {t('roles.legendNoneFull', '— No access')}
                </span>
                <span className="text-foreground-subtle">
                  {t('roles.legendHint', 'Hover a cell to see the exact permissions.')}
                </span>
              </div>

              {/* Horizontal scroll for many roles; Capability column stays pinned. */}
              <section className="overflow-x-auto rounded border border-border-strong bg-card">
                <div className="min-w-max">
                  <div
                    className="grid border-b border-border-strong text-ui-xs font-semibold tracking-wider text-muted-foreground uppercase"
                    style={{ gridTemplateColumns: GRID }}
                  >
                    <span className="sticky left-0 z-30 bg-surface-hover px-4 py-2.5">
                      {t('roles.capabilityCol', 'Capability')}
                    </span>
                    {columns.map((r) => (
                      <span
                        key={r.id}
                        className="flex items-center justify-center gap-1 bg-surface-hover px-2 py-2.5"
                      >
                        <span className="min-w-0 truncate normal-case">{r.name}</span>
                        {isBuiltin(r) ? (
                          <Lock
                            className="h-3 w-3 shrink-0 text-foreground-subtle"
                            aria-label={t('roles.builtIn', 'Built-in')}
                          />
                        ) : canManage ? (
                          <IconButton
                            aria-label={t('roles.delete', 'Delete role')}
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </IconButton>
                        ) : null}
                      </span>
                    ))}
                  </div>

                  {CAPABILITIES.map((grp) => (
                    <div key={grp.group}>
                      <div className="sticky left-0 z-20 border-b border-border-inner bg-background/95 px-4 py-1.5 text-ui-xs font-semibold tracking-wider text-foreground-subtle uppercase">
                        {t(`roles.group.${grp.group}`, grp.group)}
                      </div>
                      {grp.rows.map((row) => (
                        <div
                          key={row.label}
                          className="grid items-center border-b border-border-inner text-ui-md text-foreground"
                          style={{ gridTemplateColumns: GRID }}
                        >
                          <span className="sticky left-0 z-10 bg-card px-4 py-2">
                            {t(`roles.cap.${row.label}`, row.label)}
                          </span>
                          {columns.map((r) =>
                            isBuiltin(r) || !canManage ? (
                              <span key={r.id} className="flex justify-center px-2 py-2">
                                <CellBadge role={r} row={row} t={t} />
                              </span>
                            ) : (
                              <span key={r.id} className="px-2 py-1.5">
                                <InlineSelect
                                  aria-label={`${r.name} · ${t(`roles.cap.${row.label}`, row.label)}`}
                                  value={cellState(r, row)}
                                  onChange={(e) => setCell(r, row, e.target.value as Cell)}
                                >
                                  {statesFor(row).map((opt) => (
                                    <option key={opt} value={opt}>
                                      {stateLabel[opt]}
                                    </option>
                                  ))}
                                </InlineSelect>
                              </span>
                            ),
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>

              <p className="text-ui-sm text-foreground-subtle">
                {t(
                  'roles.viewerFooter',
                  'Personal settings (profile, notifications) are always available to everyone.',
                )}
              </p>
            </>
          )}
        </div>
      </div>

      <SaveCancelBar
        visible={isDirty && canManage}
        saving={saving}
        onSave={saveEdits}
        onCancel={cancelEdits}
      />

      {createOpen && (
        <CreateRoleDialog open onClose={() => setCreateOpen(false)} templates={builtins} />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t('roles.deleteTitle', 'Delete role')}
        message={t('roles.deleteConfirm', {
          defaultValue: 'Delete "{{name}}"? This cannot be undone.',
          name: deleting?.name ?? '',
        })}
        confirmLabel={t('roles.delete', 'Delete role')}
        destructive
        pending={deleteRole.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function Dot({ state }: { state: Cell }) {
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full',
        state === 'full' && 'bg-success',
        state === 'view' && 'bg-primary-light',
        state === 'none' && 'bg-border-strong',
      )}
    />
  )
}

function CellBadge({
  role,
  row,
  t,
}: {
  role: Role
  row: CapabilityRow
  t: (k: string, d: string) => string
}) {
  const state = cellFor(role, row)
  if (state === 'none') {
    return (
      <span className="text-foreground-subtle" title={t('roles.legendNone', 'No access')}>
        —
      </span>
    )
  }
  const codes = codesForState(row, state)
  const title = codes.length ? codes.join(', ') : t('roles.openView', 'Readable by any member')
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-ui-xs font-medium',
        state === 'full' && 'bg-success/12 text-success',
        state === 'view' && 'bg-primary-lighter text-primary-light',
      )}
    >
      <Dot state={state} />
      {state === 'full' ? t('roles.legendManageShort', 'Manage') : t('roles.legendView', 'View')}
    </span>
  )
}
