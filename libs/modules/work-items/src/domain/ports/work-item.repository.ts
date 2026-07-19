import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type {
  WorkItem,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemFilters,
  TaskTotals,
} from '../work-item.types';

export const WORK_ITEM_REPOSITORY = Symbol('WORK_ITEM_REPOSITORY');

/** Project/team scope of an iteration — used to validate assignment. */
export interface IterationScope {
  projectId: string;
  teamId: string | null;
}

export interface IWorkItemRepository {
  findById(id: string, workspaceId: string, executor?: DbExecutor): Promise<WorkItem | null>;
  /** Resolve a work item by its human item key within a project (work_items→tasks fallback). */
  findByKey(itemKey: string, projectId: string, workspaceId: string): Promise<WorkItem | null>;
  /** Non-deleted work items for the given ids, scoped to a workspace. */
  findByIds(ids: string[], workspaceId: string): Promise<WorkItem[]>;
  /** Project/team scope of an iteration (any workspace guard is applied by caller). */
  findIterationScope(iterationId: string, workspaceId: string): Promise<IterationScope | null>;
  /** Project id owning a release, or null if not found for this workspace. */
  findReleaseProject(releaseId: string, workspaceId: string): Promise<string | null>;
  /** Bulk-assign iteration (null unassigns) to the given ids. All-or-nothing via caller UoW. */
  assignIteration(
    ids: string[],
    iterationId: string | null,
    workspaceId: string,
    updatedBy: string,
    executor?: DbExecutor,
  ): Promise<void>;
  /** Bulk-assign release (null unassigns) to the given ids. All-or-nothing via caller UoW. */
  assignRelease(
    ids: string[],
    releaseId: string | null,
    workspaceId: string,
    updatedBy: string,
    executor?: DbExecutor,
  ): Promise<void>;
  listByProject(
    projectId: string,
    workspaceId: string,
    filters: WorkItemFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>>;
  /** Backlog: story + defect only (tasks excluded), keyset paginated. */
  listBacklog(
    projectId: string,
    workspaceId: string,
    filters: WorkItemFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>>;
  /** Direct child tasks of a parent work item, ordered by rank. */
  listTasksByParent(parentId: string, workspaceId: string): Promise<WorkItem[]>;
  /**
   * Highest existing rank in the given scope (siblings under a parent task
   * list, or top-level project items when parentId is omitted). Null if the
   * scope is empty. Used to append newly-created items at the end of order.
   */
  findMaxRank(
    scope: { projectId: string; parentId?: string | null },
    workspaceId: string,
  ): Promise<string | null>;
  /** Server-side aggregated totals for a parent's tasks (totals row). */
  getTaskTotals(parentId: string, workspaceId: string): Promise<TaskTotals>;
  /**
   * Check whether ALL non-deleted child tasks of a parent are in 'completed' state.
   * Returns true if the parent has zero tasks (nothing to block completion).
   */
  areAllTasksComplete(
    parentId: string,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<boolean>;
  /**
   * BA F1 — auto-accept an iteration when EVERY assigned Story/Defect is in an
   * accepted state and there is at least one such item. Idempotent: only a
   * 'committed' iteration transitions to 'accepted'. Returns true if it flipped.
   */
  autoAcceptIterationIfComplete(
    iterationId: string,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<boolean>;
  create(input: CreateWorkItemInput, executor?: DbExecutor): Promise<WorkItem>;
  update(
    id: string,
    input: UpdateWorkItemInput,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<WorkItem>;
  softDelete(id: string, workspaceId: string, executor?: DbExecutor): Promise<void>;
  reorderItems(
    items: Array<{ id: string; rank: string }>,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<void>;
  addLabel(workItemId: string, labelId: string, workspaceId: string): Promise<void>;
  removeLabel(workItemId: string, labelId: string, workspaceId: string): Promise<void>;
  listLabels(workItemId: string): Promise<Array<{ id: string; name: string; color: string }>>;
  listMilestones(workItemId: string): Promise<Array<{ id: string; name: string }>>;
  setMilestones(workItemId: string, milestoneIds: string[]): Promise<void>;
  /** Count of the given milestone ids that belong to `projectId` (same-project guard). */
  countMilestonesInProject(milestoneIds: string[], projectId: string): Promise<number>;
}
