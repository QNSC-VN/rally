/**
 * DB migration runner — called by CI as a gated job BEFORE deploying a new app version.
 * Uses the DATABASE_MIGRATION_URL (privileged role that bypasses RLS).
 * Never run by the app process itself.
 */
// Load .env for local dev; in CI the env vars are injected directly.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI mode */
}

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'path';
import { seed, seedSystemRoles, seedTenantBootstrap } from './seeds/seed';
import { pgOptions } from './pg-ssl';

const url = process.env['DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_URL'];

if (!url) {
  console.error('❌  DATABASE_MIGRATION_URL or DATABASE_URL required');
  process.exit(1);
}

const pool = new Pool({ ...pgOptions(url), max: 1 });
const db = drizzle(pool);

async function run() {
  try {
    console.log('Running migrations...');
    await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
    console.log('✅  Migrations applied');

    // Seed uses DATABASE_URL (app role), not the migration URL (admin role).
    // Falls back to migration URL if DATABASE_URL is not set separately.
    const seedUrl = process.env['DATABASE_URL'] ?? url;

    // Reference data — the RBAC role catalogue — is required for authz to work
    // (JIT SSO provisioning assigns these role slugs). It contains no demo
    // fixtures, so it runs on EVERY deploy in EVERY environment, including real
    // production. Idempotent.
    console.log('Seeding system role catalogue...');
    await seedSystemRoles(seedUrl);

    // Tenant bootstrap — the primary workspace + Entra SSO connection. Prod-safe
    // config (no demo fixtures): required for real users to JIT-provision and for
    // PLATFORM_ADMIN_EMAILS elevation on first login. Runs in EVERY environment.
    console.log('Seeding tenant bootstrap (workspace + SSO connection)...');
    await seedTenantBootstrap(seedUrl);

    // Demo fixtures (demo users, projects, work items, teams, releases) are for
    // develop/staging/E2E only. Gate on SEED_ON_DEPLOY and NEVER set it in
    // production — real prod runs only the two prod-safe steps above.
    if (process.env['SEED_ON_DEPLOY'] === 'true') {
      console.log('SEED_ON_DEPLOY=true — running demo seed...');
      await seed(seedUrl);
    }
  } catch (err) {
    console.error('❌  Migration failed', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void run();
