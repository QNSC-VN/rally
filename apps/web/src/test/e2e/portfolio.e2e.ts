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
    // `Total Accepted Children`, which is what Rally shows on a portfolio item's detail page — it
    // replaced the four progress meters this line used to assert (`% Done by Plan Estimate` and
    // friends), same arithmetic framed as the question a reader of this page is asking.
    await expect(page.getByText('Total Accepted Children')).toBeVisible()
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

  test('creates a Feature, renames it in place, then archives it', async ({ page }) => {
    // One test covering the whole write loop on purpose: each step needs the row the
    // previous one produced, and splitting them would leave orphaned fixtures behind in
    // a suite that shares one seeded database.
    const unique = `E2E Feature ${Date.now()}`
    const renamed = `${unique} renamed`

    await login(page)
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' })

    // ── Create ──────────────────────────────────────────────────────────────
    // Scoped to the dialog throughout: the grid header also exposes a "Name column"
    // label and a "Resize Name column" separator, so an unscoped getByLabel('Name')
    // matches three elements.
    await page.getByRole('button', { name: /Add New/i }).click()
    const dialog = page.getByRole('dialog', { name: 'New Feature' })
    await dialog.getByRole('textbox', { name: 'Name' }).fill(unique)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden()

    // The new row is ON SCREEN without searching for it. A new item is ranked LAST and the
    // grid pages at 25, so this used to require a search to find at all — the scaffold now
    // jumps to the page holding it and flashes it (`revealRowId`).
    //
    // Scoped to the ROW rather than the page: `exact: true` is not enough on its own here,
    // because the success toast also reads `"<name>" created`.
    const revealed = page.locator('[data-revealed="true"]')
    await expect(revealed).toContainText(unique)

    // It is a real grid row, not just a highlight: the same row is reachable as a sortable row
    // on the page the user was sent to.
    const search = page.getByRole('searchbox', { name: /Search portfolio/i })
    await expect(
      page.locator('[aria-roledescription="sortable"]').filter({ hasText: unique }),
    ).toBeVisible()

    // ── Inline rename ───────────────────────────────────────────────────────
    // The Name cell is the inline editor; the ID cell is the click-to-open link.
    await page.getByText(unique, { exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Name' })
    await expect(editor).toBeVisible()
    await editor.fill(renamed)
    await editor.press('Enter')
    await expect(page.getByText(renamed, { exact: true })).toBeVisible()

    // Survives a reload, so it was persisted rather than only held in cache.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await search.fill(renamed)
    await expect(page.getByText(renamed, { exact: true })).toBeVisible()

    // ── Archive ─────────────────────────────────────────────────────────────
    // The row WRAPPER carries `group`; filtering plain divs and taking `.last()` lands on
    // the innermost text node's parent, which has no selection gutter.
    const row = page.locator('div.group').filter({ hasText: renamed }).first()
    await row.getByRole('checkbox').check()
    // The bulk bar's Archive opens a confirm dialog whose button carries the same label,
    // so the confirmation is scoped to the dialog rather than picked by position.
    await page.getByRole('button', { name: 'Archive', exact: true }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()

    // Archived items drop out of the default list — a soft delete, not a hard one.
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0)
  })

  test('the Percent Done bars carry Rally status colour and explain a missing verdict', async ({
    page,
  }) => {
    // Rally: "Both of the Percent Done fields are colored based on the status of the work
    // needed to complete the portfolio item" (TechDocs, "Using the Portfolio Items Page").
    //
    // Asserts the WIRING, not a particular colour. The verdict depends on the shared
    // seeded Story/Defect, whose schedule state other specs in this suite mutate, so
    // pinning "red" would fail depending on run order. The thresholds themselves are
    // covered in `health.spec.ts` (24 cases) and `percent-done-bar.test.tsx`.
    await login(page)
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('FE-1', { exact: true })).toBeVisible()

    // Narrowed by SEARCH rather than scanning the grid: the list pages at 25 and a
    // populated workspace has hundreds of Features, so FE-2 is genuinely off page one.
    const search = page.getByRole('searchbox', { name: /Search portfolio/i })

    // FE-1 is seeded WITH a planned window, so it gets a real verdict: the tooltip
    // carries the numbers and a status sentence, and specifically NOT the missing-dates
    // note. That is what proves the dates reached `computeHealth`.
    await search.fill('Guest checkout flow')
    const fe1 = page.locator('[aria-roledescription="sortable"]').filter({ hasText: 'FE-1' })
    const fe1Tip = await fe1.locator('[title*="Accepted points"]').first().getAttribute('title')
    expect(fe1Tip).toContain('Status:')
    expect(fe1Tip).toContain('Accepted points:')
    expect(fe1Tip).not.toContain('dates are missing')

    // FE-2 is childless, so there is no denominator and no verdict. `computeHealth`
    // reports `no_work` ahead of `no_dates` — a zero total is checked first, since
    // dividing by it would invent a health problem — so the note names the missing
    // ESTIMATES even though FE-2 also has no dates.
    //
    // This is also the empty-bar path: there is no fill to hover, so the placeholder dash
    // carries the tooltip. Before this slice it carried nothing and the row read as a
    // rendering bug.
    await search.fill('Saved payment methods')
    const fe2 = page.locator('[aria-roledescription="sortable"]').filter({ hasText: 'FE-2' })
    const fe2Tip = await fe2.locator('[title*="Accepted points"]').first().getAttribute('title')
    expect(fe2Tip).toContain('no estimated work is linked yet')

    await search.fill('')

    /**
     * The DETAIL page no longer carries these bars, and deliberately so: Rally shows
     * `Total Accepted Children` there instead, which is the block this asserts reached the page.
     *
     * This used to compare the detail tooltip against the grid's, character for character. That
     * cross-check cannot survive the two surfaces answering different questions — the grid reports a
     * percentage verdict per Feature, the detail block reports accepted child work in the unit the
     * reader picks. `Total Accepted Children` is covered as a component elsewhere; what belongs here
     * is that the grid's tooltip and the detail page both come up populated for the same Feature.
     */
    await page.getByText('FE-1', { exact: true }).click()
    await expect(page).toHaveURL(/\/portfolio\/[0-9a-f-]{36}/)
    await expect(page.getByText('Total Accepted Children')).toBeVisible()
  })

  test('drag reorders rows, and the grip disappears under a column sort', async ({ page }) => {
    /**
     * Creates its OWN pair and narrows to them by search.
     *
     * The previous version dragged whichever two rows happened to sort first in a cross-project
     * grid of hundreds, then compared whole-row innerText after a reload. Both halves were
     * fragile: another spec inserting a row shifted the positions, and the row text contains
     * rollup numbers that move whenever any linked Story changes — so the assertion failed while
     * the drag had worked. It failed more often on baseline than on a branch, which is the
     * signature of shared state rather than a bug.
     *
     * Searching does NOT disable the grip (only a column SORT does, which the last assertion
     * covers), and a rank derived between two filtered neighbours still flips their relative
     * order — which is the whole claim.
     */
    const tag = `DRAG-${Date.now()}`
    await login(page)
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' })

    for (const suffix of ['A', 'B']) {
      await page.getByRole('button', { name: /Add New/i }).click()
      const dialog = page.getByRole('dialog', { name: 'New Feature' })
      await dialog.getByRole('textbox', { name: 'Name' }).fill(`${tag} ${suffix}`)
      await dialog.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(dialog).toBeHidden()
    }

    const search = page.getByRole('searchbox', { name: /Search portfolio/i })
    await search.fill(tag)

    const rows = page.locator('[aria-roledescription="sortable"]')
    await expect(rows).toHaveCount(2)
    /** The ID cell only — row text also carries rollup numbers that move on their own. */
    const keyOf = async (i: number) => {
      const text = (await rows.nth(i).innerText()).trim()
      return text.split('\n')[0]
    }
    const before = [await keyOf(0), await keyOf(1)]
    expect(before[0]).not.toBe(before[1])

    const grips = page.getByLabel('Drag to reorder')
    await expect(grips.first()).toBeVisible()

    // Real pointer drag: dnd-kit's PointerSensor has a 4px activation distance, so the move has
    // to be stepped rather than a single jump.
    const from = await grips.nth(1).boundingBox()
    const to = await grips.nth(0).boundingBox()
    if (!from || !to) throw new Error('drag handles not measurable')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 - 8, { steps: 12 })
    await page.mouse.up()

    await expect(async () => expect(await keyOf(0)).toBe(before[1])).toPass({ timeout: 5000 })

    // Asserted again after a RELOAD, so this proves the new rank was PERSISTED rather than
    // reordered in local state only.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await search.fill(tag)
    await expect(rows).toHaveCount(2)
    expect(await keyOf(0)).toBe(before[1])

    // Sorting by a column removes the grip entirely: rank only means anything in natural rank
    // order, so a drag under a Name sort would derive a rank from neighbours whose order has
    // nothing to do with rank.
    await page.getByLabel('Name column', { exact: true }).click()
    await expect(page.getByLabel('Drag to reorder')).toHaveCount(0)

    // Clean up both fixtures in ONE bulk action so the grid does not grow a pair per run.
    // Restore natural rank order first — the checkbox column is unaffected, but leaving a sort on
    // would hide the grip assertions above from the next reader.
    await page.getByLabel('Name column', { exact: true }).click()
    await search.fill(tag)
    await expect(rows).toHaveCount(2)

    for (const index of [0, 1]) {
      await rows.nth(index).getByRole('checkbox').check()
    }
    await page.getByRole('button', { name: 'Archive', exact: true }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()

    // Counted as ROWS, not as text: the success toast repeats the name, so a text count would
    // wait for a toast to fade rather than for the archive to land.
    await expect(rows).toHaveCount(0)
  })
})
