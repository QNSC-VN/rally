/**
 * The Audit Log's Action-filter vocabulary — every code `GET /v1/audit-logs?action=` accepts,
 * grouped for the picker.
 *
 * WHY a filter over action codes exists at all: the Detail column is a sentence assembled in the
 * BROWSER (`entities/audit/model/describe-audit.ts` — a template per action, plus id→name
 * resolution from the members/teams/roles queries), so no column holds the words a reader sees.
 * "Granted", "Signed in through SSO" and "Revoked" exist only in that template table, which is why
 * a text box over the log's real columns could never find them and why the free-text box on the
 * screen searches the loaded page. `action` is the column those sentences are CHOSEN by, so it is
 * the part of "what happened" a query can answer honestly across the whole log (P45-04).
 *
 * Phase 4.2 SRS §3.7 removes the separate `Action` and `Entity` COLUMNS ("the Detail column is the
 * source of what happened"); this is a filter, not a column, and Detail remains the only place a
 * row's meaning is displayed.
 *
 * WHY the list is restated here rather than imported:
 *  - the SPA cannot import server code into the browser bundle, so it mirrors the backend
 *    catalogue, exactly as the permission codes and the Detail templates already do;
 *  - `ACTION_TEMPLATES_FOR_CONTRACT` in `describe-audit.ts` holds the same vocabulary but its own
 *    docblock reserves it for the cross-boundary contract test, so it is deliberately not read
 *    here.
 * `libs/modules/audit/src/domain/fe-audit-action-filter.contract.spec.ts` runs in the backend suite,
 * where both sides are importable, and fails if this list drifts from `AUDIT_ACTION` plus the
 * `auth.*` codes `@quynhonsemiconductor/identity` writes — so a new audited action cannot ship unfilterable.
 */

/** Filter groups, in picker order. Labels are translated by the caller. */
export const AUDIT_ACTION_GROUPS = ['auth', 'users', 'projects', 'teams', 'workspace'] as const

export type AuditActionGroup = (typeof AUDIT_ACTION_GROUPS)[number]

export interface AuditActionOption {
  /** The value sent as `?action=`; an exact `audit_logs.action` match. */
  code: string
  group: AuditActionGroup
}

/**
 * Grouped by what an administrator is looking for, not by the code's first segment:
 * `workspace.member.*` and `workspace.invitation.*` are user management (§3.7 "User invited",
 * "User removed from company/project/team", "User role changed"), while `workspace.updated` and
 * `workspace.settings.updated` are configuration.
 */
export const AUDIT_ACTION_OPTIONS: readonly AuditActionOption[] = [
  // ── Sign-in (written by @quynhonsemiconductor/identity, the highest-volume rows in the log) ──
  { code: 'auth.login.sso', group: 'auth' },
  { code: 'auth.login.dev', group: 'auth' },
  { code: 'auth.logout', group: 'auth' },
  { code: 'auth.switch_workspace', group: 'auth' },
  { code: 'auth.token_theft_detected', group: 'auth' },
  // ── Users & roles ──
  { code: 'workspace.member.invited', group: 'users' },
  { code: 'workspace.member.added', group: 'users' },
  { code: 'workspace.member.updated', group: 'users' },
  { code: 'workspace.member.removed', group: 'users' },
  { code: 'workspace.invitation.accepted', group: 'users' },
  { code: 'workspace.invitation.resent', group: 'users' },
  { code: 'workspace.invitation.cancelled', group: 'users' },
  { code: 'role.assigned', group: 'users' },
  { code: 'role.revoked', group: 'users' },
  { code: 'role.created', group: 'users' },
  { code: 'role.deleted', group: 'users' },
  { code: 'role.permissions.updated', group: 'users' },
  // ── Projects & access ──
  { code: 'project.created', group: 'projects' },
  { code: 'project.updated', group: 'projects' },
  { code: 'project.archived', group: 'projects' },
  { code: 'project.restored', group: 'projects' },
  { code: 'project.deleted', group: 'projects' },
  { code: 'project.member.added', group: 'projects' },
  { code: 'project.member.updated', group: 'projects' },
  { code: 'project.member.removed', group: 'projects' },
  // ── Teams ──
  { code: 'team.created', group: 'teams' },
  { code: 'team.updated', group: 'teams' },
  { code: 'team.deleted', group: 'teams' },
  { code: 'team.member.added', group: 'teams' },
  { code: 'team.member.removed', group: 'teams' },
  // ── Workspace configuration ──
  { code: 'workspace.updated', group: 'workspace' },
  { code: 'workspace.settings.updated', group: 'workspace' },
]
