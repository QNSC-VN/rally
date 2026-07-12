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
    include: ['libs/**/*.spec.ts', 'apps/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Coverage ratchet: only measure files that have unit specs.
      // Threshold enforces quality on tested code; adding new files here
      // is a conscious decision when writing the matching spec.
      include: [
        'libs/modules/workspace/src/application/workspace.service.ts',
        'libs/modules/projects/src/application/projects.service.ts',
        'libs/modules/planning/src/application/planning.service.ts',
        'libs/modules/work-items/src/application/work-items.service.ts',
      ],
      exclude: ['**/*.spec.ts'],
      // Ratchet: raise these incrementally as test coverage improves.
      // Current baseline measured 2026-06-28: stmts 50%, branches 41%, funcs 51%, lines 50%.
      // Target: stmts/funcs/lines 70%, branches 60%.
      thresholds: {
        lines: 49,
        functions: 49,
        branches: 40,
        statements: 49,
      },
    },
  },
});
