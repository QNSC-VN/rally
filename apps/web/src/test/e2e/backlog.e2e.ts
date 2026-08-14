import { test } from '@playwright/test'
import { loginAndSelectProject, settle, expect } from './helpers'

test.describe('P2.1 Backlog Enhancement', () => {
  test('shows owner and release filters, and no iteration filter', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/backlog')
    await settle(page)

    await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible()
    // Filters live behind the collapsible "Filters" toggle (Rally-style) — open it.
    await page.getByRole('button', { name: /Filters/ }).click()
    await expect(page.getByLabel('Filter by owner')).toBeVisible()
    await expect(page.getByLabel('Filter by release')).toBeVisible()
    // No iteration filter, deliberately: the Backlog is unscheduled work only, so every row's
    // Iteration is `Unscheduled` and there is nothing for the control to narrow
    // (`RECONCILED_SOURCE_OF_TRUTH.md:42`). A Release filter still means something — an item can be
    // targeted at a release without being pulled into a sprint.
    await expect(page.getByLabel('Filter by iteration')).toHaveCount(0)
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
    const candidates = ['Completed', 'In Progress', 'Accepted', 'Defined']
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

  test('bulk action bar appears with Delete and Copy actions', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/backlog')
    await settle(page)

    const rowCheckboxes = page.locator('input[aria-label^="Select "]')
    const n = await rowCheckboxes.count()
    test.skip(n === 0, 'No backlog rows to select')

    await rowCheckboxes.first().check()
    await expect(page.getByText(/\d+ item.*selected/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible()
  })

  test('excludes a story that is scheduled into an iteration', async ({ page }) => {
    /**
     * The rule that defines this screen: "Plan > Backlog shows only Story/Defect items whose
     * Iteration is `Unscheduled`" (`RECONCILED_SOURCE_OF_TRUTH.md:42`), which Rally states as "Once
     * the item is scheduled into a release or iteration, it is removed from the Backlog page".
     *
     * This test used to assert the opposite side of the same fixture — that the Backlog rendered
     * `Sprint 25.12` as US-3's iteration NAME rather than a dash. That rule was real, but it can no
     * longer apply here: a scheduled story is not on this page at all, so the Backlog never shows an
     * iteration name. The name-resolution behaviour still matters on Iteration Status and on the item
     * detail, where it is covered.
     *
     * The seeded fixture is what makes this cheap: `Sprint 25.12` holds `US-3`, so a scheduled story
     * exists without this test creating one — and searching for it must find nothing.
     */
    await loginAndSelectProject(page)
    await page.goto('/backlog', { waitUntil: 'domcontentloaded' })
    await settle(page)

    await page.getByRole('searchbox', { name: /Search backlog/i }).fill('Retire the legacy eslint')
    await settle(page, 600)

    // Server-side search over the unscheduled set: the scheduled story is absent, not merely
    // off-page. Asserted through the empty state as well as the row count, so a silently broken
    // search cannot pass this by returning nothing for the wrong reason.
    await expect(
      page.locator('div.group.flex').filter({ hasText: 'Retire the legacy eslint' }),
    ).toHaveCount(0)
    await expect(page.getByText(/No backlog items match your filters/i)).toBeVisible()
  })
})
