import { test } from '@playwright/test'
import { loginAndSelectProject, settle, expect } from './helpers'

/**
 * Header search — SHELL-FR-009's "global search entry".
 *
 * It shipped as an input bound to nothing: typing did nothing and Enter did nothing, on every
 * screen. A Playwright test is the only place that failure was visible, because the control
 * RENDERED correctly — every unit assertion about it would have passed.
 */
test.describe('P0 Header search', () => {
  test('finds a work item by title and opens it', async ({ page }) => {
    await loginAndSelectProject(page)
    await settle(page)

    // `US-3` is seeded as "Retire the legacy eslint…" and is scheduled into Sprint 25.12 — so it is
    // NOT on the Backlog. The header must still find it: it searches the whole project, deliberately
    // not the unscheduled-only backlog list.
    await page.getByRole('searchbox', { name: /Search work items/i }).fill('Retire the legacy')
    await settle(page, 800)

    const row = page.getByRole('link').filter({ hasText: 'Retire the legacy' }).first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()
    await settle(page)

    // Landed on the item detail, which is the whole point of the entry.
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 15_000 })
  })

  test('treats an exact item key as an address', async ({ page }) => {
    await loginAndSelectProject(page)
    await settle(page)

    // Item keys are workspace-unique, so a key is resolved server-side rather than searched for.
    await page.getByRole('searchbox', { name: /Search work items/i }).fill('US-3')
    await settle(page, 500)
    await page.getByRole('searchbox', { name: /Search work items/i }).press('Enter')
    await settle(page)

    await expect(page).toHaveURL(/\/item\/US-3/i)
  })

  test('says so when nothing matches', async ({ page }) => {
    await loginAndSelectProject(page)
    await settle(page)

    await page
      .getByRole('searchbox', { name: /Search work items/i })
      .fill('zzz-no-such-item-anywhere')
    await settle(page, 800)
    await expect(page.getByText(/No matching work items/i)).toBeVisible()
  })
})
