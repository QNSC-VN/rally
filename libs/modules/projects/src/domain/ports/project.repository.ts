import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type {
  Project,
  ProjectWithStats,
  CreateProjectInput,
  UpdateProjectInput,
} from '../project.types';

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  findByKey(tenantId: string, key: string): Promise<Project | null>;
  listByWorkspace(
    workspaceId: string,
    tenantId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Project>>;
  listByWorkspaceWithStats(
    workspaceId: string,
    tenantId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<ProjectWithStats>>;
  create(input: CreateProjectInput, tx?: DbExecutor): Promise<Project>;
  update(id: string, input: UpdateProjectInput): Promise<Project>;
  softDelete(id: string): Promise<void>;
  initCounter(projectId: string, tenantId: string, tx?: DbExecutor): Promise<void>;
  incrementCounter(projectId: string): Promise<number>;
}
