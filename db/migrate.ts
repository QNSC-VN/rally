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
import { seed } from './seeds/seed';

const url = process.env['DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_URL'];

if (!url) {
  console.error('❌  DATABASE_MIGRATION_URL or DATABASE_URL required');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

async function run() {
  try {
    console.log('Running migrations...');
    await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
    console.log('✅  Migrations applied');

    // In develop/staging, seed fixture data on every deploy so the breakglass
    // account and dev tenant always exist with the configured credentials.
    // Never set SEED_ON_DEPLOY=true in production — data is provisioned through
    // normal tenant sign-up flows there.
    if (process.env['SEED_ON_DEPLOY'] === 'true') {
      console.log('SEED_ON_DEPLOY=true — running seed...');
      // Seed uses DATABASE_URL (app role), not the migration URL (admin role).
      // Falls back to migration URL if DATABASE_URL is not set separately.
      const seedUrl = process.env['DATABASE_URL'] ?? url;
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
