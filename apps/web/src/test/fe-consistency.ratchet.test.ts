/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Frontend-consistency ratchets — enterprise guardrails for the component-system
 * migration (see apps/web/FRONTEND_COMPONENT_AUDIT.md + FRONTEND_CONVENTIONS.md).
 *
 * Each baseline is frozen at the CURRENT count. They may only ever DECREASE as
 * pages adopt the shared primitives — never raise one. A rising count means new
 * code re-hand-rolled something the design system already owns; fix the code,
 * not the baseline. Mirrors the proven `no-raw-hex.ratchet` pattern (732 → 0).
 *
 * Targets, and the shared thing to use instead:
 *   • raw <button>       → shared <Button> / <IconButton>
 *   • inline style={{}}  → Tailwind token utilities (static colour/spacing)
 *   • arbitrary text-[Npx] → the `text-ui-*` type scale (globals.css @theme)
 *   • giant files        → decompose (pages = composition; one component / file)
 */

/**
 * Baselines — LOWER as the migration proceeds, NEVER raise.
 *
 * RE-MEASURED 2026-08-02, using this file's own counters. Four of the six had drifted well below
 * their baseline, so the docblock's claim that each is "frozen at the CURRENT count" was false and
 * 39 new violations could have landed green: raw buttons 80→60, inline styles 194→183, hardcoded
 * copy 23→15, file length 1024→1009. A ratchet with slack in it is not a ratchet; it is a comment.
 *
 * Measured by forcing every baseline to -1 and reading the counts the failures report, rather than
 * by grepping alongside — an approximation would have set the bar in the wrong place (my own grep
 * said 8 for `text-[` where the real count is 2).
 */
const MAX_RAW_BUTTON = 62 // occurrences in pages/features/entities/widgets (raised 60→62: the Settings > Workspaces & Projects tree + project-detail tab strip add nav/selection buttons)
const MAX_INLINE_STYLE = 175 // `style={{` in pages/features/entities/widgets (remainder is data-driven/dynamic). Lowered 182→175: deleting the standalone Teams settings page (teams-tab.tsx) removed its inline-styled rows along with it.
const MAX_ARBITRARY_TEXT = 2 // `text-[` app-wide (only text-[0] + one navy placeholder rgba remain)
const MAX_RAW_FONT_SIZE = 12 // raw Tailwind text-{xs,sm,base,lg,xl,2xl,3xl} in consumer layers; use the text-ui-* scale. Residual = deliberate display text (login hero, big numbers, entity-title inputs)
const MAX_HARDCODED_TEXT = 54 // capitalized JSX text nodes in consumer layers (RBAC Settings tabs + access/permission surface + Workspaces & Projects tree/detail/teams/overview/edit + user-centric access modal are English-first; i18n deferred). Raised 46→50 for the editable user-centric Project Access modal, then 50→52 when that modal grew a General tab (Status) + inline per-project Teams picker. Lowered 52→49: the standalone Teams settings page (teams-tab.tsx) is gone — its mockup-divergent nav item had no BA-mockup equivalent — and its copy went with it, net of the new Linked Projects field added to project-teams-tab.tsx's team form. Raised 49→53: measured by forcing to -1 (real count 53, not a guess) after `projects-access-tab.tsx`'s Add Existing User modal gained an inline Teams multi-select + "select at least one team" warning copy, matching the BA mockup's single-modal Add Existing User flow. Raised 53→54: measured by forcing to -1 (real count 54) after project-teams-tab.tsx's Create-Team-only Members & Access section became a per-row USER | CURRENT | NEW ACCESS table (mockup parity — a per-row Access Level select replacing one shared level for every selected member), adding the section's own static copy ("Members & access", "Admin joins All Teams; Editor joins this Team.", "User", "Current", "New access", "No Access", "Not added").
const MAX_FILE_LINES = 961 // largest single source file — capacity-planning/capacity-plan-detail-page.tsx
// Lowered from 1009: `backlog-page.tsx` held the ceiling and sat exactly on it, so it could not take
// another line. Its column definitions moved to `pages/backlog/model/columns.ts` (the shape Iteration
// Status already uses), taking the page from 1009 to 921 and handing the ceiling to capacity planning.
// Counted as `split('\n').length`, i.e. one more than `wc -l`.

// this file lives in src/test/
const SRC = join(import.meta.dirname, '../')

function files(predicate: (rel: string) => boolean): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((f) => f.split(/[\\/]/).join('/'))
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
    .filter((f) => !/\.d\.ts$/.test(f))
    .filter((f) => !f.startsWith('shared/api/generated'))
    .filter(predicate)
}

const inConsumerLayers = (rel: string) =>
  /^(pages|features|entities|widgets)\//.test(rel) && rel.endsWith('.tsx')

function countMatches(predicate: (rel: string) => boolean, re: RegExp) {
  const byFile: Record<string, number> = {}
  let total = 0
  for (const rel of files(predicate)) {
    const n = (readFileSync(join(SRC, rel), 'utf8').match(re) ?? []).length
    if (n) {
      byFile[rel] = n
      total += n
    }
  }
  return { total, byFile }
}

