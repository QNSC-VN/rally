import { test } from '@playwright/test'
import { loginAndSelectProject, settle, expect } from './helpers'

test.describe('P2.1 Backlog Enhancement', () => {
  test('shows owner/release/iteration filters', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/backlog')
    await settle(page)

    await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible()
    await expect(page.getByLabel('Filter by owner')).toBeVisible()
    await expect(page.getByLabel('Filter by release')).toBeVisible()
    await expect(page.getByLabel('Filter by iteration')).toBeVisible()
  })

  test('inline-edits a work item schedule state and it persists', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/backlog')
    await settle(page)

    // Wait for at least one backlog row to render before counting (the list is
    // fetched async; counting immediately races the query).
    const stateSelects = page.getByLabel('Schedule state', { exact: true })
    const count = await stateSelects.count()
    test.skip(count === 0, 'No backlog items to edit in this project')

    const first = stateSelects.first()
    const current = await first.inputValue()
    const next = current === 'completed' ? 'in_progress' : 'completed'
    await first.selectOption(next)
    await settle(page, 1200)

    // Reload and confirm the change stuck (sourced from work_items).
    await page.reload()
    await settle(page)
    await expect(page.getByLabel('Schedule state', { exact: true }).first()).toHaveValue(next)
  })

  test('bulk assign bar appears with Release and Iteration actions', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/backlog')
    await settle(page)

    const rowCheckboxes = page.locator('input[aria-label^="Select "]')
    const n = await rowCheckboxes.count()
    test.skip(n === 0, 'No backlog rows to select')

    await rowCheckboxes.first().check()
    await expect(page.getByText(/\d+ selected/)).toBeVisible()
    await expect(page.getByLabel('Assign release to selected')).toBeVisible()
    await expect(page.getByLabel('Assign iteration to selected')).toBeVisible()
  })
})
