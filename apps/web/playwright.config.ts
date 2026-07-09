import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for Rally web e2e.
 *
 * Assumes the backend API is running on :3000 (docker stack + `nest start api`)
 * and the seed data is loaded. Playwright starts the Vite dev server itself.
 *
 * Run:  pnpm --filter rally-web test:e2e
 */
export default defineConfig({
  testDir: './src/test/e2e',
  testMatch: '**/*.e2e.ts',
  // Phase 2 specs mutate data and each logs in fresh (rotating refresh tokens
  // can't be shared across contexts); run serially for determinism.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  // Each test logs in fresh (see helpers.login). No shared storageState — the
  // backend rotates + reuse-protects refresh tokens, so a shared session breaks.
  // Requires the API to run with DISABLE_RATE_LIMIT=true so per-test login is OK.
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
