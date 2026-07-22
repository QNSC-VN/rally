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

  // The reason cell is now editable (shows the "Add reason…" affordance).
  const addReason = page.getByText('Add reason…').first()
  await expect(addReason).toBeVisible()
  await addReason.click()
  const input = page.getByRole('textbox', { name: 'Blocked reason' })
  await expect(input).toBeVisible()
  await input.fill('Waiting on infra provisioning')
  await input.press('Enter')

  await expect(page.getByText('Waiting on infra provisioning')).toBeVisible()

  // Restore: unblock the row so the fixture is left clean.
  await page.getByTitle('Blocked - Click to Unblock').first().click().catch(() => {})
  await page.waitForTimeout(300)
})
