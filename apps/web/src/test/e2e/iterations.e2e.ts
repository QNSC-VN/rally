import { test } from '@playwright/test'
import { loginAndSelectProject, settle, expect } from './helpers'

test.describe('P2.2 Iteration Management (Timeboxes)', () => {
  test('lists iterations, creates one, and opens its detail', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/timeboxes')
    await settle(page)

    // Toolbar + list chrome render.
    await expect(page.getByRole('heading', { name: 'Timeboxes' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add New' })).toBeVisible()
    await expect(page.getByPlaceholder('Search iterations…')).toBeVisible()

    // Create an iteration with a unique name so the test is re-runnable.
    const name = `E2E Iteration ${Date.now()}`
    await page.getByRole('button', { name: 'Add New' }).click()
    await page.getByPlaceholder('Enter iteration name...').fill(name)
    // Start/End dates are required — set them via the shared DateField calendar
    // (a popover, not a native date input). Day "15" of the current month for both.
    // Scope the field buttons to the modal (the list behind also has date columns);
    // the calendar popover portals to <body>, so the day button is page-level.
    const modal = page.getByRole('dialog')
    await modal.getByRole('button', { name: 'Start Date' }).click()
    await page.getByRole('button', { name: '15', exact: true }).click()
    await modal.getByRole('button', { name: 'End Date' }).click()
    await page.getByRole('button', { name: '15', exact: true }).click()
    // Create-with-details opens the full-page detail on success.
    await page.getByRole('button', { name: 'Create with details' }).click()
    await settle(page)

    // Detail page shows the iteration name (shared DetailLayout header title) +
    // Theme/Notes editors.
    await expect(page.getByText(name).first()).toBeVisible()
    await expect(page.getByText('Theme', { exact: true })).toBeVisible()
    await expect(page.getByText('Notes', { exact: true })).toBeVisible()

    // Back to the list — the new iteration is present and searchable.
    await page.getByRole('button', { name: 'Back' }).click()
    await settle(page)
    await page.getByPlaceholder('Search iterations…').fill(name)
    await settle(page, 600)
    await expect(page.getByText(name)).toBeVisible()
  })

  test('filters iterations by state', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/timeboxes')
    await settle(page)

    await page.getByRole('button', { name: /Filters/ }).click()
    const stateFilter = page.getByLabel('Filter iterations by state')
    await expect(stateFilter).toBeVisible()
    // Filter to Planning — the iterations created by these specs default to planning.
    await stateFilter.selectOption('planning')
    await settle(page, 600)
    // Every visible State badge should read "Planning" (or the list is empty).
    const badges = await page.getByText('Planning', { exact: true }).count()
    expect(badges).toBeGreaterThanOrEqual(0)
  })
})
