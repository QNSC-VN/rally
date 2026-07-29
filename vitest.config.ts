import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    // SWC must come first — emits decorator metadata that NestJS DI relies on
    swc.vite(),
    tsconfigPaths(),
  ],
  resolve: {
    // Prefer TypeScript source over compiled JS so stale build artefacts
    // living alongside .ts files don't shadow the real source.
    extensions: ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_KEY_PREFIX: 'test:',
      // EC P-256 (ES256) test-only placeholder keys — never used for real signing.
      // Must match algorithm: 'ES256' in platform.module.ts.
      JWT_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQguroUP5ujCG9PaA7F\n+53M+ZEtNeuIunGs3mI6EEuD5qKhRANCAASZgAZjNEMAVYuVFiV1KfKFDRLVoJki\nokvGm4Kv+GReUvPaxoZPolxDcDmmdUfVHKrRxNbN7Kw8/x1o+2BibAO+\n-----END PRIVATE KEY-----',
      JWT_PUBLIC_KEY:
        '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmYAGYzRDAFWLlRYldSnyhQ0S1aCZ\nIqJLxpuCr/hkXlLz2saGT6JcQ3A5pnVH1Ryq0cTWzeysPP8daPtgYmwDvg==\n-----END PUBLIC KEY-----',
      JWT_ACCESS_EXPIRY: '15m',
      JWT_REFRESH_EXPIRY: '30d',
      JWT_ISSUER: 'rally-test',
      JWT_AUDIENCE: 'rally-test-app',
      JWT_REFRESH_TOKEN_MAX_FAMILY_SIZE: '10',
      CSRF_SECRET: 'test-csrf-secret-at-least-32-chars!!',
      COOKIE_SECRET: 'test-cookie-secret-at-least-32-chars!',
      INVITATION_TTL_DAYS: '7',
      LOG_LEVEL: 'error',
      OTEL_ENABLED: 'false',
      OTEL_SERVICE_NAME: 'rally-api-test',
      OTEL_WORKER_SERVICE_NAME: 'rally-worker-test',
      APP_BASE_URL: 'http://localhost:5173',
      // Entra BFF OIDC — test-only placeholders. Never used for real auth.
      ENTRA_TENANT_ID: 'test-tenant',
      ENTRA_CLIENT_ID: 'test-client',
      ENTRA_CLIENT_SECRET: 'test-secret',
      ENTRA_REDIRECT_URI: 'http://localhost:3000/v1/bff/callback',
    },
    // `test/*.spec.ts` (top level only) picks up repo-wide guard specs such as
    // coverage-include.spec.ts. Deliberately NOT `test/**` — that would drag in
    // test/e2e/*.e2e.spec.ts, which need a live Postgres + Valkey and run under
    // test/vitest.e2e.config.ts instead.
    include: ['libs/**/*.spec.ts', 'apps/**/*.spec.ts', 'db/**/*.spec.ts', 'test/*.spec.ts'],
    // Bare 'node_modules' only matches a top-level segment, not nested ones —
    // apps/**/*.spec.ts otherwise pulls in package-internal specs like
    // apps/web/node_modules/@tiptap/react/src/*.spec.ts, which need jsdom and
    // fail under this config's environment: 'node'.
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Coverage ratchet: measure every file that HAS a unit spec — kept in sync
      // by test/coverage-include.spec.ts, which fails when a spec's subject is
      // missing from this list. It previously named four files by hand, one of
      // which (libs/modules/planning/...) had been deleted, so the gate measured
      // three files while 27 had specs.
      include: [
        'db/database-url.ts',
        'libs/shared-kernel/src/health.ts',
        'libs/modules/portfolio/src/domain/portfolio-rollup.ts',
        'libs/modules/access/src/application/access.service.ts',
        'libs/modules/access/src/interface/http/policy.guard.ts',
        'libs/modules/activity/src/application/activity-logger.service.ts',
        'libs/modules/activity/src/domain/activity-diff.ts',
        'libs/modules/attachments/src/application/attachments.service.ts',
        'libs/modules/audit/src/interface/http/audit.controller.ts',
        'libs/modules/collaboration/src/application/collaboration.service.ts',
        'libs/modules/identity/src/infrastructure/secrets-manager-secret-resolver.ts',
        'libs/platform/src/config/env.schema.ts',
        'libs/modules/iterations/src/application/iteration-status.service.ts',
        'libs/modules/iterations/src/application/iterations.service.ts',
        'libs/modules/milestones/src/application/milestones.service.ts',
        'libs/modules/notifications/src/interface/http/notification-preferences.controller.ts',
        'libs/modules/projects/src/application/projects.service.ts',
        'libs/modules/releases/src/application/releases.service.ts',
        'libs/modules/scm/src/application/scm-backfill.service.ts',
        'libs/modules/scm/src/application/scm-installation.service.ts',
        'libs/modules/scm/src/infrastructure/github/github-app-auth.service.ts',
        'libs/modules/scm/src/infrastructure/github/github-rest.mapper.ts',
        'libs/modules/team-status/src/application/team-status.service.ts',
        'libs/modules/work-items/src/application/work-items.service.ts',
        'libs/modules/workspace/src/application/invitation.service.ts',
        'libs/modules/workspace/src/application/team.service.ts',
        'libs/modules/workspace/src/application/workspace-member.service.ts',
        'libs/modules/workspace/src/application/workspace.service.ts',
        'libs/platform/src/auth/jwt.guard.ts',
        'libs/platform/src/context/request-context.ts',
        'libs/platform/src/http/csrf.ts',
        'libs/platform/src/outbox/abstract-outbox-relay.ts',
        'libs/platform/src/storage/storage.service.ts',
        'libs/platform/src/utils/lexorank.util.ts',
        'libs/shared-kernel/src/permissions.ts',
      ],
      exclude: ['**/*.spec.ts'],
      // Ratchet: raise these incrementally as coverage improves, NEVER lower them.
      // Measured 2026-07-26 across all 27 spec'd files: stmts 71.27, branches
      // 63.98, funcs 67.80, lines 72.21 — floors sit just underneath. The previous
      // floors (49/40) were set against a 3-file sample and so understated the
      // real bar by ~20 points.
      // Target: stmts/funcs/lines 80%, branches 70%.
      thresholds: {
        lines: 70,
        functions: 66,
        branches: 62,
        statements: 70,
      },
    },
  },
});
