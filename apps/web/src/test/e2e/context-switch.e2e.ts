import { test } from '@playwright/test'
import { login, settle, expect } from './helpers'

/**
 * SHELL-FR-005 — changing EITHER half of the delivery context lands on Home.
 *
 * "Khi đổi Project hoặc Team từ context selector, navigate về Home của context mới và
 * invalidate/refetch toàn bộ Project/Team-scoped query. Không giữ route hoặc dữ liệu của context cũ."
 *
 * The switcher had no journey of its own, which is how the Team half shipped with the opposite
 * behaviour: it was read as a scope filter that should leave the reader where they were. A record
 * route is the case that settles it — a work item, an iteration or a Team Status row belongs to the
 * context it was opened under, and staying put leaves the old context's data on screen.
 */
test.describe('P0 App Shell — delivery context switcher', () => {
  test('navigates Home when the Team changes, not only when the Project does', async ({ page }) => {
    await login(page)
    // Start somewhere that is NOT Home, so "landed on Home" cannot pass vacuously.
    await page.goto('/backlog')
    await settle(page)
    await expect(page).toHaveURL(/\/backlog$/)

    // Open the switcher. It expands the active project on open, so its teams are already listed.
    await page.getByRole('button', { name: /·/ }).first().click()
    // `Team Alpha` (key ALPHA) is seeded on NXP and linked to it — see `db/seeds/demo.ts`.
    await page
      .getByRole('button', { name: /Team Alpha/ })
      .first()
      .click()
    await settle(page)

    // The Team is now the selected scope AND the route is Home — both halves of FR-005.
    await expect(page).toHaveURL(/\/$/)
  })
})
