import { test } from '@playwright/test'
import { loginAndSelectProject, settle, expect } from './helpers'

/**
 * Regression guard: Backlog resolved the Iteration column display through the
 * same endpoint that powers the assignment dropdown, which is (correctly)
 * restricted to Planning/Committed iterations. Reusing it for display meant a
 * work item whose iteration had since become Accepted — the normal terminal
 * state per the reconciled Iteration lifecycle — silently rendered "—" even
 * though the relation was genuinely set. See RELATION_DATA_TRACEABILITY.md.
 */
test.describe('Backlog relation display', () => {
  test('shows the Iteration name for a work item whose iteration is Accepted', async ({ page }) => {
    await loginAndSelectProject(page)

    // Create an Iteration directly in the Accepted state.
    const iterationName = `E2E Accepted Iter ${Date.now()}`
    await page.goto('/timeboxes')
    await settle(page)
    await page.getByRole('button', { name: 'Create Iteration' }).click()
    await page.getByPlaceholder('Enter iteration name...').fill(iterationName)
    await page.locator('input[type="date"]').first().fill('2026-08-01')
    await page.locator('input[type="date"]').nth(1).fill('2026-08-14')
    await page.getByLabel('State', { exact: true }).selectOption('accepted')
    await page.getByRole('button', { name: 'Create with details' }).click()
    await settle(page)
    await expect(page.getByRole('heading', { name: iterationName })).toBeVisible()

    // Create a Story directly INTO that iteration via Iteration Status's Add
    // Item — the Backlog quick-create's Iteration assignment dropdown is (by
    // design, post-fix) restricted to Planning/Committed, so it cannot select
    // an Accepted iteration; Add Item assigns to whatever iteration is
    // selected regardless of its state.
    await page.goto('/iteration-status')
    await settle(page)
    // Open the iteration selector dropdown (button shows whatever iteration is
    // currently selected — not necessarily the one just created) and pick ours.
    // The selector button's accessible name is the currently-selected
    // iteration's own name + date range (e.g. "Sprint 25.4 2026-06-02 -
    // 2026-06-13") — whatever that happens to be, clicking it opens the
    // dropdown listing every iteration, including the Accepted one just made.
    await page
      .locator('button')
      .filter({ hasText: /\d{4}-\d{2}-\d{2}/ })
      .first()
      .click()
    await settle(page, 600)
    await page.getByText(iterationName, { exact: false }).first().click()
    await settle(page, 600)

    const addBtn = page.getByRole('button', { name: 'Add New' })
    test.skip(
      !(await addBtn.isVisible().catch(() => false)),
      'No create permission on this iteration',
    )
    await addBtn.click()
    await expect(page.getByText('Add Item to Iteration')).toBeVisible()
    const title = `E2E Backlog Item ${Date.now()}`
    await page.getByPlaceholder('Enter a concise work item title...').fill(title)
    await page.getByRole('button', { name: 'Create Item' }).click()
    await expect(page.getByText('Add Item to Iteration')).toBeHidden({ timeout: 15_000 })

    // Back to Backlog — the row must show the Accepted iteration's NAME, not "—".
    await page.goto('/backlog')
    await settle(page)
    await page
      .getByPlaceholder('Search…')
      .fill(title)
      .catch(() => {})
    await settle(page, 600)

    const row = page.locator('div.group.flex').filter({ hasText: title })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText(iterationName)

    // Reload — the resolved name must survive a fresh fetch, not just the
    // optimistic cache from the create above.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(page)
    const rowAfterReload = page.locator('div.group.flex').filter({ hasText: title })
    await expect(rowAfterReload).toContainText(iterationName)
  })
})
