/**
 * Shared activity-log (Revision History) domain types — one definition for every
 * entity (work item, task, attachment, iteration, project, milestone, release).
 */

export type ActivityEntityType =
  | 'work_item'
  | 'task'
  | 'attachment'
  | 'iteration'
  | 'project'
  | 'milestone'
  | 'release';

/** A single field change. Rich-text fields record the field name only (old/new null). */
export interface ActivityChange {
  field: string;
  old: unknown;
  new: unknown;
}

/** Input for one appended entry. */
export interface CreateActivityInput {
  id: string;
  workspaceId: string;
  projectId: string;
  entityType: ActivityEntityType;
  entityId: string;
  /** Optional parent anchor — a parent's history also returns rows anchored here
   *  (e.g. task/attachment logs anchored to the parent work item). */
  contextId?: string | null;
  actorId: string | null;
  action: string;
  changes: ActivityChange | null;
  metadata?: Record<string, unknown>;
}

/** One row as returned to the UI (actorName resolved via LEFT JOIN users). */
export interface ActivityLog {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  entityType: ActivityEntityType;
  entityId: string;
  action: string;
  changes: ActivityChange | null;
  metadata: Record<string, unknown> | null;
}

export interface ActivityPage {
  data: ActivityLog[];
  total: number;
  page: number;
  pageSize: number;
}
