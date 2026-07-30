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
 * Blocked Reason is inline-editable only while the item is Blocked. Blocking a
 * row turns the reason cell into an editable field; the reason persists.
 * Self-restoring (unblocks at the end) so re-runs start clean.
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

  /**
   * Clear any reason left over from an earlier run BEFORE asserting the affordance.
   *
   * `blocked_reason` survives an unblock, and the cell is editable only WHILE blocked — so a
   * stale reason cannot be cleared through the UI at all until the row is blocked again.
   * That combination is what made this spec unrepeatable: a run whose cleanup click missed
   * left US-1 blocked with a reason, and every later run then found that reason instead of
   * the "Add reason…" placeholder. Clearing here makes the precondition real rather than
   * assumed, so the spec no longer depends on how the previous run ended.
   */
  const stale = page.getByRole('textbox', { name: 'Blocked reason' })
  const existing = page.getByText('Waiting on infra provisioning').first()
  if (await existing.isVisible().catch(() => false)) {
    await existing.click()
    await stale.fill('')
    await stale.press('Enter')
    await page.waitForTimeout(300)
  }

  // The reason cell is now editable (shows the "Add reason…" affordance).
  const addReason = page.getByText('Add reason…').first()
  await expect(addReason).toBeVisible()
  await addReason.click()
  const input = page.getByRole('textbox', { name: 'Blocked reason' })
  await expect(input).toBeVisible()
  await input.fill('Waiting on infra provisioning')
  await input.press('Enter')

  await expect(page.getByText('Waiting on infra provisioning')).toBeVisible()

  // Restore the fixture: clear the reason FIRST (it is unreachable once unblocked), then
  // unblock. The previous version only unblocked, and swallowed the click failure with
  // `.catch(() => {})`, which is how a blocked row with a reason survived into later runs.
  const written = page.getByText('Waiting on infra provisioning').first()
  await written.click()
  const clear = page.getByRole('textbox', { name: 'Blocked reason' })
  await clear.fill('')
  await clear.press('Enter')
  await expect(page.getByText('Add reason…').first()).toBeVisible()

  await page.getByTitle('Blocked - Click to Unblock').first().click()
  await expect(page.getByTitle('Unblocked - Click to Block').first()).toBeVisible()
})
