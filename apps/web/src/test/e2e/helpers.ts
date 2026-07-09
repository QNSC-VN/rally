import { type Page, expect } from '@playwright/test'

export const ADMIN = { email: 'admin@acme.dev', password: 'DevAdminPass123!' }
export const SEED_PROJECT = 'NX Platform'

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

/**
 * Log in fresh for THIS test and land inside the app shell.
 *
 * We log in per-test (not via a shared storageState) on purpose: the backend
 * rotates the refresh token on every use and revokes the whole family on reuse
 * (correct production security). Sharing one token across test browser contexts
 * trips that protection. A fresh login per test gives each its own session
 * family. The API runs with DISABLE_RATE_LIMIT=true in e2e, so per-test login
 * doesn't hit the AUTH_LOGIN limit.
 *
 * Don't wait for 'networkidle' — the app holds a persistent SSE notifications
 * stream open so the network never idles; use 'domcontentloaded' + explicit
 * element waits.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', ADMIN.email)
  await page.fill('input[type="password"]', ADMIN.password)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20_000 })
  // Seed the project/workspace context so project-scoped screens work without
  // driving the selector UI. The app re-syncs workspace from the API on load.
  await page.evaluate((ctx) => {
    localStorage.setItem('rally-context', JSON.stringify({ state: ctx, version: 0 }))
  }, SEED_CONTEXT)
  await page.reload({ waitUntil: 'domcontentloaded' })
  // Wait for the authenticated shell to be present (not the login page) before
  // returning — a fixed timeout races the auth-context hydration on cold start.
  await page
    .waitForURL((u) => !u.pathname.includes('login'), { timeout: 20_000 })
    .catch(() => {})
  // The top-nav "Home" link only renders in the authenticated shell — waiting
  // for it confirms auth hydration finished (vs. a race back to /login).
  await page
    .getByRole('link', { name: 'Home' })
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {})
  await page.waitForTimeout(500)
}

/**
 * Ensure a project is selected in the workspace context (Phase 2 screens are
 * project-scoped). Opens the workspace/project selector and picks the seed
 * project when none is active.
 */
export async function selectProject(page: Page, name = SEED_PROJECT): Promise<void> {
  const noProject = page.getByText('No project selected')
  if (await noProject.isVisible().catch(() => false)) {
    await noProject.click()
    await page.waitForTimeout(400)
    await page.getByText(name, { exact: false }).first().click()
    await page.waitForTimeout(1000)
  }
}

export async function loginAndSelectProject(page: Page, name = SEED_PROJECT): Promise<void> {
  await login(page)
  await selectProject(page, name)
}

/**
 * Give React Query a beat to settle. Does NOT wait for 'networkidle' — the app's
 * persistent SSE stream means the network never idles; use element assertions
 * (auto-waited by Playwright) for readiness instead.
 */
export async function settle(page: Page, ms = 2500): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(ms)
}

export { expect }
