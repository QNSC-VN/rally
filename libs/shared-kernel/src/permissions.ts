/**
 * Re-export of the canonical permission catalogue.
 *
 * The authoritative definition lives in db/permissions.catalog.ts — the one
 * place both the standalone migrator/seed image (db/** only) and the NestJS app
 * can import. This barrel simply surfaces it under @shared-kernel so app code
 * doesn't reach across the repo with a relative path.
 *
 * Reached via the `@db/*` alias rather than `../../../db/...`: the depth-counting
 * form breaks silently when this file moves, and it obscured that libs → db is a
 * deliberate, single-file dependency.
 */
export {
  PERMISSION,
  ROLE_PERMISSIONS,
  ROLE_NAMES,
  PERMISSION_TIER,
  permissionGrants,
  isProjectTierPermission,
  PROJECT_ACCESS_LEVEL,
  isProjectAccessLevel,
  ACCESS_LEVEL_PERMISSIONS,
  type Permission,
  type WorkspacePermission,
  type ProjectPermission,
  type SystemRoleSlug,
  type ProjectAccessLevel,
} from '@db/permissions.catalog';
