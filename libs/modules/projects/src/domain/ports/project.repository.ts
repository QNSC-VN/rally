import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type {
  Project,
  ProjectWithStats,
  CreateProjectInput,
  UpdateProjectInput,
} from '../project.types';

/** Work item type values — mirrors db/schema/enums workItemTypeEnum */
export type WorkItemType = 'initiative' | 'feature' | 'story' | 'task' | 'defect';

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
  create(input: CreateProjectInput, tx?: DbExecutor): Promise<Project>;
  update(
    id: string,
    input: UpdateProjectInput,
    workspaceId: string,
    tx?: DbExecutor,
  ): Promise<Project>;
  softDelete(id: string, workspaceId: string): Promise<void>;
  initCounter(projectId: string, workspaceId: string, tx?: DbExecutor): Promise<void>;
  incrementCounter(
    projectId: string,
    workspaceId: string,
    itemType: WorkItemType,
    tx?: DbExecutor,
  ): Promise<number>;
  getMaxItemNumber(projectId: string, workspaceId: string, itemType: WorkItemType): Promise<number>;
}
