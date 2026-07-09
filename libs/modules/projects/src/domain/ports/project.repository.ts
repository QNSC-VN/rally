import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type {
  Project,
  ProjectWithStats,
  CreateProjectInput,
  UpdateProjectInput,
} from '../project.types';

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
  update(id: string, input: UpdateProjectInput, workspaceId: string): Promise<Project>;
  softDelete(id: string, workspaceId: string): Promise<void>;
  initCounter(projectId: string, workspaceId: string, tx?: DbExecutor): Promise<void>;
  incrementCounter(projectId: string, workspaceId: string): Promise<number>;
}
