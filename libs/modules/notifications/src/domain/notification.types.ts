export interface Notification {
  id: string;
  tenantId: string;
  recipientId: string;
  actorId: string | null;
  type: string;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  sourceEventId: string | null;
}

export interface CreateNotificationInput {
  id: string;
  tenantId: string;
  recipientId: string;
  actorId?: string;
  type: string;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  /** Outbox eventId — used for at-most-once deduplication via ON CONFLICT DO NOTHING. */
  sourceEventId?: string;
}
