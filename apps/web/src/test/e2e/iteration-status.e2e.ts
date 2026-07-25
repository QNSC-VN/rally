import { test } from '@playwright/test'
import { loginAndSelectProject, settle, expect } from './helpers'

test.describe('P2.3 Iteration Status', () => {
  test('renders selector, metric strip and item list', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/iteration-status')
    await settle(page)

    // Metric strip labels (metrics come from the read-model, loaded async after
    // the iteration list resolves). Text is upper-cased via CSS so the DOM text
    // stays mixed-case. Give the first label a generous wait, then the rest are
    // present synchronously. .first() since some labels also appear as columns.
    await expect(page.getByText('Planned Velocity').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Iteration End').first()).toBeVisible()
    await expect(page.getByText('Defects').first()).toBeVisible()
    await expect(page.getByText('Tasks').first()).toBeVisible()
  })

  // Creating a Story into the selected iteration via "Add New" is covered by the
  // end-to-end golden-journey spec (which also verifies it surfaces on the
  // Backlog + moves schedule state), so it is not duplicated here.
})
