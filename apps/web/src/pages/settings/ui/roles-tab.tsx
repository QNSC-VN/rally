import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, Check, Lock, Save, Loader2 } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { PERMISSION } from '@/shared/config/permissions'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { Spinner } from '@/shared/ui/spinner'
import { useSystemRoles, type Role } from '../model/use-system-roles'

/** Turn `workspace_admin` / `workspace.manage_members` into `Workspace Admin`. */
function humanizeSlug(value: string): string {
  return value.replace(/[._:]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** A single assignable permission with its scope tier. */
type CatalogPermission = { code: string; tier: 'workspace' | 'project' }

/** A workspace-custom role can be edited; built-in/global roles are read-only. */
function isRoleEditable(role: Role): boolean {
  return !role.isSystem && role.workspaceId !== null
}

export function RolesTab() {
  const { t } = useTranslation('settings')
  const qc = useQueryClient()
  const { hasPermission } = useAuthStore()
  const canManage = hasPermission(PERMISSION.WORKSPACE_MANAGE_MEMBERS)

  const { data: roles = [], isLoading, isError } = useSystemRoles()

  // The assignable-permission catalogue is the single source of truth for the
  // editable matrix; only workspace admins may fetch or act on it.
  const { data: catalog = [] } = useQuery({
    queryKey: ['permission-catalog'],
    enabled: canManage,
    queryFn: async () => {
      const res = await apiClient.GET('/v1/permissions')
      return (res.data?.permissions ?? []) as CatalogPermission[]
    },
  })

  const updatePermissions = useMutation({
    mutationFn: async (vars: { roleId: string; permissions: string[] }) => {
      const res = await apiClient.PATCH('/v1/roles/{roleId}/permissions', {
        params: { path: { roleId: vars.roleId } },
        body: { permissions: vars.permissions } as never,
      })
      if (res.error) throw new Error(apiErrorMessage(res.error))
      return res.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['system-roles'] })
      notify.success(t('roles.permissionsUpdated'))
    },
    onError: (err) => notify.fromError(err, t('roles.updateFailed')),
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  if (isError) {
    return <EmptyState title={t('roles.loadError')} />
  }

  if (roles.length === 0) {
    return <EmptyState title={t('roles.empty')} />
  }

  const editable = selected != null && canManage && isRoleEditable(selected)

  return (
    <div className="flex gap-6">
      {/* ── Role list ── */}
      <div className="w-64 shrink-0 space-y-1">
        <p className="mb-2 text-ui-xs font-semibold tracking-widest text-foreground-subtle uppercase">
          {t('roles.listTitle')}
        </p>
        {roles.map((r) => {
          const isActive = selected?.id === r.id
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={cn(
                'w-full rounded border px-3 py-2 text-left',
                isActive ? 'border-border bg-surface-hover' : 'border-transparent',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-ui-md font-semibold text-foreground">
                  {humanizeSlug(r.name)}
                </span>
                {r.isSystem && (
                  <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-ui-2xs font-medium tracking-wide text-foreground-subtle uppercase">
                    {t('roles.systemBadge')}
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-ui-xs text-foreground-subtle">{r.slug}</p>
            </button>
          )
        })}
      </div>

      {/* ── Permissions for the selected role ── */}
      <div className="min-w-0 flex-1">
        {selected && (
          <>
            <div className="mb-4 flex items-center gap-2">
              <Shield size={15} className="text-muted-foreground" />
              <h3 className="text-ui-xl font-semibold text-foreground">
                {humanizeSlug(selected.name)}
              </h3>
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-ui-xs font-medium text-muted-foreground">
                {t('roles.permissionCountBadge', { count: selected.permissions.length })}
              </span>
            </div>

            {selected.description && (
              <p className="mb-5 text-ui-md text-muted-foreground">{selected.description}</p>
            )}

            {/* Every role renders the same full permission grid; protected roles
                (Workspace Admin) are simply shown read-only. This keeps the view
                consistent instead of a separate chip layout for system roles. */}
            <RolePermissionEditor
              key={selected.id}
              role={selected}
              catalog={catalog}
              saving={updatePermissions.isPending}
              readOnly={!editable}
              onSave={(permissions) =>
                updatePermissions.mutate({ roleId: selected.id, permissions })
              }
            />

            {!editable && !canManage && (
              <p className="mt-3 text-ui-sm text-foreground-subtle">{t('roles.needPermission')}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Editable permission matrix for a custom role. Draft state is keyed on the
 * role id (via the parent `key`) so switching roles resets cleanly. Codes the
 * role holds that are not in the catalogue (e.g. a wildcard) are preserved on
 * save rather than silently dropped.
 */
function RolePermissionEditor({
  role,
  catalog,
  saving,
  onSave,
  readOnly = false,
}: {
  role: Role
  catalog: CatalogPermission[]
  saving: boolean
  onSave: (permissions: string[]) => void
  readOnly?: boolean
}) {
  const { t } = useTranslation('settings')
  const initial = new Set(role.permissions)
  const [draft, setDraft] = useState<Set<string>>(() => new Set(role.permissions))

  const catalogCodes = new Set(catalog.map((c) => c.code))
  // Codes held by the role but absent from the catalogue (e.g. wildcards) are
  // not rendered as toggles, but must survive a save.
  const preserved = [...initial].filter((code) => !catalogCodes.has(code))

  const groups = new Map<string, CatalogPermission[]>()
  for (const perm of catalog) {
    const namespace = perm.code.split(':')[0]
    const list = groups.get(namespace) ?? []
    list.push(perm)
    groups.set(namespace, list)
  }

  const dirty = draft.size !== initial.size || [...draft].some((code) => !initial.has(code))

  function toggle(code: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function handleSave() {
    const selectedCatalog = [...draft].filter((code) => catalogCodes.has(code))
    onSave([...new Set([...preserved, ...selectedCatalog])].sort())
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([namespace, perms]) => (
        <div key={namespace}>
          <p className="mb-1.5 text-ui-sm font-semibold text-foreground">
            {humanizeSlug(namespace)}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {perms.map((perm) => {
              const checked = draft.has(perm.code)
              const action = perm.code.split(':')[1] ?? perm.code
              return (
                <button
                  key={perm.code}
                  type="button"
                  onClick={() => !readOnly && toggle(perm.code)}
                  disabled={readOnly}
                  aria-pressed={checked}
                  className={cn(
                    'flex items-center gap-2 rounded border px-2 py-1.5 text-left',
                    checked ? 'bg-surface-hover' : '',
                    readOnly ? 'cursor-default' : 'cursor-pointer',
                    readOnly && !checked ? 'opacity-55' : '',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked ? 'border-primary bg-primary' : 'border-border',
                    )}
                  >
                    {checked && <Check size={11} className="text-primary-foreground" />}
                  </span>
                  <span className="font-mono text-ui-sm text-muted-foreground">{action}</span>
                  <span className="ml-auto text-ui-2xs tracking-wide text-foreground-subtle uppercase">
                    {perm.tier}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between border-t pt-3">
        <p className="text-ui-sm text-foreground-subtle">
          {readOnly
            ? t('roles.count', { count: draft.size })
            : t('roles.selectedCount', { count: draft.size })}
        </p>
        {readOnly ? (
          <div className="flex items-center gap-1.5">
            <Lock size={11} className="text-foreground-subtle" />
            <p className="text-ui-sm text-foreground-subtle">{t('roles.protectedRole')}</p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft(new Set(role.permissions))}
              disabled={!dirty || saving}
            >
              {t('roles.reset')}
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {t('saveChanges')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
