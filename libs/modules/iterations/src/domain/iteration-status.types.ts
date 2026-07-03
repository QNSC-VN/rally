import type { WorkItemType, WorkItemScheduleState } from '../../../../../db/schema/enums';

/**
 * Iteration Status read-model (P2.3). A tracking view over the work items
 * assigned to a single iteration — metrics plus a paginated item list. Sourced
 * live from `work_items` (single source of truth); it keeps no separate store.
 */

export interface IterationStatusMetrics {
  /** acceptedPoints / plannedVelocity as a percent (0 when velocity is 0). */
  plannedVelocityPercent: number;
  /** Sum of story points on items whose schedule state is 'accepted'. */
  acceptedPoints: number;
  /** The iteration's planned velocity (0 when unset). */
  plannedVelocity: number;
  /** acceptedPoints / totalPlanEstimate as a percent (0 when total is 0). */
  acceptedPercent: number;
  /** Sum of story points across all assigned (non-deleted) items. */
  totalPlanEstimate: number;
  /** Whole days from today to the iteration end date; null when no end date. Negative = ended. */
  daysLeft: number | null;
  /** Count of assigned items of type 'defect'. */
  defectCount: number;
  /** Count of assigned items of type 'task'. */
  taskCount: number;
}

/** One row of the Iteration Status work-item list. */
export interface IterationStatusItem {
  id: string;
  itemKey: string;
  type: WorkItemType;
  title: string;
  scheduleState: WorkItemScheduleState;
  iterationId: string | null;
  isBlocked: boolean;
  /** work_items.story_points (Plan Estimate). */
  planEstimate: number | null;
  /** Rollup: sum of child task estimate hours. */
  taskEstimate: number;
  /** Rollup: sum of child task to-do hours. */
  toDo: number;
  assigneeId: string | null;
  rank: string;
}

/** Sort keys for the Iteration Status list (mirrors the backlog list). */
export type IterationStatusSortBy =
  | 'rank'
  | 'itemKey'
  | 'type'
  | 'title'
  | 'scheduleState'
  | 'planEstimate'
  | 'taskEstimate'
  | 'toDo';

export interface IterationStatusFilters {
  q?: string;
  type?: WorkItemType;
  scheduleState?: WorkItemScheduleState;
  isBlocked?: boolean;
  assigneeId?: string;
  sortBy?: IterationStatusSortBy;
  sortDirection?: 'asc' | 'desc';
}
