import { expect, test } from '@playwright/test'
import { loginAndSelectProject } from './helpers'

/**
 * Capacity allocation (P5.2 slice 5) — the allocate loop and the tier badge.
 *
 * Works on the SEEDED plan ("NX Platform v2 capacity", Team Alpha) and cleans up after
 * itself, so it is repeatable: a release may hold only one plan, so a test that created its
 * own would consume the project's only unplanned release.
 *
 * The tier badge is the piece most worth driving through a browser. The same number means
 * different things depending on where it came from — a committed allocation, a top-down
 * refined estimate, or a T-shirt size mapped by workspace settings — and the badge is the
 * only thing on screen that says which.
 */
test.describe('Capacity allocation', () => {
  /** Click the first option in an open `SearchableSelect` (a Radix popover of buttons). */
  async function pickOption(page: import('@playwright/test').Page, label: string | RegExp) {
    const popover = page.locator('[data-radix-popper-content-wrapper]')
    await popover.waitFor()
    await popover.getByRole('button', { name: label }).first().click()
  }

  async function openPlan(page: import('@playwright/test').Page) {
    await loginAndSelectProject(page)
    await page.goto('/capacity-planning', { waitUntil: 'domcontentloaded' })
    await page.getByText('NX Platform v2 capacity').click()
    await expect(page).toHaveURL(/\/capacity-planning\/[0-9a-f-]{36}/)
    await expect(page.getByText('Team Alpha').first()).toBeVisible()
  }

  test('allocates a Feature to a team, shows its tier, then removes it', async ({ page }) => {
    await openPlan(page)

    // ── Allocate ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Allocate', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Allocate a Feature' })
    await expect(dialog).toBeVisible()

    // The picker offers only Features (an Epic has no children of its own to roll up).
    await dialog.getByLabel('Feature').click()
    await pickOption(page, /FE-1/)

    await dialog.getByLabel('Team').click()
    await pickOption(page, /Team Alpha/)

    // Leave Estimate blank to exercise the server default: Refined → Preliminary, never the
    // total already allocated.
    await dialog.getByRole('button', { name: 'Allocate', exact: true }).click()
    await expect(dialog).toBeHidden()

    // ── The allocated row appears under its team, with a tier badge ──────────
    const row = page.locator('div.group').filter({ hasText: 'Guest checkout flow' }).first()
    await expect(row).toBeVisible()
    // FE-1 is seeded with preliminary 'm' and no refined estimate, so a blank Estimate
    // resolves to the preliminary mapping — and once committed the tier reads ALLOC.
    await expect(row.getByText(/Alloc|Prelim/)).toBeVisible()

    // Survives a reload: the allocation was persisted, not just held in cache.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(
      page.locator('div.group').filter({ hasText: 'Guest checkout flow' }).first(),
    ).toBeVisible()

    // ── Remove it, restoring the seeded state for the next run ───────────────
    await page
      .getByRole('button', { name: /Remove the allocation for FE-1/ })
      .first()
      .click()
    await expect(page.getByText('Guest checkout flow')).toHaveCount(0)
  })

  test('publishes the plan, reports what it wrote, then reverts without undoing it', async ({
    page,
  }) => {
    // The riskiest action in Phase 5 driven end to end, on the SEEDED plan. Cleans up after
    // itself in both directions — the allocation is removed and the plan is returned to draft —
    // because a release holds only one plan, so a test that created its own would consume the
    // project's only unplanned release.
    await openPlan(page)

    // Allocate FE-1 to Team Alpha so there is something to publish.
    await page.getByRole('button', { name: 'Allocate', exact: true }).first().click()
    const allocate = page.getByRole('dialog', { name: 'Allocate a Feature' })
    await allocate.getByLabel('Feature').click()
    await pickOption(page, /FE-1/)
    await allocate.getByLabel('Team').click()
    await pickOption(page, /Team Alpha/)
    await allocate.getByRole('button', { name: 'Allocate', exact: true }).click()
    await expect(allocate).toBeHidden()

    // ── Publish ──────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: /Publish this plan/i })
    // The three things a planner has to know BEFORE the write: what lands, when the Release
    // lands, and that reverting will not undo it.
    await expect(dialog.getByText(/planned start and end dates/)).toBeVisible()
    await expect(dialog.getByText(/does NOT undo these field values/)).toBeVisible()
    // Rally's second option is offered alongside, not hidden behind a checkbox.
    await expect(
      dialog.getByRole('button', { name: 'Publish without updating fields' }),
    ).toBeVisible()

    await dialog.getByRole('button', { name: 'Publish and update fields' }).click()
    await expect(dialog).toBeHidden()

    // Published plans are read-only, so the editing affordances go away.
    await expect(page.getByRole('button', { name: 'Allocate', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Revert to draft' })).toBeVisible()

    // ── The Feature really took the plan's window ────────────────────────────
    // Read from the Portfolio detail rather than the plan, which is the whole point: the
    // publish wrote to a row on another page. The seeded plan mirrors its release's window.
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' })
    await page.getByRole('searchbox', { name: /Search portfolio/i }).fill('Guest checkout flow')
    await page.getByText('FE-1', { exact: true }).click()
    await expect(page).toHaveURL(/\/portfolio\/[0-9a-f-]{36}/)
    await expect(page.getByText('2026-07-01')).toBeVisible()
    await expect(page.getByText('v2.0 — NX Platform Upgrade')).toBeVisible()

    // ── Revert, which does NOT roll the fields back ──────────────────────────
    await page.goBack()
    await page.goto('/capacity-planning', { waitUntil: 'domcontentloaded' })
    await page.getByText('NX Platform v2 capacity').click()
    await page.getByRole('button', { name: 'Revert to draft' }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm.getByText(/are NOT undone/)).toBeVisible()
    await confirm.getByRole('button', { name: 'Revert to draft' }).click()

    // Editable again.
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()

    // Clean up: remove the allocation, restoring the seeded state. The Feature KEEPS the
    // release and dates the publish wrote, which is Rally's behaviour and is what the backend
    // e2e asserts against real SQL.
    await page
      .getByRole('button', { name: /Remove the allocation for FE-1/ })
      .first()
      .click()
    await expect(page.getByText('Guest checkout flow')).toHaveCount(0)
  })

  test('parks demand in the Unallocated bucket when no team is chosen', async ({ page }) => {
    await openPlan(page)

    await page.getByRole('button', { name: 'Allocate', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Allocate a Feature' })
    await dialog.getByLabel('Feature').click()
    await pickOption(page, /FE-2/)
    // Team defaults to "Unallocated", so submit without choosing one.
    await dialog.getByRole('button', { name: 'Allocate', exact: true }).click()
    await expect(dialog).toBeHidden()

    // The bucket header appears only when it holds something.
    await expect(page.getByText('Unallocated').first()).toBeVisible()
    await expect(page.getByText('Saved payment methods')).toBeVisible()

    // Clean up.
    await page
      .getByRole('button', { name: /Remove the allocation for FE-2/ })
      .first()
      .click()
    await expect(page.getByText('Saved payment methods')).toHaveCount(0)
  })
})
