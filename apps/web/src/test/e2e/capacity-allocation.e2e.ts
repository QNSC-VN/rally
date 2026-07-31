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

  /** The seeded team's row. `.first()` avoids the column header, which shares `.group`. */
  const teamRow = (page: import('@playwright/test').Page) =>
    page.locator('div.group').filter({ hasText: 'Team Alpha' }).first()

  /**
   * Disclose a team's allocated Features.
   *
   * Rally collapses them by default, so every assertion about an allocation row has to open its
   * team first. Idempotent: if it is already open the toggle reads "Collapse…" and this is a
   * no-op rather than a close.
   */
  async function expandTeam(page: import('@playwright/test').Page, team = 'Team Alpha') {
    const collapse = page.getByRole('button', {
      name: new RegExp(`Collapse the Features allocated to ${team}`),
    })
    if (await collapse.count()) return // already open

    const expand = page.getByRole('button', {
      name: new RegExp(`Expand the Features allocated to ${team}`),
    })
    // Waited for, then confirmed: the row re-renders when the allocate mutation refetches, so a
    // fire-and-forget click can land on a node that is about to unmount and do nothing at all.
    await expect(expand).toBeVisible()
    await expand.click()
    await expect(collapse).toBeVisible()
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
    await expandTeam(page)
    const row = page.locator('div.group').filter({ hasText: 'Guest checkout flow' }).first()
    await expect(row).toBeVisible()
    // FE-1 is seeded with preliminary 'm' and no refined estimate, so a blank Estimate
    // resolves to the preliminary mapping — and once committed the tier reads ALLOC.
    await expect(row.getByText(/Alloc|Prelim/)).toBeVisible()

    // Survives a reload: the allocation was persisted, not just held in cache. Expansion is
    // local state, so the reload collapses the team again — reopen it.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expandTeam(page)
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

  test('draws the cutline where the team runs out of capacity', async ({ page }) => {
    // Rally's line: Features in rank order, above it fits, below it does not. Needs a real
    // capacity AND two Features that straddle it, so this builds both and puts the seeded plan
    // back the way it found it.
    await openPlan(page)

    // A capacity small enough that the second Feature cannot fit.
    const capacityCell = teamRow(page)
      .getByText(/Not entered|^\d+ points$|^\d+$/)
      .last()
    await capacityCell.click()
    const editor = page.getByRole('textbox', { name: /^Capacity for / })
    await editor.fill('5')
    await editor.press('Enter')
    await expect(teamRow(page)).toContainText('5')

    for (const feature of [/FE-1/, /FE-2/]) {
      await page.getByRole('button', { name: 'Allocate', exact: true }).first().click()
      const dialog = page.getByRole('dialog', { name: 'Allocate a Feature' })
      await dialog.getByLabel('Feature').click()
      await pickOption(page, feature)
      await dialog.getByLabel('Team').click()
      await pickOption(page, /Team Alpha/)
      // 4 points each: the first fits inside 5, the second cannot.
      await dialog.getByLabel('Estimate').fill('4')
      await dialog.getByRole('button', { name: 'Allocate', exact: true }).click()
      await expect(dialog).toBeHidden()
    }

    // The cutline lives on the ITEMS tab, against the PLAN's total capacity — Rally draws it
    // there and nowhere else. The Teams tab must not show one.
    await expect(page.getByRole('separator', { name: /Capacity cutline/i })).toHaveCount(0)

    await page.getByRole('tab', { name: /Items/ }).click()
    await expect(page.getByRole('separator', { name: /Capacity cutline/i })).toBeVisible()
    // Exactly one Feature is marked as not fitting — the second.
    await expect(page.locator('[data-below-cutline="true"]')).toHaveCount(1)

    // Survives a reload: the index came from the API, not from local state.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: /Items/ }).click()
    await expect(page.getByRole('separator', { name: /Capacity cutline/i })).toBeVisible()
    // Back to Teams, where the allocations are removed.
    await page.getByRole('tab', { name: /Teams/ }).click()

    // ── Restore the seeded state ─────────────────────────────────────────────
    await expandTeam(page)
    for (const key of ['FE-1', 'FE-2']) {
      await page
        .getByRole('button', { name: new RegExp(`Remove the allocation for ${key}`) })
        .first()
        .click()
    }
    const reset = await (async () => {
      await teamRow(page)
        .getByText(/Not entered|^\d+ points$|^\d+$/)
        .last()
        .click()
      return page.getByRole('textbox', { name: /^Capacity for / })
    })()
    await reset.fill('')
    await reset.press('Enter')
    await expect(teamRow(page)).toContainText('Not entered')
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
    await expandTeam(page)
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

    // The bucket header appears only when it holds something. Unallocated rows are NOT behind a
    // team's disclosure — they have no team to sit under.
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
