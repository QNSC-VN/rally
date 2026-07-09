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
  findById(id: string, workspaceId: string): Promise<WorkItem | null>;
  /** Non-deleted work items for the given ids, scoped to a tenant. */
  findByIds(ids: string[], workspaceId: string): Promise<WorkItem[]>;
  /** Project/team scope of an iteration (any tenant guard is applied by caller). */
  findIterationScope(iterationId: string, workspaceId: string): Promise<IterationScope | null>;
  /** Project id owning a release, or null if not found for this tenant. */
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
  /** Server-side aggregated totals for a parent's tasks (totals row). */
  getTaskTotals(parentId: string, workspaceId: string): Promise<TaskTotals>;
  create(input: CreateWorkItemInput, executor?: DbExecutor): Promise<WorkItem>;
  update(id: string, input: UpdateWorkItemInput, workspaceId: string, executor?: DbExecutor): Promise<WorkItem>;
  softDelete(id: string, workspaceId: string, executor?: DbExecutor): Promise<void>;
  reorderItems(
    items: Array<{ id: string; rank: string }>,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<void>;
  addLabel(workItemId: string, labelId: string, workspaceId: string): Promise<void>;
  removeLabel(workItemId: string, labelId: string, workspaceId: string): Promise<void>;
  listLabels(workItemId: string): Promise<Array<{ id: string; name: string; color: string }>>;
}
