// Load .env for local dev; in CI the env vars are injected directly.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI mode */
}

/**
 * Bootstrap tier — the primary tenant (workspace + Entra SSO connection) plus the
 * editable workspace-scoped role copies.
 *
 * This is prod-safe CONFIG (no demo fixtures): it is what lets real users
 * JIT-provision and lets a PLATFORM_ADMIN_EMAILS admin be elevated on first SSO
 * login. Driven entirely by env so the same routine runs identically in dev,
 * staging and production. Runs in EVERY environment, independent of
 * SEED_ON_DEPLOY.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgOptions } from '../pg-ssl';
import { inArray, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { ssoConnections } from '../schema/identity';
import {
  ROLE_PERMISSIONS,
  ROLE_NAMES,
  SYSTEM_ROLE,
  PRESET_WORKSPACE_ROLES,
} from '../permissions.catalog';
import { type Db, WORKSPACE_ID } from './constants';

/**
 * Bootstrap the primary tenant — the workspace and its Entra SSO connection —
 * into the given db handle. This is prod-safe CONFIG (no demo fixtures): it is
 * what lets real users JIT-provision and lets a PLATFORM_ADMIN_EMAILS admin be
 * elevated on first SSO login. Driven entirely by env so the same routine runs
 * identically in dev, staging and production:
 *   BOOTSTRAP_WORKSPACE_NAME  — display name (default "ACME Corp")
 *   BOOTSTRAP_WORKSPACE_SLUG  — url slug     (default "main")
 *   ENTRA_TENANT_ID           — Entra directory to federate (skips SSO if unset)
 *   SSO_ALLOWED_EMAIL_DOMAINS — comma-separated JIT allow-list (default "qnsc.vn")
 *   SSO_JIT_ENABLED           — "false" = invite-only (only pre-provisioned users
 *                               + platform admins may sign in); default "true"
 * Idempotent: workspace + connection use onConflictDoUpdate so config edits
 * reconcile on every run.
 */
