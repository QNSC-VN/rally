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
import { resolveDatabaseUrl, resolveMigrationUrl } from './database-url';

// Resolves DATABASE_MIGRATION_URL, else DATABASE_URL, else composes from the
// DATABASE_* parts (the deployed path — credentials come straight from the
// RDS-managed secret, never a hand-maintained copy). Throws with a precise
// message listing what is missing.
let url: string;
try {
  url = resolveMigrationUrl();
} catch (err) {
  console.error(`❌  ${(err as Error).message}`);
  process.exit(1);
}

const pool = new Pool({ ...pgOptions(url), max: 1 });
const db = drizzle(pool);

async function run() {
  try {
    console.log('Running migrations...');
    await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
    console.log('✅  Migrations applied');

    // Seed uses the app connection, not the migration URL (admin role).
    // Falls back to the migration URL when no separate app credential is set.
    const seedUrl = (() => {
      try {
        return resolveDatabaseUrl();
      } catch {
        return url;
      }
    })();

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

    /**
     * Demo fixtures (demo users, projects, work items, teams, releases) — LOCAL AND CI ONLY.
     *
     * Two gates, not one. `SEED_ON_DEPLOY` is the switch; `NODE_ENV` is the floor.
     *
     * The switch alone was a Terraform variable nobody must ever set wrong: develop had it `true`, so a
     * deployed database people read as real was carrying a fixture project, a capacity plan and a frozen
     * report history. Copying that stanza to another environment was all it would have taken to do the
     * same to production. Deployed migrator tasks run with `NODE_ENV=production`
     * (`infra/modules/stack/main.tf`), and nothing else does — CI's ephemeral Postgres and a developer's
     * own database do not — so this refuses the demo seed on exactly the databases that must never have
     * it, whatever the switch says.
     *
     * Refused LOUDLY rather than silently skipped: a deploy that expected fixtures should say why it has
     * none, or the next person debugs an empty environment instead of reading a log line.
     */
    if (process.env['SEED_ON_DEPLOY'] === 'true') {
      if (process.env['NODE_ENV'] === 'production') {
        console.warn(
          '⚠️  SEED_ON_DEPLOY=true but NODE_ENV=production — demo seed REFUSED. ' +
            'Deployed environments run the role catalogue and tenant bootstrap only; ' +
            'fixtures are for local development (pnpm db:seed:test) and CI.',
        );
      } else {
        console.log('SEED_ON_DEPLOY=true — running demo seed...');
        await seed(seedUrl);
      }
    }
  } catch (err) {
    console.error('❌  Migration failed', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void run();
