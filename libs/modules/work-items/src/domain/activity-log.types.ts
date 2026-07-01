/**
 * Activity log (Revision History) domain types.
 *
 * Written synchronously in the same transaction as the work-item/task mutation
 * so the actor sees their change immediately. Distinct from the async
 * compliance audit log (audit.audit_logs).
 */

export type ActivityEntityType = 'work_item' | 'task' | 'attachment';

/** Action codes — kept in sync with SRS P1-ACTIVITY §5. */
export type ActivityAction =
  | 'work_item.created'
  | 'work_item.updated'
  | 'work_item.schedule_state_changed'
  | 'work_item.flow_state_changed'
  | 'work_item.priority_changed'
  | 'work_item.assigned'
  | 'work_item.estimate_updated'
  | 'task.created'
  | 'task.updated'
  | 'task.state_changed'
  | 'task.estimate_updated'
  | 'task.todo_updated'
  | 'task.actual_updated'
  | 'attachment.uploaded'
  | 'attachment.deleted';

/** Short, scalar before/after for one field. Never a rich-text body. */
export interface ActivityChange {
  field: string;
  old: unknown;
  new: unknown;
}

export interface CreateActivityLogInput {
  id: string;
  tenantId: string;
  projectId: string;
  workItemId: string;
  entityType: ActivityEntityType;
  entityId: string;
  actorId: string | null;
  action: ActivityAction;
  changes?: ActivityChange | null;
  metadata?: Record<string, unknown>;
}

export interface ActivityLog {
  id: string;
  tenantId: string;
  projectId: string;
  workItemId: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  /** Resolved display name of the actor at query time (LEFT JOIN on users). */
  actorName: string | null;
  action: string;
  changes: ActivityChange | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
