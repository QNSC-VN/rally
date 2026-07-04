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
  // Phase 2 specs share a single browser and mutate data; run serially for determinism.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  // Log in once; every spec reuses the session (avoids the AUTH_LOGIN rate limit).
  globalSetup: './src/test/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    storageState: 'src/test/e2e/.auth/admin.json',
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