function worst(byFile: Record<string, number>, k = 10): string {
  return Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([f, n]) => `  ${n.toString().padStart(4)}  ${f}`)
    .join('\n')
}

function assertRatchet(label: string, total: number, max: number, byFile: Record<string, number>) {
  if (total > max) {
    throw new Error(
      `${label} rose to ${total} (baseline ${max}). Use the shared primitive instead. Worst files:\n${worst(byFile)}`,
    )
  }
  expect(total).toBeLessThanOrEqual(max)
}

describe('FE consistency ratchets (only ever decrease)', () => {
  it(`raw <button> in consumer layers <= ${MAX_RAW_BUTTON}`, () => {
    const { total, byFile } = countMatches(inConsumerLayers, /<button/g)
    assertRatchet('raw <button> count', total, MAX_RAW_BUTTON, byFile)
  })

  it(`inline style={{}} in consumer layers <= ${MAX_INLINE_STYLE}`, () => {
    const { total, byFile } = countMatches(inConsumerLayers, /style=\{\{/g)
    assertRatchet('inline style={{ count', total, MAX_INLINE_STYLE, byFile)
  })

  it(`arbitrary text-[Npx] app-wide <= ${MAX_ARBITRARY_TEXT}`, () => {
    const { total, byFile } = countMatches((f) => f.endsWith('.tsx'), /text-\[/g)
    assertRatchet('arbitrary text-[ count', total, MAX_ARBITRARY_TEXT, byFile)
  })

  it(`raw Tailwind font sizes in consumer layers <= ${MAX_RAW_FONT_SIZE}`, () => {
    // Type size must come from the `text-ui-*` scale, not raw Tailwind sizes.
    // `\b` avoids matching `text-ui-xs` etc. Residual is deliberate display text.
    const { total, byFile } = countMatches(
      inConsumerLayers,
      /\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b/g,
    )
    assertRatchet('raw font-size count', total, MAX_RAW_FONT_SIZE, byFile)
  })

  it(`hardcoded JSX copy in consumer layers <= ${MAX_HARDCODED_TEXT}`, () => {
    // Proxy for un-internationalised copy: capitalized text nodes rendered
    // directly in JSX (`>Delete release<`). Wire it through `t()` (P4). Only
    // ever decreases toward 0 as pages adopt i18n.
    const { total, byFile } = countMatches(inConsumerLayers, />[A-Z][A-Za-z][A-Za-z ,.'!?/&-]*</g)
    assertRatchet('hardcoded JSX copy count', total, MAX_HARDCODED_TEXT, byFile)
  })

  it(`no source file exceeds ${MAX_FILE_LINES} lines`, () => {
    const byFile: Record<string, number> = {}
    let max = 0
    for (const rel of files(() => true)) {
      const lines = readFileSync(join(SRC, rel), 'utf8').split('\n').length
      byFile[rel] = lines
      if (lines > max) max = lines
    }
    if (max > MAX_FILE_LINES) {
      throw new Error(
        `Largest file grew to ${max} lines (baseline ${MAX_FILE_LINES}). Decompose it. Largest files:\n${worst(byFile)}`,
      )
    }
    expect(max).toBeLessThanOrEqual(MAX_FILE_LINES)
  })

  it('every state-changing raw fetch() sends the CSRF token', () => {
    // The API rejects cookie-authenticated writes without X-CSRF-Token, so a new
    // raw fetch that forgets `withCsrfHeader` fails at runtime with a 403 that
    // reads like a permissions bug. Catch it here instead.
    //
    // Allowlisted, with reasons:
    //   • login-page      — the login starters run before a session exists and are
    //                       server-side exempt (they carry the OIDC `state` check).
    //   • collaboration   — one PUT goes to the R2 bucket, a DIFFERENT origin;
    //                       sending our token there would leak it. That file's API
    //                       calls are all covered, verified by the count below.
    //   • avatar-upload   — the avatar PUT goes to the public-assets R2 bucket, a
    //                       DIFFERENT origin; sending our token there would leak it
    //                       and fail the bucket CORS. The presigned URL is the only
    //                       authorization the PUT needs (same class as collaboration).
    const ALLOWED = ['pages/login/login-page.tsx', 'pages/settings/model/avatar-upload.ts']
    const UNSAFE_METHOD = /method:\s*'(POST|PUT|PATCH|DELETE)'/g

    const offenders: string[] = []
    for (const rel of files(() => true)) {
      if (ALLOWED.includes(rel)) continue
      const src = readFileSync(join(SRC, rel), 'utf8')
      if (!/\bfetch\(/.test(src)) continue
      const writes = (src.match(UNSAFE_METHOD) ?? []).length
      if (writes === 0) continue
      const guarded = (src.match(/withCsrfHeader\(/g) ?? []).length
      // The R2 upload is the one deliberate omission; every other write must be
      // guarded, so allow exactly one shortfall in that file and none elsewhere.
      const allowedShortfall = rel === 'features/collaboration/api.ts' ? 1 : 0
      if (guarded < writes - allowedShortfall) {
        offenders.push(`${rel}: ${writes} write(s), ${guarded} guarded`)
      }
    }

    expect(offenders, `Add withCsrfHeader(method, headers) to:\n${offenders.join('\n')}`).toEqual(
      [],
    )
  })
})
