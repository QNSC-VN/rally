import type { SystemRole } from '../access.types';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

/**
 * READ-ONLY by ruling (2026-08-14). `create`, `updatePermissions` and `delete` were removed with
 * custom-role CRUD — AC-11 makes the Permission Model read-only, and `db/permissions.catalog.ts`
 * is the single source of truth a per-workspace editable matrix would fork. See the Roles section
 * of `AccessService` for the full reasoning; do not re-add a writer here.
 *
 * The role rows themselves are still WRITTEN, by `db/seeds/reference.ts` and
 * `db/seeds/bootstrap.ts` — the catalogue reaching a workspace is a deploy-time concern, not a
 * request-time one.
 */
export interface IRoleRepository {
  findById(id: string): Promise<SystemRole | null>;
  listForWorkspace(workspaceId: string): Promise<SystemRole[]>;
}
