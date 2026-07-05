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
  findById(id: string, tenantId: string): Promise<WorkItem | null>;
  /** Non-deleted work items for the given ids, scoped to a tenant. */
  findByIds(ids: string[], tenantId: string): Promise<WorkItem[]>;
  /** Project/team scope of an iteration (any tenant guard is applied by caller). */
  findIterationScope(iterationId: string, tenantId: string): Promise<IterationScope | null>;
  /** Project id owning a release, or null if not found for this tenant. */
  findReleaseProject(releaseId: string, tenantId: string): Promise<string | null>;
  /** Bulk-assign iteration (null unassigns) to the given ids. All-or-nothing via caller UoW. */
  assignIteration(
    ids: string[],
    iterationId: string | null,
    tenantId: string,
    updatedBy: string,
    executor?: DbExecutor,
  ): Promise<void>;
  /** Bulk-assign release (null unassigns) to the given ids. All-or-nothing via caller UoW. */
  assignRelease(
    ids: string[],
    releaseId: string | null,
    tenantId: string,
    updatedBy: string,
    executor?: DbExecutor,
  ): Promise<void>;
  listByProject(
    projectId: string,
    tenantId: string,
    filters: WorkItemFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>>;
  /** Backlog: story + defect only (tasks excluded), keyset paginated. */
  listBacklog(
    projectId: string,
    tenantId: string,
    filters: WorkItemFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>>;
  /** Direct child tasks of a parent work item, ordered by rank. */
  listTasksByParent(parentId: string, tenantId: string): Promise<WorkItem[]>;
  /** Server-side aggregated totals for a parent's tasks (totals row). */
  getTaskTotals(parentId: string, tenantId: string): Promise<TaskTotals>;
  create(input: CreateWorkItemInput, executor?: DbExecutor): Promise<WorkItem>;
  update(id: string, input: UpdateWorkItemInput, tenantId: string, executor?: DbExecutor): Promise<WorkItem>;
  softDelete(id: string, tenantId: string, executor?: DbExecutor): Promise<void>;
  reorderItems(
    items: Array<{ id: string; rank: string }>,
    tenantId: string,
    executor?: DbExecutor,
  ): Promise<void>;
  addLabel(workItemId: string, labelId: string, tenantId: string): Promise<void>;
  removeLabel(workItemId: string, labelId: string, tenantId: string): Promise<void>;
  listLabels(workItemId: string): Promise<Array<{ id: string; name: string; color: string }>>;
}
