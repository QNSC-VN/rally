import type { SystemRole } from '../access.types';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

export interface IRoleRepository {
  findById(id: string): Promise<SystemRole | null>;
  listForTenant(tenantId: string): Promise<SystemRole[]>;
}
