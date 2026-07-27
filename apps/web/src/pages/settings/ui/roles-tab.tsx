import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/utils'
import { EmptyState } from '@/shared/ui/empty-state'
import { Spinner } from '@/shared/ui/spinner'
import { SettingsTabHeader } from './settings-tab-header'
import { useSystemRoles, type Role } from '../model/use-system-roles'

/**
 * Roles & Permissions — a READ-ONLY capability viewer.
 *
 * The product ships three fixed canonical roles; what each can do is defined by
 * the code catalogue, not edited per company. So this screen is a transparency
 * grid ("what can each role do") in plain product language — NOT an editable
 * permission checklist. Every cell is DERIVED from the role's actual permission
 * codes, so the view can never drift from enforcement.
 *
 *   Full = can do it · View = read only · — = no access
 */

type Cell = 'full' | 'view' | 'none'

/** One human capability row → the permission code(s) that back it. */
interface CapabilityRow {
  label: string
  /** Holding this code (or its namespace / `workspace:*` wildcard) ⇒ Full. */
  manage?: string
  /** Holding this ⇒ at least View. */
  view?: string
  /** Reads are open to any member (no gate) ⇒ everyone gets at least View. */
  openView?: boolean
}
interface CapabilityGroup {
  group: string
  rows: CapabilityRow[]
}

const CAPABILITIES: CapabilityGroup[] = [
  {
    group: 'Company',
    rows: [
      { label: 'Company settings', view: 'workspace:view', manage: 'workspace:edit' },
      { label: 'People & invitations', manage: 'users:invite' },
      { label: 'Roles & permissions', view: 'roles:view', manage: 'roles:edit' },
      { label: 'Teams', manage: 'teams:create', openView: true },
      { label: 'Integrations (source control)', manage: 'scm:manage' },
      { label: 'Audit log', view: 'audit:view' },
    ],
  },
  {
    group: 'Projects',
    rows: [
      { label: 'Project settings', view: 'project:view', manage: 'project:edit' },
      { label: 'Create · archive · delete project', manage: 'project:create' },
      { label: 'Project members', manage: 'project:manage_members' },
    ],
  },
  {
    group: 'Delivery',
    rows: [
      { label: 'Backlog & work items', view: 'work_item:view', manage: 'work_item:create' },
      { label: 'Sprints', view: 'iteration:view', manage: 'iteration:create' },
      { label: 'Releases', view: 'release:view', manage: 'release:create' },
      { label: 'Milestones', view: 'milestone:view', manage: 'milestone:create' },
      { label: 'Team capacity', view: 'team_status:view', manage: 'team_status:edit' },
      { label: 'Quality dashboard', view: 'quality:view' },
    ],
  },
]

/** The three canonical roles, in display order. */
const ROLE_ORDER = ['workspace_admin', 'project_admin', 'project_member'] as const

function holds(role: Role, code: string): boolean {
  if (role.permissions.includes('workspace:*') || role.permissions.includes(code)) return true
  const ns = code.split(':')[0]
  return !!ns && role.permissions.includes(`${ns}:*`)
}

function cellFor(role: Role, row: CapabilityRow): Cell {
  if (row.manage && holds(role, row.manage)) return 'full'
  if (row.view && holds(role, row.view)) return 'view'
  if (row.openView) return 'view'
  return 'none'
}

export function RolesTab() {
  const { t } = useTranslation('settings')
  const { data: roles = [], isLoading, isError } = useSystemRoles()

  // One column per canonical role (dedupe global template vs workspace copy).
  const columns = ROLE_ORDER.map((slug) => roles.find((r) => r.slug === slug)).filter(
    (r): r is Role => !!r,
  )
  const GRID = `minmax(220px,1fr) repeat(${Math.max(columns.length, 1)}, 130px)`

  return (
    <>
      <SettingsTabHeader
        title={t('nav.roles')}
        description={t('roles.viewerSubtitle', 'What each role can do. Roles are fixed.')}
      />
      <div className="flex-1 overflow-y-auto bg-background px-8 py-6">
        <div className="max-w-3xl space-y-5">
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
              {/* Legend */}
              <div className="flex items-center gap-4 text-ui-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Dot state="full" /> {t('roles.legendFull', 'Full')}
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot state="view" /> {t('roles.legendView', 'View')}
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot state="none" /> {t('roles.legendNone', 'No access')}
                </span>
              </div>

              <section className="overflow-hidden rounded border border-border-strong bg-card">
                {/* Header */}
                <div
                  className="grid border-b border-border-strong bg-surface-hover px-4 py-2.5 text-ui-xs font-semibold tracking-wider text-muted-foreground uppercase"
                  style={{ gridTemplateColumns: GRID }}
                >
                  <span>{t('roles.capabilityCol', 'Capability')}</span>
                  {columns.map((r) => (
                    <span key={r.id} className="text-center">
                      {r.name}
                    </span>
                  ))}
                </div>

                {CAPABILITIES.map((grp) => (
                  <div key={grp.group}>
                    <div className="border-b border-border-inner bg-background/40 px-4 py-1.5 text-ui-xs font-semibold tracking-wider text-foreground-subtle uppercase">
                      {t(`roles.group.${grp.group}`, grp.group)}
                    </div>
                    {grp.rows.map((row) => (
                      <div
                        key={row.label}
                        className="grid items-center border-b border-border-inner px-4 py-2 text-ui-md text-foreground"
                        style={{ gridTemplateColumns: GRID }}
                      >
                        <span>{t(`roles.cap.${row.label}`, row.label)}</span>
                        {columns.map((r) => (
                          <span key={r.id} className="flex justify-center">
                            <CellBadge state={cellFor(r, row)} t={t} />
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
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

function CellBadge({ state, t }: { state: Cell; t: (k: string, d: string) => string }) {
  if (state === 'none') return <span className="text-foreground-subtle">—</span>
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-ui-xs font-medium',
        state === 'full' && 'bg-success/12 text-success',
        state === 'view' && 'bg-primary-lighter text-primary-light',
      )}
    >
      <Dot state={state} />
      {state === 'full' ? t('roles.legendFull', 'Full') : t('roles.legendView', 'View')}
    </span>
  )
}
