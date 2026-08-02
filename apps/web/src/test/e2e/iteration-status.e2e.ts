import { test } from '@playwright/test'

import { expect, loginAndSelectProject, settle } from './helpers'

/**
 * Iteration Status, as ONE journey: the page renders its strip and grid, then a row is blocked, given
 * a reason, and unblocked again.
 *
 * Merged with `blocked-reason-inline-edit`, which paid its own login to reach this same page. The
 * blocked-reason flow implies the page rendered, so asserting both in sequence costs one navigation
 * instead of two and reads as something a user actually does.
 *
 * The milestone cell's shared multi-select — also on this page — lives in `releases-milestones.e2e.ts`
 * with the rest of that surface. Creating a Story into the selected iteration is the golden journey's
 * job, which also proves it reaches the Backlog.
 */

/**
 * Scroll the grid to its right edge.
 *
 * Blocked and Blocked Reason are the last columns, and Playwright's auto-scroll acts on the ELEMENT it
 * is about to touch — which does nothing while the cell sits outside a horizontally scrolling
 * container. Found by geometry rather than a test id: the container is whichever div actually
 * overflows, so a layout change cannot silently point this at the wrong node.
 */
async function scrollGridRight(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      (d) => d.scrollWidth > d.clientWidth + 50 && getComputedStyle(d).overflowX !== 'visible',
    )
    if (el) el.scrollLeft = el.scrollWidth
  })
  await page.waitForTimeout(400)
}

test.describe('Iteration Status', () => {
  test('renders the metric strip, then blocks a row, gives a reason, and unblocks it', async ({
    page,
  }) => {
    await loginAndSelectProject(page)
    await page.goto('/iteration-status', { waitUntil: 'domcontentloaded' })
    await settle(page)

    // ── The strip ───────────────────────────────────────────────────────────
    // Metrics come from the read-model and land after the iteration list resolves, so the first label
    // gets a generous wait and the rest are then present synchronously. `.first()` because some labels
    // also appear as column headers. Text is upper-cased in CSS, so the DOM stays mixed-case.
    await expect(page.getByText('Planned Velocity').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Iteration End').first()).toBeVisible()
    await expect(page.getByText('Defects').first()).toBeVisible()
    await expect(page.getByText('Tasks').first()).toBeVisible()

    // ── Blocked + reason: the inline-edit gating rule ────────────────────────
    await scrollGridRight(page)

    // Start from a known-unblocked state. Unblocking clears the reason server-side, so this loop also
    // removes whatever a previous run left behind — no separate cleanup step.
    for (const unblock of await page.getByTitle('Blocked - Click to Unblock').all()) {
      await unblock.click().catch(() => {})
      await page.waitForTimeout(200)
    }

    await page.getByTitle('Unblocked - Click to Block').first().click()
    await page.waitForTimeout(500)

    // The reason is editable only once the row is BLOCKED — that gating is the rule under test.
    const addReason = page.getByText('Add reason…').first()
    await expect(addReason).toBeVisible()
    await addReason.click()
    const input = page.getByRole('textbox', { name: 'Blocked reason' })
    await expect(input).toBeVisible()
    await input.fill('Waiting on infra provisioning')
    await input.press('Enter')
    await expect(page.getByText('Waiting on infra provisioning')).toBeVisible()

    // Unblocking CLEARS the reason — the behaviour, and the fixture restore, in one step.
    await page.getByTitle('Blocked - Click to Unblock').first().click()
    await expect(page.getByTitle('Unblocked - Click to Block').first()).toBeVisible()
    await expect(page.getByText('Waiting on infra provisioning')).toHaveCount(0)

    // Still gone after a reload: the server cleared the column, the client did not merely hide it.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(page)
    await scrollGridRight(page)
    await expect(page.getByText('Waiting on infra provisioning')).toHaveCount(0)
  })
})
