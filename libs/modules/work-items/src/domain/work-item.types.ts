import type {
  WorkItemType,
  WorkItemPriority,
  WorkItemScheduleState,
} from '../../../../../db/schema/enums';
export type { WorkItemType, WorkItemPriority, WorkItemScheduleState };

export interface WorkItem {
  id: string;
  tenantId: string;
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
  storyPoints: number | null;
  // Drizzle returns numeric columns as strings to preserve precision.
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
}

export interface WorkItemFilters {
  type?: WorkItemType;
  statusId?: string;
  scheduleState?: WorkItemScheduleState;
  priority?: WorkItemPriority;
  assigneeId?: string;
  teamId?: string;
  iterationId?: string;
  releaseId?: string;
  /** Free-text search: item_key exact (case-insensitive) or title ILIKE. */
  q?: string;
}

export interface CreateWorkItemInput {
  id: string;
  tenantId: string;
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
  storyPoints?: number;
  estimateHours?: string;
  todoHours?: string;
  actualHours?: string;
  acceptanceCriteria?: string;
  notes?: string;
  releaseNotes?: string;
  rank: string;
  createdBy: string;
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
  storyPoints?: number | null;
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
}

/** Aggregated task time totals for the Tasks-tab totals row. */
export interface TaskTotals {
  taskCount: number;
  estimateHours: number;
  todoHours: number;
  actualHours: number;
}
