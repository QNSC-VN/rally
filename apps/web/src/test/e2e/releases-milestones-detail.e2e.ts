import { test, expect } from '@playwright/test'

import { loginAndSelectProject } from './helpers'

/**
 * Detail-surface parity — release & milestone detail pages after the
 * ADR-001 refactor onto the shared `DetailLayout` / `DetailTabBar` /
 * `DetailField` primitives and the shared `ArtifactsTabView`.
 *
 * These two surfaces previously had NO e2e coverage (the audit flagged it), so
 * this both verifies the refactor renders and closes that gap. IDs are the
 * seeded demo release/milestone in the NX Platform project.
 */
const RELEASE_ID = '00000000-0000-7000-8000-000000000050'
const MILESTONE_ID = '00000000-0000-7000-8000-0000000000b0'

test.describe('Detail pages use the shared DetailLayout chrome', () => {
  test('release detail: header, tabs and shared Artifacts tab render', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto(`/releases/${RELEASE_ID}`, { waitUntil: 'domcontentloaded' })

    // DetailTabBar (shared) exposes an accessible tablist with both tabs.
    const tablist = page.getByRole('tablist')
    await expect(tablist).toBeVisible({ timeout: 20_000 })
    const detailsTab = page.getByRole('tab', { name: /details/i })
    const artifactsTab = page.getByRole('tab', { name: /artifacts/i })
    await expect(detailsTab).toBeVisible()
    await expect(artifactsTab).toBeVisible()
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true')

    // Switch to the shared ArtifactsTabView — its search field must appear.
    await artifactsTab.click()
    await expect(artifactsTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('searchbox', { name: /search artifacts/i })).toBeVisible()

    await page.screenshot({ path: 'test-results/release-detail-artifacts.png', fullPage: true })
  })

  test('milestone detail: header, tabs and shared Artifacts tab render', async ({ page }) => {
    await loginAndSelectProject(page)
    await page.goto(`/milestones/${MILESTONE_ID}`, { waitUntil: 'domcontentloaded' })

    const tablist = page.getByRole('tablist')
    await expect(tablist).toBeVisible({ timeout: 20_000 })
    const detailsTab = page.getByRole('tab', { name: /details/i })
    const artifactsTab = page.getByRole('tab', { name: /artifacts/i })
    await expect(detailsTab).toBeVisible()
    await expect(artifactsTab).toBeVisible()
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true')

    await artifactsTab.click()
    await expect(artifactsTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('searchbox', { name: /search artifacts/i })).toBeVisible()

    await page.screenshot({ path: 'test-results/milestone-detail-artifacts.png', fullPage: true })
  })
})
