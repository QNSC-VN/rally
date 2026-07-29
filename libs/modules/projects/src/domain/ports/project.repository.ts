import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type {
  Project,
  ProjectWithStats,
  ProjectHealth,
  CreateProjectInput,
  UpdateProjectInput,
} from '../project.types';

/** Work item type values — mirrors db/schema/enums workItemTypeEnum */
export type WorkItemType = 'story' | 'task' | 'defect';

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

export interface IProjectRepository {
  findById(id: string, workspaceId: string): Promise<Project | null>;
  findByKey(workspaceId: string, key: string): Promise<Project | null>;
  listByWorkspace(
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Project>>;
  listByWorkspaceWithStats(
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<ProjectWithStats>>;
  listHealthByWorkspace(workspaceId: string, args: { limit: number }): Promise<ProjectHealth[]>;
  create(input: CreateProjectInput, tx?: DbExecutor): Promise<Project>;
  update(
    id: string,
    input: UpdateProjectInput,
    workspaceId: string,
    tx?: DbExecutor,
  ): Promise<Project>;
  softDelete(id: string, workspaceId: string): Promise<void>;
  /** Seed workspace-wide item counters (per type). Idempotent. */
  initCounter(workspaceId: string, tx?: DbExecutor): Promise<void>;
  /** Allocate the next workspace-wide sequence for a type (Rally FormattedID). */
  incrementCounter(workspaceId: string, itemType: WorkItemType, tx?: DbExecutor): Promise<number>;
  getMaxItemNumber(workspaceId: string, itemType: WorkItemType): Promise<number>;
}
