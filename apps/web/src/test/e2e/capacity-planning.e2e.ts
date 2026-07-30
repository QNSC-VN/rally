import { expect, test } from '@playwright/test'
import { loginAndSelectProject } from './helpers'

/**
 * Capacity planning (P5.2) — the three-state capacity cell.
 *
 * The behaviour worth driving through a browser is that cell: blank (not entered), an
 * explicit 0, and a real number are three DIFFERENT states in the schema and in every
 * later warning rule. A UI that collapsed blank into 0 would look correct while quietly
 * reporting teams as fully committed.
 *
 * Uses the SEEDED plan (`db/seeds/demo.ts` — "NX Platform v2 capacity", Team Alpha added
 * with capacity NULL) rather than creating one. A release may hold only one plan
 * (`uq_capacity_plan_project_release`), so a test that created its own would consume the
 * project's only unplanned release and fail on its second run — which is exactly what the
 * first draft of this spec did. Plan CREATION is covered by `capacity-plans.e2e.spec.ts`
 * against real SQL, where uniqueness and the CHECK constraints can be asserted directly.
 */
test.describe('Capacity Planning', () => {
  /**
   * The Team Alpha row.
   *
   * Filtered by the team name rather than taking the first `div.group`: the column HEADER
   * cells carry that class too, so `.first()` lands on the "Team" header. The sidebar's
   * Total Capacity is not a `.group` at all, which keeps it out of the way.
   */
  const teamRow = (page: import('@playwright/test').Page) =>
    page.locator('div.group').filter({ hasText: 'Team Alpha' }).first()

  async function openSeededPlan(page: import('@playwright/test').Page) {
    await loginAndSelectProject(page)
    await page.goto('/capacity-planning', { waitUntil: 'domcontentloaded' })
    await page.getByText('NX Platform v2 capacity').click()
    await expect(page).toHaveURL(/\/capacity-planning\/[0-9a-f-]{36}/)
    await expect(page.getByText('Team Alpha').first()).toBeVisible()
  }

  /**
   * Open the capacity editor.
   *
   * `InlineEditableCell` puts its `aria-label` on the EDIT INPUT only — the resting cell is
   * a plain span — so the cell is reached by its visible text and the input by its name.
   */
  async function editCapacity(page: import('@playwright/test').Page) {
    await teamRow(page)
      .getByText(/Not entered|\d/)
      .first()
      .click()
    return page.getByRole('textbox', { name: /^Capacity for / })
  }

  test('sets a capacity, keeps 0 distinct from blank, and clears back to blank', async ({
    page,
  }) => {
    await openSeededPlan(page)

    // Establish the precondition rather than trusting the seeded value: any earlier spec or
    // manual poke that set a capacity would otherwise make this fail for the wrong reason.
    // Clearing is itself the behaviour under test, so this costs nothing.
    const reset = await editCapacity(page)
    await reset.fill('')
    await reset.press('Enter')
    await expect(teamRow(page)).toContainText('Not entered')

    // ── A real value ────────────────────────────────────────────────────────
    let editor = await editCapacity(page)
    await editor.fill('40')
    await editor.press('Enter')
    await expect(teamRow(page)).toContainText('40')
    await expect(teamRow(page)).not.toContainText('Not entered')

    // Persisted, not just held in local state.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(teamRow(page)).toContainText('40')

    // ── Zero is a REAL entered ceiling ──────────────────────────────────────
    editor = await editCapacity(page)
    await editor.fill('0')
    await editor.press('Enter')
    await expect(teamRow(page)).not.toContainText('Not entered')

    // ── Clearing returns to blank, NOT to zero ──────────────────────────────
    // Also restores the seeded state, so re-runs start where this one began.
    editor = await editCapacity(page)
    await editor.fill('')
    await editor.press('Enter')
    await expect(teamRow(page)).toContainText('Not entered')
  })

  test('the plan list renders its columns and the seeded plan', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/capacity-planning', { waitUntil: 'domcontentloaded' })

    await expect(page.getByLabel('Release column', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Unit column', { exact: true })).toBeVisible()
    await expect(page.getByText('NX Platform v2 capacity')).toBeVisible()
    // Unit is fixed at creation and shown per plan.
    await expect(page.getByText('points').first()).toBeVisible()
  })

  test('the create dialog will not offer a release that already has a plan', async ({ page }) => {
    // The seeded release is the project's only one and already carries a plan, so the
    // picker must be empty and say so rather than letting the user submit and take a 409.
    await loginAndSelectProject(page)
    await page.goto('/capacity-planning', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: /Add New/i }).click()
    const dialog = page.getByRole('dialog', { name: 'New Capacity Plan' })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText('Every release in this project already has a plan.'),
    ).toBeVisible()
  })
})
