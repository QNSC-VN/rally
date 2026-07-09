import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput } from '../workspace.types';

export const WORKSPACE_REPOSITORY = Symbol('WORKSPACE_REPOSITORY');

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  findBySlug(slug: string): Promise<Workspace | null>;
  /** Workspaces the given user is an active member of, most-recent first. */
  listForUser(
    userId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Workspace>>;
  /** All non-deleted workspaces (bootstrap/administrative use). */
  listAll(): Promise<Workspace[]>;
  count(): Promise<number>;
  create(input: CreateWorkspaceInput, tx?: DbExecutor): Promise<Workspace>;
  update(id: string, input: UpdateWorkspaceInput): Promise<Workspace>;
  softDelete(id: string): Promise<void>;
}
