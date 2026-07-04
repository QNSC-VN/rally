import { chromium, type FullConfig } from '@playwright/test'
import { ADMIN } from './helpers'

/**
 * Log in ONCE and persist the session (the httpOnly refresh cookie) to
 * storageState. Every spec reuses it, so we never hit the AUTH_LOGIN rate limit
 * by logging in per-test. The in-memory access token is re-minted from the
 * refresh cookie on app bootstrap.
 */
export const STORAGE_STATE = 'src/test/e2e/.auth/admin.json'

// Stable seed fixtures (db/seeds/seed.ts): ACME Corp workspace + NX Platform project.
const SEED_CONTEXT = {
  workspace: {
    workspaceId: '00000000-0000-7000-8000-000000000003',
    workspaceSlug: 'main',
    workspaceName: 'ACME Corp',
  },
  project: {
    projectId: '00000000-0000-7000-8000-000000000010',
    projectKey: 'NXP',
    projectName: 'NX Platform',
  },
  team: null,
  sidebarCollapsed: false,
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173'
  const browser = await chromium.launch()
  const page = await browser.newPage({ baseURL })
  try {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.fill('input[type="email"]', ADMIN.email)
    await page.fill('input[type="password"]', ADMIN.password)
    await page.click('button[type="submit"]')
    await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20_000 })

    // Pre-seed the workspace/project context (Zustand persist key) so every spec
    // starts project-scoped without driving the flaky selector UI per test. The
    // app also re-syncs workspace from the API on load; project stays as set.
    await page.evaluate((ctx) => {
      localStorage.setItem('rally-context', JSON.stringify({ state: ctx, version: 0 }))
    }, SEED_CONTEXT)

    await page.context().storageState({ path: STORAGE_STATE })
  } finally {
    await browser.close()
  }
}
