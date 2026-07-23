/**
 * Iteration (Timebox) activity-log domain types — the iteration-scoped sibling
 * of work-items' activity log. Powers the Iteration detail "Revision History"
 * tab. Written right after the mutation so the actor sees their change
 * immediately. Distinct from the async compliance audit log (audit.audit_logs).
 */

/** Action codes for iteration revisions. */
export type IterationActivityAction =
  | 'iteration.created'
  | 'iteration.updated'
  | 'iteration.committed'
  | 'iteration.accepted';

/** Short, scalar before/after for one field. Never a rich-text body. */
export interface ActivityChange {
  field: string;
  old: unknown;
  new: unknown;
}

export interface CreateIterationActivityLogInput {
  id: string;
  workspaceId: string;
  projectId: string;
  iterationId: string;
  actorId: string | null;
  action: IterationActivityAction;
  changes?: ActivityChange | null;
  metadata?: Record<string, unknown>;
}

export interface IterationActivityLog {
  id: string;
  workspaceId: string;
  projectId: string;
  iterationId: string;
  actorId: string | null;
  /** Resolved display name of the actor at query time (LEFT JOIN on users). */
  actorName: string | null;
  action: string;
  changes: ActivityChange | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
