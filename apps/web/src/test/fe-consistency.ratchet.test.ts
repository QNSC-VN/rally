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

// ── Baselines — LOWER as the migration proceeds, NEVER raise ──────────────────
const MAX_RAW_BUTTON = 95 // occurrences in pages/features/entities/widgets
const MAX_INLINE_STYLE = 207 // `style={{` in pages/features/entities/widgets (remainder is data-driven/dynamic)
const MAX_ARBITRARY_TEXT = 2 // `text-[` app-wide (only text-[0] + one navy placeholder rgba remain)
const MAX_HARDCODED_TEXT = 133 // capitalized JSX text nodes in consumer layers (P4: wire t(), drive to 0)
const MAX_FILE_LINES = 1024 // largest single source file (after monolith decomposition)

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
})