export async function seedTenantBootstrapInto(database: Db): Promise<void> {
  const workspaceName = process.env['BOOTSTRAP_WORKSPACE_NAME'] ?? 'ACME Corp';
  const workspaceSlug = process.env['BOOTSTRAP_WORKSPACE_SLUG'] ?? 'main';

  await database
    .insert(schema.workspaces)
    .values({ id: WORKSPACE_ID, slug: workspaceSlug, name: workspaceName })
    .onConflictDoUpdate({
      target: schema.workspaces.id,
      set: { name: workspaceName },
    });

  // Seed the BA job-function preset roles as EDITABLE workspace-scoped custom
  // roles (isSystem:false). onConflictDoNothing → created once, never clobbering
  // a workspace admin's later permission edits. See PRESET_WORKSPACE_ROLES.
  await database
    .insert(schema.systemRoles)
    .values(
      PRESET_WORKSPACE_ROLES.map((role) => ({
        workspaceId: WORKSPACE_ID,
        name: role.name,
        slug: role.slug,
        description: role.description,
        isSystem: false,
        permissions: role.permissions,
      })),
    )
    .onConflictDoNothing({
      target: [schema.systemRoles.workspaceId, schema.systemRoles.slug],
    });

  // Seed a per-workspace EDITABLE copy of every tier role EXCEPT Workspace Admin.
  // The four operational tiers (Project Admin / Member / Viewer, Workspace
  // Member) become ordinary workspace-owned roles (isSystem:false) so an admin
  // can tune their permissions without rewriting the shared global template.
  // Workspace Admin is deliberately omitted — it stays the single global,
  // immutable lockout anchor (isSystem:true) that guarantees a recovery path.
  const EDITABLE_TIER_SLUGS = [
    SYSTEM_ROLE.PROJECT_ADMIN,
    SYSTEM_ROLE.PROJECT_MEMBER,
    SYSTEM_ROLE.PROJECT_VIEWER,
    SYSTEM_ROLE.WORKSPACE_MEMBER,
  ] as const;
  await database
    .insert(schema.systemRoles)
    .values(
      EDITABLE_TIER_SLUGS.map((slug) => ({
        workspaceId: WORKSPACE_ID,
        name: ROLE_NAMES[slug],
        slug,
        isSystem: false,
        permissions: ROLE_PERMISSIONS[slug],
      })),
    )
    .onConflictDoNothing({
      target: [schema.systemRoles.workspaceId, schema.systemRoles.slug],
    });

  // Re-point any EXISTING assignment that still references a global tier
  // template onto this workspace's editable copy, so a workspace admin's later
  // permission edits actually take effect for already-provisioned users (and so
  // re-seeding never leaves a user holding both the template and the copy).
  // Idempotent: once re-pointed there are no template-scoped rows left to move.
  const tierRoleRows = await database
    .select({
      id: schema.systemRoles.id,
      slug: schema.systemRoles.slug,
      workspaceId: schema.systemRoles.workspaceId,
    })
    .from(schema.systemRoles)
    .where(inArray(schema.systemRoles.slug, [...EDITABLE_TIER_SLUGS]));
  for (const slug of EDITABLE_TIER_SLUGS) {
    const globalId = tierRoleRows.find((r) => r.slug === slug && r.workspaceId === null)?.id;
    const copyId = tierRoleRows.find((r) => r.slug === slug && r.workspaceId === WORKSPACE_ID)?.id;
    if (!globalId || !copyId) continue;
    // Drop template-scoped assignments that already have a copy twin (would
    // otherwise collide on the (user, role, scope) unique key), then move the rest.
    await database.execute(sql`
      DELETE FROM access.user_role_assignments a
      WHERE a.role_id = ${globalId}
        AND a.workspace_id = ${WORKSPACE_ID}
        AND EXISTS (
          SELECT 1 FROM access.user_role_assignments b
          WHERE b.user_id = a.user_id
            AND b.role_id = ${copyId}
            AND b.scope_type = a.scope_type
            AND b.scope_id IS NOT DISTINCT FROM a.scope_id
        )
    `);
    await database.execute(sql`
      UPDATE access.user_role_assignments
      SET role_id = ${copyId}
      WHERE role_id = ${globalId}
        AND workspace_id = ${WORKSPACE_ID}
    `);
  }

  const entraTid = process.env['ENTRA_TENANT_ID'];
  if (!entraTid) {
    console.log(
      `\u2705  Tenant bootstrap: workspace "${workspaceName}" + ${PRESET_WORKSPACE_ROLES.length} preset roles ` +
        `+ ${EDITABLE_TIER_SLUGS.length} editable tier roles ensured ` +
        `(no ENTRA_TENANT_ID \u2014 SSO connection skipped, dev-login only)`,
    );
    return;
  }

  // Restrict JIT provisioning to the corporate domain(s). Empty list = any
  // directory user could self-provision; default to qnsc.vn so only company
  // accounts auto-create. NOTE: only gates NEW users \u2014 already-linked SSO
  // identities skip the domain check on subsequent logins.
  const ssoAllowedDomains = (process.env['SSO_ALLOWED_EMAIL_DOMAINS'] ?? 'qnsc.vn')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  // Invite-only toggle. Default true = open JIT: any allowed-domain user self-
  // provisions on first SSO login. Set SSO_JIT_ENABLED=false to require pre-
  // provisioning — only seeded/invited users (matched by email) and
  // PLATFORM_ADMIN_EMAILS admins may sign in; everyone else is rejected until an
  // admin invites them. The invited-user allow path needs @qnsc-vn/identity
  // >= 5.5.0 (older versions treat jitEnabled=false as block-everyone).
  const jitEnabled = (process.env['SSO_JIT_ENABLED'] ?? 'true').toLowerCase() !== 'false';

  await database
    .insert(ssoConnections)
    .values({
      workspaceId: WORKSPACE_ID,
      provider: 'entra',
      externalTenantId: entraTid,
      defaultRoleSlug: 'project_member',
      allowedEmailDomains: ssoAllowedDomains,
      jitEnabled,
      status: 'active',
    })
    // Reconcile config on every run so allow-list / default-role / JIT changes
    // take effect on the existing connection.
    .onConflictDoUpdate({
      target: [ssoConnections.provider, ssoConnections.externalTenantId],
      set: {
        workspaceId: WORKSPACE_ID,
        defaultRoleSlug: 'project_member',
        allowedEmailDomains: ssoAllowedDomains,
        jitEnabled,
        status: 'active',
        updatedAt: new Date(),
      },
    });

  console.log(
    `\u2705  Tenant bootstrap: workspace "${workspaceName}" + ${PRESET_WORKSPACE_ROLES.length} preset roles ` +
      `+ ${EDITABLE_TIER_SLUGS.length} editable tier roles + Entra SSO connection ` +
      `reconciled (tid ${entraTid}, domains: ${ssoAllowedDomains.join(', ') || 'any'}, ` +
      `jit: ${jitEnabled ? 'open' : 'invite-only'})`,
  );
}

/**
 * Standalone entrypoint that bootstraps ONLY the primary tenant (workspace + SSO
 * connection). Prod-safe — contains no demo fixtures. Exported so db/migrate.ts
 * can run it on real production deploys.
 */
export async function seedTenantBootstrap(connectionUrl?: string): Promise<void> {
  const url = connectionUrl ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL or connectionUrl required');

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  const database = drizzle(pool, { schema });
  try {
    await seedTenantBootstrapInto(database);
  } finally {
    await pool.end();
  }
}
