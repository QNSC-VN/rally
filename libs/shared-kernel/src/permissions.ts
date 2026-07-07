/**
 * Re-export of the canonical permission catalogue.
 *
 * The authoritative definition lives in db/permissions.catalog.ts — the one
 * place both the standalone migrator/seed image (db/** only) and the NestJS app
 * can import. This barrel simply surfaces it under @shared-kernel so app code
 * doesn't reach across the repo with a relative path.
 */
export {
  PERMISSION,
  ROLE_PERMISSIONS,
  ROLE_NAMES,
  type Permission,
  type SystemRoleSlug,
} from '../../../db/permissions.catalog';
