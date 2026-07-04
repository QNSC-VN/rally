import { test } from '@playwright/test'
import { loginAndSelectProject, settle, expect } from './helpers'

test.describe('P2.3 Iteration Status', () => {
  test('renders selector, metric strip and item list', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/iteration-status')
    await settle(page)

    // Selector label + metric strip labels (metrics come from the read-model).
    await expect(page.getByText('Iteration', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Planned Velocity')).toBeVisible()
    await expect(page.getByText('Defects')).toBeVisible()
    await expect(page.getByText('Tasks')).toBeVisible()
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
    await settle(page, 1500)

    // The new story appears in the iteration's item list.
    await expect(page.getByText(title)).toBeVisible()
  })
})
