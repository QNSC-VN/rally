import { test, expect } from '@playwright/test'

import { loginAndSelectProject } from './helpers'

async function scrollGridRight(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      (d) => d.scrollWidth > d.clientWidth + 50 && getComputedStyle(d).overflowX !== 'visible',
    )
    if (el) el.scrollLeft = el.scrollWidth
  })
  await page.waitForTimeout(400)
}

/**
 * Blocked Reason: editable while blocked, and CLEARED by unblocking.
 *
 * Rally: "When a blocked status is removed, the Blocked Reason field is cleared." The server
 * enforces it (`clearReasonOnUnblock`), which is also what makes this spec repeatable —
 * unblocking is now sufficient cleanup, where before the reason had to be cleared first
 * because it survived an unblock and the cell was unreachable afterwards.
 */
test('blocked reason is inline-editable only when the item is blocked', async ({ page }) => {
  await loginAndSelectProject(page)
  await page.goto('/iteration-status', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await scrollGridRight(page)

  // Start from a known-unblocked state.
  for (const unblock of await page.getByTitle('Blocked - Click to Unblock').all()) {
    await unblock.click().catch(() => {})
    await page.waitForTimeout(200)
  }

  // Block the first row.
  await page.getByTitle('Unblocked - Click to Block').first().click()
  await page.waitForTimeout(500)

  // No stale-reason cleanup needed any more: the unblock loop above cleared any reason a
  // previous run left behind, because unblocking now clears it server-side. The row therefore
  // arrives here with an empty reason regardless of how the last run ended.
  //
  // The reason cell is editable (shows the "Add reason…" affordance).
  const addReason = page.getByText('Add reason…').first()
  await expect(addReason).toBeVisible()
  await addReason.click()
  const input = page.getByRole('textbox', { name: 'Blocked reason' })
  await expect(input).toBeVisible()
  await input.fill('Waiting on infra provisioning')
  await input.press('Enter')

  await expect(page.getByText('Waiting on infra provisioning')).toBeVisible()

  // ── Unblocking CLEARS the reason ─────────────────────────────────────────────
  // The behaviour under test, and the fixture restore in one step: no separate clear, because
  // there is nothing left to clear afterwards.
  await page.getByTitle('Blocked - Click to Unblock').first().click()
  await expect(page.getByTitle('Unblocked - Click to Block').first()).toBeVisible()
  await expect(page.getByText('Waiting on infra provisioning')).toHaveCount(0)

  // Still gone after a reload — the server cleared the column, the client did not just hide it.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await scrollGridRight(page)
  await expect(page.getByText('Waiting on infra provisioning')).toHaveCount(0)
})
