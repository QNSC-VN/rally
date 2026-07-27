import type { SystemRole } from '../access.types';
import type { DbExecutor } from '@platform';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

/** A new workspace-owned custom role (never a built-in). */
export interface NewCustomRole {
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  permissions: string[];
}

export interface IRoleRepository {
  findById(id: string): Promise<SystemRole | null>;
  listForWorkspace(workspaceId: string): Promise<SystemRole[]>;
  updatePermissions(id: string, permissions: string[], tx?: DbExecutor): Promise<SystemRole>;
  create(input: NewCustomRole, tx?: DbExecutor): Promise<SystemRole>;
  delete(id: string, tx?: DbExecutor): Promise<void>;
}
