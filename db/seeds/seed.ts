// Load .env for local dev; in CI the env vars are injected directly.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI mode */
}

/**
 * Seed entrypoint (barrel) for the tiered seed system:
 *
 *   reference.ts  → seedSystemRoles      RBAC catalogue — prod-safe, EVERY env
 *   bootstrap.ts  → seedTenantBootstrap  workspace + SSO  — prod-safe, EVERY env
 *   demo.ts       → seed                 ONE-project E2E/dev fixture — gated by
 *                                        SEED_ON_DEPLOY, NEVER real production
 *
 * Two local commands:
 *   pnpm db:seed        → seedBaseline  — CLEAN develop DB: roles + QNSC
 *                         workspace + SSO + a single platform-admin (dev-login).
 *                         NO demo projects/work items.
 *   pnpm db:seed:test   → seed (--fixtures) — baseline PLUS the one-project
 *                         end-to-end fixture (NXP), for E2E + manual testing.
 *
 * db/migrate.ts imports { seed, seedSystemRoles, seedTenantBootstrap } from here,
 * so this barrel keeps that import surface stable.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq, isNull, or } from 'drizzle-orm';
import { pgOptions } from '../pg-ssl';
import * as schema from '../schema';
import { userRoleAssignments } from '../schema/access';
import { ADMIN_USER_ID, WORKSPACE_ID } from './constants';
import { seed } from './demo';
import { seedSystemRolesInto } from './reference';
import { seedTenantBootstrapInto } from './bootstrap';

export { seed } from './demo';
export { seedSystemRoles } from './reference';
export { seedTenantBootstrap } from './bootstrap';

/**
 * Dev baseline: RBAC catalogue + QNSC workspace + SSO + a single platform-admin
 * user so dev-login works. NO demo projects/work items — a clean develop DB.
 * Prod-safe pieces (roles + workspace) mirror the deploy path; the admin row is
 * a dev convenience (in prod the admin JIT-provisions on first SSO login).
 * Idempotent (fixed UUIDs + onConflictDoNothing).
 */
export async function seedBaseline(connectionUrl?: string): Promise<void> {
  const url = connectionUrl ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL or connectionUrl required');

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  const db = drizzle(pool, { schema });
  try {
    console.log('Seeding baseline (roles + workspace + admin)…');
    await seedSystemRolesInto(db);
    await seedTenantBootstrapInto(db);

    // Platform-admin user + workspace membership (dev-login target).
    const adminEmail = process.env['ADMIN_EMAIL'] ?? 'admin@qnsc.dev';
    await db
      .insert(schema.users)
      .values({
        id: ADMIN_USER_ID,
        email: adminEmail,
        displayName: 'Admin User',
        emailVerified: true,
        locale: 'en',
        timezone: 'Asia/Ho_Chi_Minh',
      })
      .onConflictDoNothing();
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: WORKSPACE_ID, userId: ADMIN_USER_ID })
      .onConflictDoNothing();

    // workspace_admin role (prefer the workspace-owned copy over the global template).
    const rows = await db
      .select({ id: schema.systemRoles.id, workspaceId: schema.systemRoles.workspaceId })
      .from(schema.systemRoles)
      .where(
        and(
          eq(schema.systemRoles.slug, 'workspace_admin'),
          or(
            isNull(schema.systemRoles.workspaceId),
            eq(schema.systemRoles.workspaceId, WORKSPACE_ID),
          ),
        ),
      );
    const adminRoleId = (rows.find((r) => r.workspaceId === WORKSPACE_ID) ?? rows[0])?.id;
    if (adminRoleId) {
      await db
        .insert(userRoleAssignments)
        .values({
          workspaceId: WORKSPACE_ID,
          userId: ADMIN_USER_ID,
          roleId: adminRoleId,
          scopeType: 'workspace',
          scopeId: WORKSPACE_ID,
          grantedBy: ADMIN_USER_ID,
        })
        .onConflictDoNothing();
    }

    console.log('✅  Baseline seeded — roles + QNSC workspace + admin. No fixtures.');
  } finally {
    await pool.end();
  }
}

// Run directly. Default = clean baseline; `--fixtures` (pnpm db:seed:test) loads
// the one-project E2E fixture on top.
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  const withFixtures = process.argv.includes('--fixtures') || process.argv.includes('--test');
  (withFixtures ? seed() : seedBaseline()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
