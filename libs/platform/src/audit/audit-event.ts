import { BaseDomainEvent } from '@shared-kernel';

/**
 * Audit action catalogue — the single source of truth for audit action codes.
 *
 * Each value becomes `audit_logs.action` (carried as the domain event's
 * `eventType`). Codes are dotted `resource.action` strings and form a versioned
 * contract read by the Audit Log viewer and any downstream SIEM export — keep
 * them stable; never rename in place.
 */
export const AUDIT_ACTION = {
  // ── Workspace ──
  WORKSPACE_UPDATED: 'workspace.updated',
  WORKSPACE_SETTINGS_UPDATED: 'workspace.settings.updated',
  WORKSPACE_MEMBER_ADDED: 'workspace.member.added',
  WORKSPACE_MEMBER_UPDATED: 'workspace.member.updated',
  WORKSPACE_MEMBER_REMOVED: 'workspace.member.removed',
  WORKSPACE_MEMBER_INVITED: 'workspace.member.invited',
  WORKSPACE_INVITATION_CANCELLED: 'workspace.invitation.cancelled',
  WORKSPACE_INVITATION_ACCEPTED: 'workspace.invitation.accepted',
  // ── Access / RBAC ──
  ROLE_ASSIGNED: 'role.assigned',
  ROLE_REVOKED: 'role.revoked',
  ROLE_PERMISSIONS_UPDATED: 'role.permissions.updated',
  // ── Projects ──
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_ARCHIVED: 'project.archived',
  // ── Teams ──
  TEAM_CREATED: 'team.created',
  TEAM_UPDATED: 'team.updated',
  TEAM_MEMBER_ADDED: 'team.member.added',
  TEAM_MEMBER_REMOVED: 'team.member.removed',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/**
 * Audit resource types — mirror `audit_logs.resource_type` (the aggregate the
 * action targeted). Kept as constants so producers and the viewer agree on a
 * single vocabulary.
 */
export const AUDIT_RESOURCE = {
  WORKSPACE: 'workspace',
  WORKSPACE_MEMBER: 'workspace_member',
  WORKSPACE_INVITATION: 'workspace_invitation',
  ROLE_ASSIGNMENT: 'role_assignment',
  ROLE: 'role',
  PROJECT: 'project',
  TEAM: 'team',
  TEAM_MEMBER: 'team_member',
} as const;

export type AuditResource = (typeof AUDIT_RESOURCE)[keyof typeof AUDIT_RESOURCE];

/** Actor identity captured on every audit event (from the authenticated request). */
export interface AuditActor {
  /** userId — the authenticated principal's `JwtPayload.sub`. */
  id: string;
}

export interface AuditEventInput {
  action: AuditAction;
  resourceType: AuditResource;
  resourceId: string;
  workspaceId: string;
  actor: AuditActor;
  /** Owning project id, when the action is project-scoped. */
  projectId?: string;
  /** Before/after snapshot, enabling change diffing in the audit trail. */
  changes?: { before?: unknown; after?: unknown };
}

/**
 * Domain event whose payload matches exactly what the worker `AuditConsumer`
 * maps onto an audit log row. Written to the transactional outbox in the SAME
 * transaction as the state change, so an audit entry can never diverge from the
 * mutation it records (no dual-write, no lost events).
 */
export class AuditEvent extends BaseDomainEvent {
  constructor(input: AuditEventInput) {
    super(input.action, 1, input.resourceType, input.resourceId, input.workspaceId, {
      actorId: input.actor.id,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.changes ? { changes: input.changes } : {}),
    });
  }
}
