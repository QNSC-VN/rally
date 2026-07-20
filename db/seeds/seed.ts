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
 *   demo.ts       → seed                 dev/staging/E2E fixtures — gated by
 *                                        SEED_ON_DEPLOY, NEVER real production
 *
 * db/migrate.ts imports { seed, seedSystemRoles, seedTenantBootstrap } from here,
 * so this barrel keeps that import surface stable after the split.
 *
 * Run standalone: pnpm db:seed  (runs the full demo seed).
 */
import { seed } from './demo';

export { seed } from './demo';
export { seedSystemRoles } from './reference';
export { seedTenantBootstrap } from './bootstrap';

// Run directly: pnpm db:seed
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
