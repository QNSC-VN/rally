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
    // `<Column> filter value` since the banner became `Manage Filters` (P2-BL-FR-005/020): every
    // control is now generated from one field list, and its accessible name comes from the SAME
    // `COLUMN_LABELS` entry as the grid header — so a filter cannot be labelled differently from the
    // column it filters. These two are `defaultVisible`, which is what this test is asserting.
    await expect(page.getByLabel('Owner filter value')).toBeVisible()
    await expect(page.getByLabel('Release filter value')).toBeVisible()
    // No iteration filter, deliberately, and now enforced by the field list rather than by omission:
    // the Backlog is unconditionally `iteration_id IS NULL`, so the control could only ever return
    // everything or nothing (`RECONCILED_SOURCE_OF_TRUTH.md:42`). A Release filter still means
    // something — an item can be targeted at a release without being pulled into a sprint. Checked
    // with the chooser OPEN, because a column that is merely not `defaultVisible` would pass a
    // closed-banner check while still being offerable.
    await page.getByRole('button', { name: 'Manage Filters' }).click()
    await expect(page.getByLabel('Filter by Iteration')).toHaveCount(0)
    await expect(page.getByLabel('Iteration filter value')).toHaveCount(0)
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

  test('deletes a work item from the ROW, after a confirmation', async ({ page }) => {
    /**
     * `P2-BL-FR-022` and §124: "Delete Defect | Row or detail action with confirmation".
     *
     * The verb existed before this control, but only in the bulk bar — which appears once rows are
     * SELECTED — and on the record's own detail page. Neither is the row, which is why the BA reported
     * "cannot delete work item in Backlog" while `work-item-delete-route.e2e.spec.ts` was proving the
     * route deletes fine.
     *
     * CREATES its own row and deletes that one. Deleting a seeded row would consume a fixture other
     * specs read — the leak this suite's own notes warn about — and creating first also proves the two
     * halves of the flow line up: the item this grid just added is the item this grid can remove.
     */
    await loginAndSelectProject(page)
    await page.goto('/backlog')
    await settle(page)

    const title = `E2E Row Delete ${Date.now()}`
    await page.getByRole('button', { name: 'Add New' }).click()
    // Matched on the visible label and the Title field, like the golden journey does, so a copy edit
    // cannot silently retarget this at the other create modal.
    await expect(page.getByText('New Work Item')).toBeVisible()
    await page.getByLabel(/^Title/).fill(title)
    await page.getByRole('button', { name: 'Create Item' }).click()
    await settle(page, 1200)
    // `.first()`: creating also SELECTS the row, so the title renders in the grid and again in the
    // summary panel beside it.
    await expect(page.getByText(title).first()).toBeVisible()

    /**
     * The row's own menu, scoped to THIS row — every row renders one, hidden until hover, so an
     * unscoped locator would be a coin toss. `group` is the class the hover reveal keys off, which
     * makes it the row element by construction.
     */
    const row = page.locator('[class*="group"]').filter({ hasText: title }).first()
    await row.hover()
    await row.getByRole('button', { name: /^Actions for / }).click()
    await page.getByText('Delete', { exact: true }).click()

    // The confirmation is the gate (§371: cancelling makes no change).
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await settle(page, 1200)

    // Gone from the ACTIVE list — a soft delete is invisible, not erased (P3-QA-FR-020). Counted,
    // not `toBeHidden`: the summary panel copy also carried the title, so "no node at all" is the
    // assertion that means the row left the grid.
    await expect(page.getByText(title)).toHaveCount(0)
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

/**
 * The in-app Back arrow returns the reader WHERE THEY CAME FROM, not to a fixed list.
 *
 * Every detail page hardcoded its own list route in `onBack`, so `/item/$itemKey` went to `/backlog`
 * no matter the origin. Measured in a browser before the fix: opening an item from Home > My Work, from
 * Iteration Status and from Quality > Defects all landed on the Backlog — a third place, with different
 * filters, and from Home (a cross-project surface) a project-scoped grid the reader never chose.
 *
 * Home is the origin under test because it is the one where the old destination was most wrong AND the
 * one the report named. `/backlog` as an origin would pass either way, which is why it is not the case.
 */
test.describe('leaving a work-item detail', () => {
  test('the Back arrow returns to the surface the item was opened from', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/')
    await settle(page)

    // My Work's ID column opens the item detail.
    const idCell = page
      .locator('button')
      .filter({ has: page.locator('span.font-mono') })
      .first()
    await expect(idCell).toBeVisible()
    await idCell.click()
    await settle(page)
    await expect(page).toHaveURL(/\/item\//)

    await page.getByRole('button', { name: 'Back' }).click()
    await settle(page)
    // Home, not `/backlog`.
    await expect(page).toHaveURL(/\/$/)
  })
})
