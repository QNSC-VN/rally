import type { SystemRole } from '../access.types';
import type { DbExecutor } from '@platform';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

export interface IRoleRepository {
  findById(id: string): Promise<SystemRole | null>;
  listForWorkspace(workspaceId: string): Promise<SystemRole[]>;
  updatePermissions(id: string, permissions: string[], tx?: DbExecutor): Promise<SystemRole>;
}
