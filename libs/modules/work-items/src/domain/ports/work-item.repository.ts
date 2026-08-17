import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type {
  WorkItem,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemFilters,
  TaskTotals,
  MyWorkItem,
  WorkspaceSummary,
} from '../work-item.types';

export const WORK_ITEM_REPOSITORY = Symbol('WORK_ITEM_REPOSITORY');

/** Project/team scope of an iteration — used to validate assignment. */
export interface IterationScope {
  projectId: string;
  teamId: string | null;
}

export interface IWorkItemRepository {
  findById(id: string, workspaceId: string, executor?: DbExecutor): Promise<WorkItem | null>;
  /** Resolve a work item by its workspace-unique item key (work_items→tasks fallback). */
  findByKey(itemKey: string, workspaceId: string): Promise<WorkItem | null>;
  /** Non-deleted work items for the given ids, scoped to a workspace. */
  findByIds(ids: string[], workspaceId: string): Promise<WorkItem[]>;
  /** Project/team scope of an iteration (any workspace guard is applied by caller). */
  findIterationScope(iterationId: string, workspaceId: string): Promise<IterationScope | null>;
  /** Project id owning a release, or null if not found for this workspace. */
  /**
   * A portfolio item's type + archived state, for validating a Story's Feature link.
   *
   * Not scoped by project on purpose: Rally lets a Story roll up to a Feature in another project,
   * and the portfolio rollup matches on `feature_id` alone.
   */
  findPortfolioItemLinkTarget(
    portfolioItemId: string,
    workspaceId: string,
  ): Promise<{ type: string; archived: boolean } | null>;

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
   * Take a transaction-scoped advisory lock on one (project, parent) rank scope.
   *
   * Deriving a new rank is a read-modify-write, so it is only safe if the read
   * and the insert are serialised against other creates in the same scope. Call
   * this first, then {@link findMaxRank} with the SAME executor.
   */
  lockRankScope(
    scope: { projectId: string; parentId?: string | null },
    executor: DbExecutor,
  ): Promise<void>;
  /**
   * Highest existing rank in the given scope (siblings under a parent task
   * list, or top-level project items when parentId is omitted). Null if the
   * scope is empty. Used to append newly-created items at the end of order.
   *
   * Pass the caller's transaction as `executor`: read on the pool while the
   * insert happens in a transaction and the max is stale by construction.
   */
  findMaxRank(
    scope: { projectId: string; parentId?: string | null },
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<string | null>;
  /** Server-side aggregated totals for a parent's tasks (totals row). */
  getTaskTotals(parentId: string, workspaceId: string): Promise<TaskTotals>;
  /**
   * The two Home aggregates, and the ONE sentinel both share with every other cross-project read:
   * `readableProjectIds` is `null` for UNRESTRICTED and an array — possibly EMPTY — for restricted.
   * The distinction is the whole point: a caller that flattens `null` to `[]` fails closed, and one
   * that flattens `[]` to "all" leaks the workspace. See `AccessService.listReadableProjectIds`.
   *
   * Both were scoped by `workspace_id` alone, which is what made Home the one surface that still
   * reported a project after a Workspace Admin removed the reader's access to it (GAP-P4-RBAC-003,
   * AC4) — against Phase 4 `02_Roles_Permissions/SRS.md` §2.2 and §6, which put an unassigned
   * project out of navigation, selectors, search AND results. `listHealthByWorkspace` in the projects
   * module already took the sentinel for exactly this reason and is the model.
   */
  listMyWork(
    workspaceId: string,
    userId: string,
    args: { limit: number },
    readableProjectIds: string[] | null,
  ): Promise<MyWorkItem[]>;
  getWorkspaceSummary(
    workspaceId: string,
    userId: string,
    readableProjectIds: string[] | null,
  ): Promise<WorkspaceSummary>;
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
}
