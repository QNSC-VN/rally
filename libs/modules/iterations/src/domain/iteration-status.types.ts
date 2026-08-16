import type { WorkItemType, WorkItemScheduleState } from '../../../../../db/schema/enums';

/**
 * Iteration Status read-model (P2.3). A tracking view over the work items
 * assigned to a single iteration — metrics plus a paginated item list. Sourced
 * live from `work_items` (single source of truth); it keeps no separate store.
 */

export interface IterationStatusMetrics {
  /** acceptedPoints / plannedVelocity as a percent (0 when velocity is 0). */
  /** Null when there is no velocity target — attainment against nothing is unanswerable. */
  plannedVelocityPercent: number | null;
  /** Sum of story points on items whose schedule state is 'accepted'. */
  acceptedPoints: number;
  /** The iteration's planned velocity (0 when unset). */
  /** Null when no target was set; `iterations.planned_velocity` is nullable. */
  plannedVelocity: number | null;
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
  /** Count of assigned child tasks NOT in the Completed task-state (active work). */
  activeTaskCount: number;
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
  /** work_items.blocked_reason — surfaced beside the Block flag (Rally "Blocked Reason"). */
  blockedReason: string | null;
  /** work_items.story_points (Plan Estimate). */
  planEstimate: number | null;
  /** Rollup: sum of child task estimate hours. */
  taskEstimate: number;
  /** Rollup: sum of child task to-do hours. */
  toDo: number;
  /** Rollup: sum of child task actual hours. */
  actual: number;
  /** Rollup: total non-deleted child tasks (Task % denominator). */
  taskTotal: number;
  /** Rollup: child tasks in the Completed task-state (Task % numerator). */
  taskDone: number;
  assigneeId: string | null;
  /** work_items.dev_owner_id — Rally "Dev Owner" (distinct from Owner/assignee). */
  devOwnerId: string | null;
  /**
   * `work_items.team_id` — the item's OWN team, not `iterations.team_id` and not a coalesce of the
   * two. The Owner rule (`Phase 2/03_Iteration_Status/SRS.md:435`, = Backlog AC-16) is judged against
   * the Work Item Team, so the Owner/Dev Owner pickers narrow their roster on this value. Null is the
   * `No team` case and means `Unassigned` is the only legal owner.
   */
  teamId: string | null;
  rank: string;
  /** The linked Feature's id — the Feature column links to portfolio detail, not
   * to `/item/:key`: a Feature is a portfolio item, so no work-item key resolves it. */
  featureId: string | null;
  /** Nearest ancestor Feature key (Rally "Feature" column); null when none. */
  featureKey: string | null;
  /** Nearest ancestor Feature title, for the chip tooltip. */
  featureTitle: string | null;
  /** Count of non-deleted child defects (Rally "Defects"). */
  defectCount: number;
  /** Count of child defects not yet accepted/released (Rally "Defect Status"). */
  openDefectCount: number;
  /** Milestones directly assigned to this item (Rally "Milestones"). */
  milestones: { id: string; name: string }[];
}

export interface IterationStatusFilters {
  q?: string;
  type?: WorkItemType;
  scheduleState?: WorkItemScheduleState;
  isBlocked?: boolean;
  /**
   * A UUID matches that owner; `UNASSIGNED_FILTER` matches rows with no owner.
   * Mirrors `WorkItemFilters.assigneeId` so the Backlog and Iteration Status
   * Owner filters mean the same thing (P2-IS §5: "inherit Phase 2.1 patterns").
   */
  assigneeId?: string;
  /**
   * Manage Filters text/number column predicates (P2-IS-FR-022/023/024).
   * Each is a SERVER predicate, so a match past the first page is still found.
   * `q` is deliberately separate — P2-BL-TS-015 (inherited here) makes quick
   * search independent of the Manage Filters set.
   */
  itemKey?: string;
  title?: string;
  /** Exact match on `work_items.story_points`, as a fixed(2) numeric string. */
  planEstimate?: string;
  /** Exact match on the child-task estimate-hours rollup, fixed(2) string. */
  taskEstimate?: string;
  /** Exact match on the child-task to-do-hours rollup, fixed(2) string. */
  toDo?: string;
}
