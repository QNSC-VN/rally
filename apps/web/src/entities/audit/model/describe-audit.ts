/**
 * Audit-log presentation — the single source of truth that turns a raw audit
 * event into a human-readable sentence for the Audit Log viewer.
 *
 * Design goals (enterprise, future-proof):
 *  - Extensible: every audited action maps to one entry in {@link ACTION_TEMPLATES};
 *    adding a new action is a one-line change with no call-site edits.
 *  - Resilient: unknown / future action codes fall back to a humanised generic
 *    sentence, so a backend that ships a new action never renders a blank cell.
 *  - Pure & testable: id→name lookups come through an injected {@link AuditNameResolver},
 *    so the renderer does no data-fetching and is trivially unit-tested.
 *  - Decoupled: accepts a minimal structural event shape, not a feature DTO, and
 *    reads defensively from the `{ before?, after? }` change snapshot shape that
 *    every producer writes (see libs/platform/src/audit/audit-event.ts).
 */

/** Minimal structural shape of an audit event needed to describe it. */
export interface AuditEventView {
  action: string
  resourceType: string
  resourceId: string
  /** `{ before?, after? }` entity snapshots, as written by the audit producers. */
  changes: Record<string, unknown> | null
}

/** Resolves the opaque ids stored in audit payloads to human names. */
export interface AuditNameResolver {
  user?: (id: string) => string | undefined
  role?: (id: string) => string | undefined
  team?: (id: string) => string | undefined
}

// ── Primitives ────────────────────────────────────────────────────────────────

/** Convert a camelCase / snake_case / dotted token into a Title-Cased phrase. */
export function humanizeToken(token: string): string {
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function idStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Quote a scalar value for a "from X to Y" clause; collapse objects to an ellipsis. */
function quote(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)'
  if (typeof v === 'string') return `“${v.length > 60 ? `${v.slice(0, 60)}…` : v}”`
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (typeof v === 'number') return String(v)
  return '…'
}

/** Snapshot keys that are plumbing, not user-meaningful changes. */
const NOISE_KEYS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
  'workspaceId',
  'workspace_id',
])

/** Keys that differ between the before/after snapshots, minus plumbing noise. */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter(
    (k) => !NOISE_KEYS.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  )
}

// ── Render context ──────────────────────────────────────────────────────────

interface RenderCtx {
  event: AuditEventView
  before: Record<string, unknown>
  after: Record<string, unknown>
  /** Resolve a userId → display name, falling back to an email or short id. */
  user: (id: unknown) => string
  /** Resolve a roleId → role name, falling back to a short id. */
  role: (id: unknown) => string
  /** Resolve a teamId → team name, falling back to a short id. */
  team: (id: unknown) => string
}

/** The entity's own name/title from either snapshot side, when present. */
function entityName(c: RenderCtx): string | undefined {
  return str(c.after.name) ?? str(c.before.name) ?? str(c.after.title) ?? str(c.before.title)
}

/** Fallback label for an unnamed entity: "Project 019f742b". */
function shortRef(c: RenderCtx): string {
  return `${humanizeToken(c.event.resourceType)} ${c.event.resourceId.slice(0, 8)}`
}

/**
 * An entity reference for use AFTER a noun (e.g. "project …"): the entity's own
 * name, or a compact "#id" when the snapshot carries no name — avoids the
 * doubled "project Project 019f742b" the type-prefixed {@link shortRef} produces.
 */
function entityRef(c: RenderCtx): string {
  return entityName(c) ?? `#${c.event.resourceId.slice(0, 8)}`
}

// ── Shared update describers ──────────────────────────────────────────────────

function describeSettingsUpdate(c: RenderCtx, subject: string): string {
  const fields = changedFields(c.before, c.after)
  if (fields.length === 0) return `Updated ${subject}`
  if (fields.length === 1) {
    const f = fields[0]
    return `Updated ${humanizeToken(f).toLowerCase()} from ${quote(c.before[f])} to ${quote(c.after[f])}`
  }
  return `Updated ${subject} (${fields.map((f) => humanizeToken(f).toLowerCase()).join(', ')})`
}

function describeEntityUpdate(c: RenderCtx, noun: string): string {
  const name = entityRef(c)
  const fields = changedFields(c.before, c.after)
  if (fields.length === 1 && (fields[0] === 'name' || fields[0] === 'title')) {
    return `Renamed ${noun} from ${quote(c.before[fields[0]])} to ${quote(c.after[fields[0]])}`
  }
  if (fields.length === 0) return `Updated ${noun} ${name}`
  return `Updated ${noun} ${name} (${fields.map((f) => humanizeToken(f).toLowerCase()).join(', ')})`
}

