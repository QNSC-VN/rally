import { expect, test } from '@playwright/test'
import { login } from './helpers'

/**
 * Portfolio list + detail (P5).
 *
 * Covers what unit tests structurally cannot: that the page renders against the
 * real API, that the Epic/Feature switcher re-queries, and that the detail shell
 * shows the four progress indicators and hides the Feature-only fields on an Epic.
 *
 * Fixture comes from the demo seed (`db/seeds/demo.ts`): Epic `EP-1` over Features
 * `FE-1` (Story + Defect linked) and `FE-2` (childless).
 *
 * Deliberately asserts STRUCTURE, not percentages. The rollup denominators come
 * from the shared seeded Story/Defect, whose schedule state other specs in this
 * suite mutate (backlog-accepted-iteration, blocked-reason-inline-edit), so pinning
 * "100%" here would make this spec fail depending on run order. The arithmetic is
 * covered where it belongs — `portfolio-rollup.spec.ts` (37 cases) and
 * `portfolio-items.service.spec.ts`.
 */
test.describe('Portfolio', () => {
  test('lists Features with rollup columns and opens detail', async ({ page }) => {
    await login(page)
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' })

    // Feature is the default level.
    await expect(page.getByText('FE-1', { exact: true })).toBeVisible()
    await expect(page.getByText('Guest checkout flow')).toBeVisible()
    await expect(page.getByText('Saved payment methods')).toBeVisible()

    // Both Percent Done columns exist as distinct columns — they divide by
    // different denominators, so collapsing them into one would be a real defect.
    await expect(page.getByText('% Done by Est.')).toBeVisible()
    await expect(page.getByText('% Done by Count')).toBeVisible()

    // Project is resolved server-side; this list spans projects.
    await expect(page.getByText('NX Platform').first()).toBeVisible()

    await page.getByText('FE-1', { exact: true }).click()
    await expect(page).toHaveURL(/\/portfolio\/[0-9a-f-]{36}/)
    await expect(page.getByText('Guest checkout flow').first()).toBeVisible()
    await expect(page.getByText('% Done by Plan Estimate')).toBeVisible()
  })

  test('the Type switcher swaps between Features and Epics', async ({ page }) => {
    await login(page)
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' })

    // The switcher lives in the page header, not behind "Filters": it selects the
    // portfolio LEVEL rather than narrowing a result set.
    await page.getByLabel('Type').selectOption('epic')

    await expect(page.getByText('EP-1', { exact: true })).toBeVisible()
    await expect(page.getByText('Unified checkout platform')).toBeVisible()
    // Exclusive, not additive — the API has no combined view.
    await expect(page.getByText('Guest checkout flow')).toHaveCount(0)
  })

  test("an Epic's detail lists its child Features and hides Feature-only fields", async ({
    page,
  }) => {
    await login(page)
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Type').selectOption('epic')
    await page.getByText('EP-1', { exact: true }).click()
    await expect(page).toHaveURL(/\/portfolio\/[0-9a-f-]{36}/)

    // An Epic has no Team/Release/parent by CHECK constraint, so those rows must
    // not render — an empty row would read as "unset" rather than "not applicable".
    await expect(page.getByText('Preliminary Estimate')).toBeVisible()
    await expect(page.getByText('Release', { exact: true })).toHaveCount(0)

    await page.getByRole('tab', { name: /Children/ }).click()
    // Both Features appear, proving the two-level hierarchy read.
    await expect(page.getByText('Guest checkout flow')).toBeVisible()
    await expect(page.getByText('Saved payment methods')).toBeVisible()
  })
})
