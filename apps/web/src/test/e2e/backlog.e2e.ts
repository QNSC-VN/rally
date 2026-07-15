import { test } from '@playwright/test'
import { loginAndSelectProject, settle, expect } from './helpers'

test.describe('P2.1 Backlog Enhancement', () => {
  test('shows owner/release/iteration filters', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/backlog')
    await settle(page)

    await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible()
    // Filters live behind the collapsible "Filters" toggle (Rally-style) — open it.
    await page.getByRole('button', { name: /Filters/ }).click()
    await expect(page.getByLabel('Filter by owner')).toBeVisible()
    await expect(page.getByLabel('Filter by release')).toBeVisible()
    await expect(page.getByLabel('Filter by iteration')).toBeVisible()
  })

  test('inline-edits a work item schedule state and it persists', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/backlog')
    await settle(page)

    // Schedule state renders as a Rally-style segmented stepper (role=group):
    // one button per state, the active one disabled and showing its letter.
    const steppers = page.getByRole('group', { name: 'Schedule state' })
    const count = await steppers.count()
    test.skip(count === 0, 'No backlog items to edit in this project')

    const stepper = steppers.first()
    // Pick a target segment that isn't the current one (current is disabled, and
    // its accessible name is the letter — not the label — so it won't match here).
    const candidates = ['Completed', 'In Progress', 'Accepted', 'Ready', 'Defined']
    let targetLabel = ''
    for (const label of candidates) {
      const btn = stepper.getByRole('button', { name: label })
      if ((await btn.count()) > 0 && (await btn.isEnabled())) {
        targetLabel = label
        break
      }
    }
    test.skip(targetLabel === '', 'No alternate schedule state available on the first row')

    const targetLetter = targetLabel === 'In Progress' ? 'P' : targetLabel[0]
    await stepper.getByRole('button', { name: targetLabel }).click()
    await settle(page, 1200)

    // Reload and confirm the change stuck (sourced from work_items): the first
    // row's active (disabled) segment now shows the target state's letter.
    await page.reload()
    await settle(page)
    await expect(
      page.getByRole('group', { name: 'Schedule state' }).first().locator('button:disabled'),
    ).toHaveText(targetLetter)
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
