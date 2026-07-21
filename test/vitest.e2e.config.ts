import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

// Load .env before the config (and the AppModule it boots) reads process.env —
// Node does not auto-load .env files, and nothing else in the e2e path did
// this, so ConfigModule's Zod validation failed on any machine without these
// vars already exported in the shell (e.g. ENTRA_* — commented out by default
// in .env.example for local dev-login-only setups).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI injects vars directly */
}

// E2E config: runs tests against a live API + real DB.
// E2E tests live in test/e2e/**/*.e2e.spec.ts.
export default defineConfig({
  plugins: [swc.vite(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.e2e.spec.ts'],
    passWithNoTests: true,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      // Entra BFF OIDC — test-only placeholders, same values as vitest.config.ts.
      // .env intentionally leaves these commented out for local dev-login-only
      // setups (no real SSO configured); the e2e AppModule still needs
      // ConfigModule's Zod schema to validate, so supply harmless placeholders
      // here rather than requiring every local run to configure real Entra.
      ENTRA_TENANT_ID: 'test-tenant',
      ENTRA_CLIENT_ID: 'test-client',
      ENTRA_CLIENT_SECRET: 'test-secret',
      ENTRA_REDIRECT_URI: 'http://localhost:3000/v1/bff/callback',
      // Override .env's EMAIL_PROVIDER=ses: the email relay e2e coverage
      // exercises the real EmailRelayService/ResilienceService code path, but
      // must not depend on SES/LocalStack actually being reachable — the
      // 'dev' provider logs instead of sending, keeping the suite hermetic.
      EMAIL_PROVIDER: 'dev',
    },
  },
});
