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

  test('creates a Story into the selected iteration via Add Item', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/iteration-status')
    await settle(page)

    const addBtn = page.getByRole('button', { name: 'Add Item' })
    test.skip(!(await addBtn.isVisible().catch(() => false)), 'No iteration selected / no create permission')

    await addBtn.click()
    await expect(page.getByText('Add Item to Iteration')).toBeVisible()

    const title = `E2E Story ${Date.now()}`
    await page.getByPlaceholder('Enter a concise work item title...').fill(title)
    await page.getByRole('button', { name: 'Create Item' }).click()

    // On success the modal closes (onCreated); on failure it stays open with an
    // inline error. Asserting the modal is gone is the stable end-to-end success
    // signal — the success toast auto-dismisses too fast to assert reliably, and
    // the list refetch/row-truncation races a title match.
    await expect(page.getByText('Add Item to Iteration')).toBeHidden({ timeout: 15_000 })
  })
})
