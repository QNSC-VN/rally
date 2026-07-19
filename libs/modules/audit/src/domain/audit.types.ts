export interface AuditLog {
  id: string;
  workspaceId: string;
  actorId: string | null;
  /** Actor's display name, resolved from the users table at read time. */
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  projectId: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: Date;
  sourceEventId: string | null;
}

export interface CreateAuditLogInput {
  id: string;
  workspaceId: string;
  actorId?: string;
  actorEmail?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  projectId?: string;
  changes?: { before?: unknown; after?: unknown };
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  /** Outbox eventId — used for at-most-once deduplication via ON CONFLICT DO NOTHING. */
  sourceEventId?: string;
}
