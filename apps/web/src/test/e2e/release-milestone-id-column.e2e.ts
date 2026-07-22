import { test, expect } from '@playwright/test'

import { loginAndSelectProject } from './helpers'

/**
 * Release & Milestone list tables must lead with an ID column showing the
 * generated per-project display key (RE-<n> / MS-<n>), consistent with every
 * other grid. Seeded demo data has exactly RE-1 (release) and MS-1 (milestone).
 *
 * Position is asserted semantically: the key cell must render to the LEFT of
 * the name cell (both are CellLink buttons), i.e. the ID column comes first.
 */
async function assertKeyLeftOfName(keyBtn: { boundingBox(): Promise<{ x: number } | null> }, nameBtn: { boundingBox(): Promise<{ x: number } | null> }) {
  const keyBox = await keyBtn.boundingBox()
  const nameBox = await nameBtn.boundingBox()
  expect(keyBox, 'key cell should be rendered').not.toBeNull()
  expect(nameBox, 'name cell should be rendered').not.toBeNull()
  expect(keyBox!.x).toBeLessThan(nameBox!.x)
}

test.describe('Releases/Milestones tables lead with the ID column', () => {
  test('releases list shows RE-1 in a leading ID column', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/releases', { waitUntil: 'domcontentloaded' })

    const key = page.getByRole('button', { name: 'RE-1', exact: true })
    await expect(key).toBeVisible({ timeout: 20_000 })
    await assertKeyLeftOfName(key, page.getByRole('button', { name: /NX Platform Upgrade/ }))

    await page.screenshot({ path: 'test-results/releases-id-column.png', fullPage: true })
  })

  test('milestones list shows MS-1 in a leading ID column', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto('/milestones', { waitUntil: 'domcontentloaded' })

    const key = page.getByRole('button', { name: 'MS-1', exact: true })
    await expect(key).toBeVisible({ timeout: 20_000 })
    await assertKeyLeftOfName(key, page.getByRole('button', { name: /NX Platform v2/ }))

    await page.screenshot({ path: 'test-results/milestones-id-column.png', fullPage: true })
  })
})
