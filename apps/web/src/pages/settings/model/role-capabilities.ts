import type { Role } from './use-system-roles'

/**
 * The capability model shared by the Roles & Permissions viewer and editor.
 *
 * A "capability" is one human-language row (e.g. "Sprints") mapped to the
 * permission code(s) that back it. The grid never stores its own state — every
 * cell is DERIVED from a role's actual permission codes, and the editor writes
 * codes BACK, so the UI can never drift from what the guards enforce.
 *
 *   Full = holds the manage code · View = holds the view code · — = neither
 */

export type Cell = 'full' | 'view' | 'none'

export interface CapabilityRow {
  label: string
  /** Holding this code (or its namespace / `workspace:*` wildcard) ⇒ Full. */
  manage?: string
  /** Holding this ⇒ at least View. */
  view?: string
  /** Reads are open to any member (no gate) ⇒ everyone gets at least View. */
  openView?: boolean
}
export interface CapabilityGroup {
  group: string
  rows: CapabilityRow[]
}

export const CAPABILITIES: CapabilityGroup[] = [
  {
    group: 'Workspace',
    rows: [
      { label: 'Workspace settings', view: 'workspace:view', manage: 'workspace:edit' },
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

/** The three canonical built-in roles, in display order. */
export const BUILTIN_ROLE_ORDER = ['workspace_admin', 'project_admin', 'project_member'] as const

/** A role is a built-in when the backend marks it immutable (or it is global). */
export function isBuiltInRole(role: Pick<Role, 'isSystem' | 'workspaceId'>): boolean {
  return role.isSystem || role.workspaceId === null
}

/** Wildcard-aware: does the role hold `code` (exact, `ns:*`, or `workspace:*`)? */
export function holds(role: Pick<Role, 'permissions'>, code: string): boolean {
  if (role.permissions.includes('workspace:*') || role.permissions.includes(code)) return true
  const ns = code.split(':')[0]
  return !!ns && role.permissions.includes(`${ns}:*`)
}

/** The DISPLAY cell for a role × capability (honours `openView`). */
export function cellFor(role: Pick<Role, 'permissions'>, row: CapabilityRow): Cell {
  if (row.manage && holds(role, row.manage)) return 'full'
  if (row.view && holds(role, row.view)) return 'view'
  if (row.openView) return 'view'
  return 'none'
}

/**
 * The EDITABLE state for a role × capability — like {@link cellFor} but ignores
 * `openView` (that is a read-gate display concern, not something a custom role's
 * codes control), so the editor round-trips exactly the codes it will write.
 */
export function editableState(role: Pick<Role, 'permissions'>, row: CapabilityRow): Cell {
  if (row.manage && holds(role, row.manage)) return 'full'
  if (row.view && holds(role, row.view)) return 'view'
  return 'none'
}

/** The states this capability can be toggled through, given the codes it has. */
export function statesFor(row: CapabilityRow): Cell[] {
  const states: Cell[] = ['none']
  if (row.view) states.push('view')
  if (row.manage) states.push('full')
  return states
}

/** The permission codes a single capability contributes at a given state. */
export function codesForState(row: CapabilityRow, state: Cell): string[] {
  if (state === 'full') return [row.view, row.manage].filter((c): c is string => !!c)
  if (state === 'view') return [row.view].filter((c): c is string => !!c)
  return []
}

/** Flatten a per-capability state map into the deduped, sorted code list to save. */
export function permissionsFromStates(states: Record<string, Cell>): string[] {
  const codes = new Set<string>()
  for (const group of CAPABILITIES) {
    for (const row of group.rows) {
      for (const code of codesForState(row, states[row.label] ?? 'none')) codes.add(code)
    }
  }
  return [...codes].sort()
}

/** The initial per-capability state map derived from a role's current codes. */
export function statesFromRole(role: Pick<Role, 'permissions'>): Record<string, Cell> {
  const states: Record<string, Cell> = {}
  for (const group of CAPABILITIES) {
    for (const row of group.rows) states[row.label] = editableState(role, row)
  }
  return states
}
