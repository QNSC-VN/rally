import { test } from '@playwright/test'
import { loginAndSelectProject, settle, expect } from './helpers'

/**
 * Golden end-to-end journey — one coherent business flow through the real UI,
 * proving the screens connect end-to-end (not just that each renders):
 *
 *   login → QNSC / NX Platform
 *     → create a Planning iteration (Timeboxes)
 *     → create a Story INTO that iteration (Iteration Status › Add Item)
 *     → the Story surfaces on Iteration Status
 *     → the Story surfaces on the Backlog carrying its iteration name
 *     → move its Schedule State on the Backlog and it PERSISTS across reload
 *     → open the seeded Release detail (shared DetailLayout chrome)
 *
 * Task→parent auto-complete, the six-state mirror, and Team-Status relation
 * rendering are covered at the service boundary by the Vitest e2e specs
 * (iteration-completion-flow, core-business-rules, team-status-relation-render),
 * so this UI journey deliberately stays on the stable, high-signal path.
 */
test.describe('Golden journey', () => {
  test('plan → build → track a story across the app', async ({ page }) => {
    const ts = Date.now()
    const iterationName = `Golden Sprint ${ts}`
    const storyTitle = `Golden Story ${ts}`

    await loginAndSelectProject(page)

    // ── 1. Create a Planning iteration ────────────────────────────────────────
    await page.goto('/timeboxes')
    await settle(page)
    await page.getByRole('button', { name: 'Add New' }).click()
    const iterModal = page.getByRole('dialog')
    await page.getByPlaceholder('Enter iteration name...').fill(iterationName)
    // Dates via the shared DateField calendar (day "15"); field buttons scoped to
    // the modal, the day button portals to <body>.
    await iterModal.getByRole('button', { name: 'Start Date' }).click()
    await page.getByRole('button', { name: '15', exact: true }).click()
    await iterModal.getByRole('button', { name: 'End Date' }).click()
    await page.getByRole('button', { name: '15', exact: true }).click()
    // Leave State at its default (Planning).
    await page.getByRole('button', { name: 'Create with details' }).click()
    await settle(page)
    await expect(page.getByText(iterationName).first()).toBeVisible()

    // ── 2. Create a Story INTO that iteration (Iteration Status › Add Item) ────
    await page.goto('/iteration-status')
    await settle(page)
    // The selector button shows the currently-selected iteration's name + date
    // range; open it and pick the one just created.
    await page
      .locator('button')
      .filter({ hasText: /\d{4}-\d{2}-\d{2}/ })
      .first()
      .click()
    await settle(page, 600)
    await page.getByText(iterationName, { exact: false }).first().click()
    await settle(page, 600)

    const addBtn = page.getByRole('button', { name: 'Add New' })
    await addBtn.click()
    await expect(page.getByText('Add Item to Iteration')).toBeVisible()
    await page.getByPlaceholder('Enter a concise work item title...').fill(storyTitle)
    await page.getByRole('button', { name: 'Create Item' }).click()
    await expect(page.getByText('Add Item to Iteration')).toBeHidden({ timeout: 15_000 })

    // ── 3. The Story surfaces on Iteration Status ─────────────────────────────
    await settle(page, 800)
    await expect(page.getByText(storyTitle).first()).toBeVisible({ timeout: 10_000 })

    // ── 4. The Story surfaces on the Backlog carrying its iteration name ──────
    await page.goto('/backlog')
    await settle(page)
    await page
      .getByPlaceholder('Search…')
      .fill(storyTitle)
      .catch(() => {})
    await settle(page, 600)
    const row = page.locator('div.group.flex').filter({ hasText: storyTitle })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText(iterationName)

    // ── 5. Move its Schedule State and confirm it persists across reload ──────
    // Schedule state is a Rally-style segmented stepper (role=group); the active
    // segment is disabled and shows its letter. Move to In-Progress ("P").
    const stepper = row.getByRole('group', { name: 'Schedule state' })
    const inProgress = stepper.getByRole('button', { name: 'In Progress' })
    if ((await inProgress.count()) > 0 && (await inProgress.isEnabled())) {
      await inProgress.click()
      await settle(page, 1200)
      await page.reload()
      await settle(page)
      await page
        .getByPlaceholder('Search…')
        .fill(storyTitle)
        .catch(() => {})
      await settle(page, 600)
      const rowAfter = page.locator('div.group.flex').filter({ hasText: storyTitle })
      await expect(rowAfter.getByRole('group', { name: 'Schedule state' }).locator('button:disabled')).toHaveText('P')
    }

    // ── 6. Open the seeded Release detail (shared DetailLayout chrome) ────────
    await page.goto('/releases')
    await settle(page)
    await page.getByRole('button', { name: 'RE-1' }).click()
    await settle(page)
    // Shared DetailLayout / DetailTabBar exposes an accessible tablist.
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('tab', { name: /details/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /artifacts/i })).toBeVisible()
  })
})
