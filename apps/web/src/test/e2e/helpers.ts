import { type Page, expect } from '@playwright/test'

export const ADMIN = { email: 'admin@acme.dev', password: 'DevAdminPass123!' }
export const SEED_PROJECT = 'NX Platform'

/**
 * Land inside the app shell. The session is restored from the storageState
 * refresh cookie (see global-setup); the app bootstraps the access token, so no
 * per-test login is needed (which would trip the AUTH_LOGIN rate limit).
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(800)
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

/** Wait until network is idle and give React Query a beat to settle. */
export async function settle(page: Page, ms = 1200): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(ms)
}

export { expect }
