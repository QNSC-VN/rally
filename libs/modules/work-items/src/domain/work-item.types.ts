import type {
  WorkItemType,
  WorkItemPriority,
  WorkItemScheduleState,
} from '../../../../../db/schema/enums';
export type { WorkItemType, WorkItemPriority, WorkItemScheduleState };

/**
 * Sentinel value for {@link WorkItemFilters.assigneeId} that matches work items
 * with no assignee (owner IS NULL). Not a UUID, so it never collides with a
 * real user id.
 */
export const UNASSIGNED_FILTER = 'unassigned';

export interface WorkItem {
  id: string;
  workspaceId: string;
  projectId: string;
  itemKey: string;
  type: WorkItemType;
  title: string;
  description: string | null;
  statusId: string;
  scheduleState: WorkItemScheduleState;
  priority: WorkItemPriority;
  assigneeId: string | null;
  reporterId: string | null;
  parentId: string | null;
  teamId: string | null;
  iterationId: string | null;
  releaseId: string | null;
  // Drizzle returns numeric columns as strings to preserve precision.
  storyPoints: string | null;
  estimateHours: string | null;
  todoHours: string | null;
  actualHours: string | null;
  acceptanceCriteria: string | null;
  notes: string | null;
  releaseNotes: string | null;
  isBlocked: boolean;
  blockedReason: string | null;
  rank: string;
  customFields: Record<string, unknown>;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  // P3.4 — Defect-specific fields
  severity: string | null;
  foundInEnvironment: string | null;
  foundInReleaseId: string | null;
  rootCause: string | null;
  resolution: string | null;
  devOwnerId: string | null;
  defectState: string | null;
  fixedInBuild: string | null;
}

export interface WorkItemFilters {
  type?: WorkItemType;
  statusId?: string;
  scheduleState?: WorkItemScheduleState;
  priority?: WorkItemPriority;
  /**
   * Filter by assignee. A UUID matches that user; the {@link UNASSIGNED_FILTER}
   * sentinel matches work items with no owner (assignee IS NULL).
   */
  assigneeId?: string;
  teamId?: string;
  iterationId?: string;
  releaseId?: string;
  parentId?: string;
  /** Free-text search: item_key exact (case-insensitive) or title ILIKE. */
  q?: string;
}

export interface CreateWorkItemInput {
  id: string;
  workspaceId: string;
  projectId: string;
  itemKey: string;
  type: WorkItemType;
  title: string;
  description?: string;
  statusId: string;
  scheduleState?: WorkItemScheduleState;
  priority: WorkItemPriority;
  assigneeId?: string;
  reporterId?: string;
  parentId?: string;
  teamId?: string;
  iterationId?: string;
  releaseId?: string;
  storyPoints?: string;
  estimateHours?: string;
  todoHours?: string;
  actualHours?: string;
  acceptanceCriteria?: string;
  notes?: string;
  releaseNotes?: string;
  rank: string;
  createdBy: string;
  // P3.4 — Defect-specific fields
  severity?: string | null;
  foundInEnvironment?: string | null;
  foundInReleaseId?: string | null;
  rootCause?: string | null;
  resolution?: string | null;
  devOwnerId?: string | null;
  defectState?: string | null;
  fixedInBuild?: string | null;
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string | null;
  statusId?: string;
  scheduleState?: WorkItemScheduleState;
  priority?: WorkItemPriority;
  assigneeId?: string | null;
  reporterId?: string | null;
  parentId?: string | null;
  teamId?: string | null;
  iterationId?: string | null;
  releaseId?: string | null;
  storyPoints?: string | null;
  estimateHours?: string | null;
  todoHours?: string | null;
  actualHours?: string | null;
  acceptanceCriteria?: string | null;
  notes?: string | null;
  releaseNotes?: string | null;
  isBlocked?: boolean;
  blockedReason?: string | null;
  rank?: string;
  customFields?: Record<string, unknown>;
  /** Set by the service on every mutation for audit/activity attribution. */
  updatedBy?: string;
  // P3.4 — Defect-specific fields
  severity?: string | null;
  foundInEnvironment?: string | null;
  foundInReleaseId?: string | null;
  rootCause?: string | null;
  resolution?: string | null;
  devOwnerId?: string | null;
  defectState?: string | null;
  fixedInBuild?: string | null;
}

/** Aggregated task time totals for the Tasks-tab totals row. */
export interface TaskTotals {
  taskCount: number;
  estimateHours: number;
  todoHours: number;
  actualHours: number;
}
