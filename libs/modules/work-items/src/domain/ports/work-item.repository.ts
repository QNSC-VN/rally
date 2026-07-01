import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type {
  WorkItem,
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemFilters,
  TaskTotals,
} from '../work-item.types';

export const WORK_ITEM_REPOSITORY = Symbol('WORK_ITEM_REPOSITORY');

export interface IWorkItemRepository {
  findById(id: string): Promise<WorkItem | null>;
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
  update(id: string, input: UpdateWorkItemInput, executor?: DbExecutor): Promise<WorkItem>;
  softDelete(id: string, executor?: DbExecutor): Promise<void>;
  reorderItems(
    items: Array<{ id: string; rank: string }>,
    tenantId: string,
    executor?: DbExecutor,
  ): Promise<void>;
  addLabel(workItemId: string, labelId: string): Promise<void>;
  removeLabel(workItemId: string, labelId: string): Promise<void>;
  listLabels(workItemId: string): Promise<Array<{ id: string; name: string; color: string }>>;
}
