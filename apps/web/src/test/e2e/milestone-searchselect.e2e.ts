import { test, expect } from '@playwright/test'

import { loginAndSelectProject } from './helpers'

/**
 * The Iteration-Status Milestones cell uses the shared multi-select
 * SearchableSelect (search box + toggle options), consistent with the Iteration
 * / Owner cells — not a bespoke popover. Seeded US-1 has MS-1 assigned.
 */
test('milestone cell opens the shared searchable multi-select', async ({ page }) => {
  await loginAndSelectProject(page)
  await page.goto('/iteration-status', { waitUntil: 'domcontentloaded' })

  // `exact` — the draggable row is itself exposed as a button whose accessible
  // name aggregates every cell's text (incl. "Edit milestones"), so a substring
  // match would click the row, not the milestone trigger.
  const trigger = page.getByRole('button', { name: 'Edit milestones', exact: true }).first()
  await expect(trigger).toBeVisible({ timeout: 20_000 })
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()

  // The shared popover's search box appears...
  await expect(page.getByPlaceholder('Search milestones')).toBeVisible()
  // ...and the assigned milestone shows as an option with its MS- key + name.
  await expect(page.getByRole('button', { name: 'MS-1: GA — NX Platform v2', exact: true })).toBeVisible()
})
