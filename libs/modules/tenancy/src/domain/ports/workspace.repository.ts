import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput } from '../tenancy.types';

export const WORKSPACE_REPOSITORY = Symbol('WORKSPACE_REPOSITORY');

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  findBySlug(tenantId: string, slug: string): Promise<Workspace | null>;
  listByTenant(
    tenantId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Workspace>>;
  create(input: CreateWorkspaceInput, tx?: DbExecutor): Promise<Workspace>;
  update(id: string, input: UpdateWorkspaceInput): Promise<Workspace>;
  softDelete(id: string): Promise<void>;
}
