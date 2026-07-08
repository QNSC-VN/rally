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

    // Assert on the success toast — it fires only after the API create succeeds,
    // so it proves the end-to-end create flow (auth → permission → persist). This
    // is more reliable than scanning the list, whose async refetch + row
    // truncation can race the assertion.
    await expect(page.getByText(/added to iteration/i)).toBeVisible({ timeout: 15_000 })
  })
})
