import type { CursorPayload, PagedResult, DbExecutor } from '@platform';
import type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput } from '../workspace.types';

export const WORKSPACE_REPOSITORY = Symbol('WORKSPACE_REPOSITORY');

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  /** Workspaces the given user is an active member of, most-recent first. */
  listForUser(
    userId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Workspace>>;
  /** All non-deleted workspaces (bootstrap/administrative use). */
  listAll(): Promise<Workspace[]>;
  count(): Promise<number>;
  create(input: CreateWorkspaceInput, tx?: DbExecutor): Promise<Workspace>;
  update(id: string, input: UpdateWorkspaceInput, tx?: DbExecutor): Promise<Workspace>;
  // No `softDelete` and no `findBySlug`: `DELETE /workspaces/:id` and `POST /workspaces` are gone
  // (COMPANY-FR-010 / AC-8), and those two methods had no other reader. `create` STAYS — it is what
  // `ensureDefaultWorkspace` provisions the single root with on a freshly-migrated install.
}