function describeMemberUpdate(c: RenderCtx): string {
  const who = c.user(c.after.userId ?? c.before.userId)
  if ('roleId' in c.after && c.before.roleId !== c.after.roleId) {
    return `Changed ${who}’s role from ${c.role(c.before.roleId)} to ${c.role(c.after.roleId)}`
  }
  if ('status' in c.after && c.before.status !== c.after.status) {
    const from = humanizeToken(idStr(c.before.status)) || 'none'
    const to = humanizeToken(idStr(c.after.status)) || 'none'
    return `Changed ${who}’s status from ${from} to ${to}`
  }
  const fields = changedFields(c.before, c.after).filter((f) => f !== 'userId')
  return `Updated ${who}${fields.length ? ` (${fields.map((f) => humanizeToken(f).toLowerCase()).join(', ')})` : ''}`
}

function describeTeamUpdate(c: RenderCtx): string {
  const name = entityRef(c)
  if (c.after.status === 'archived' && c.before.status !== 'archived') {
    return `Archived team ${name}`
  }
  return describeEntityUpdate(c, 'team')
}

function describePermissionsUpdate(c: RenderCtx): string {
  const role = c.role(c.event.resourceId)
  const before = Array.isArray(c.before.permissions) ? c.before.permissions : []
  const after = Array.isArray(c.after.permissions) ? c.after.permissions : []
  const added = after.filter((p) => !before.includes(p)).length
  const removed = before.filter((p) => !after.includes(p)).length
  const delta = [added ? `+${added}` : '', removed ? `−${removed}` : ''].filter(Boolean).join(', ')
  return `Updated permissions for the ${role} role${delta ? ` (${delta})` : ''}`
}

// ── Action registry ───────────────────────────────────────────────────────────

/**
 * One entry per audit action code (mirrors AUDIT_ACTION in
 * libs/platform/src/audit/audit-event.ts). Keep in sync when new actions ship;
 * unknown codes degrade gracefully via {@link describeFallback}.
 */
const ACTION_TEMPLATES: Record<string, (c: RenderCtx) => string> = {
  // ── Workspace ──
  'workspace.updated': (c) => describeSettingsUpdate(c, 'workspace'),
  'workspace.settings.updated': (c) => describeSettingsUpdate(c, 'workspace settings'),
  'workspace.member.added': (c) => `Added ${c.user(c.after.userId)} to the workspace`,
  'workspace.member.updated': describeMemberUpdate,
  'workspace.member.removed': (c) => `Removed ${c.user(c.before.userId)} from the workspace`,
  'workspace.member.invited': (c) =>
    `Invited ${str(c.after.email) ?? 'a user'} as ${c.role(c.after.roleId)}`,
  'workspace.invitation.cancelled': (c) =>
    `Cancelled the invitation for ${str(c.before.email) ?? str(c.after.email) ?? 'a user'}`,
  'workspace.invitation.accepted': (c) =>
    `${str(c.after.email) ?? c.user(c.after.userId)} accepted the workspace invitation`,

  // ── Access / RBAC ──
  'role.assigned': (c) =>
    `Assigned the ${c.role(c.after.roleId ?? c.event.resourceId)} role to ${c.user(c.after.userId)}`,
  'role.revoked': (c) =>
    `Revoked the ${c.role(c.before.roleId ?? c.event.resourceId)} role from ${c.user(c.before.userId)}`,
  'role.permissions.updated': describePermissionsUpdate,

  // ── Projects ──
  'project.created': (c) => `Created project ${entityRef(c)}`,
  'project.updated': (c) => describeEntityUpdate(c, 'project'),
  'project.archived': (c) => `Archived project ${entityRef(c)}`,

  // ── Teams ──
  'team.created': (c) => `Created team ${entityRef(c)}`,
  'team.updated': describeTeamUpdate,
  'team.member.added': (c) =>
    `Assigned ${c.user(c.after.userId)} to the ${c.team(c.after.teamId)} team`,
  'team.member.removed': (c) =>
    `Removed ${c.user(c.before.userId)} from the ${c.team(c.before.teamId)} team`,
}

/** Readable sentence for an action code the FE does not (yet) have a template for. */
function describeFallback(c: RenderCtx): string {
  const name = entityName(c) ?? shortRef(c)
  return `${humanizeToken(c.event.action)} — ${name}`
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render a plain-language sentence describing what an audit event did.
 * `resolver` is optional; without it, ids degrade to short forms/emails.
 */
export function describeAuditEvent(
  event: AuditEventView,
  resolver: AuditNameResolver = {},
): string {
  const changes = asRecord(event.changes)
  const ctx: RenderCtx = {
    event,
    before: asRecord(changes.before),
    after: asRecord(changes.after),
    user: (id) => {
      const s = idStr(id)
      if (!s) return 'someone'
      return resolver.user?.(s) ?? (s.includes('@') ? s : `user ${s.slice(0, 8)}`)
    },
    role: (id) => {
      const s = idStr(id)
      if (!s) return 'a role'
      return resolver.role?.(s) ?? `role ${s.slice(0, 8)}`
    },
    team: (id) => {
      const s = idStr(id)
      if (!s) return 'a team'
      return resolver.team?.(s) ?? `team ${s.slice(0, 8)}`
    },
  }
  const template = ACTION_TEMPLATES[event.action]
  return template ? template(ctx) : describeFallback(ctx)
}
