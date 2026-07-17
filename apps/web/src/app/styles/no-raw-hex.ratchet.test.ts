/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Raw-hex ratchet — enterprise guardrail for the design-token migration.
 *
 * The single source of truth for colour is the token layer:
 *   • Tailwind utilities backed by `@theme` in `app/styles/globals.css`
 *   • the typed `BRAND` mirror in `shared/config/brand.ts` (inline style / SVG paint)
 *
 * Raw hex literals (`#5c6478`, `text-[#1d3f73]`, `style={{ color: '#fff' }}`) bypass
 * that source and are how the palette drifts. We cannot delete all 591 pre-existing
 * uses in one blind commit (a mix of exact-token duplicates, off-brand slate/gray,
 * and one-off logo/status colours) without per-screen visual QA — so instead we
 * RATCHET: the count may only ever go DOWN. Any new raw hex fails CI; every
 * migration PR must LOWER `MAX_RAW_HEX` to its new actual value.
 *
 * To migrate: replace the hex with the matching token (className utility, or
 * `BRAND.*` where a class can't reach), then set `MAX_RAW_HEX` to the number this
 * test reports. Never raise it.
 */

// ── Ratchet baseline — LOWER as files migrate, NEVER raise ────────────────────
const MAX_RAW_HEX = 288

// src/ root (this file lives in src/app/styles/)
const SRC = join(import.meta.dirname, '../../')

// The palette-definition layer defines colours in hex by design — every consumer
// reads from these maps rather than re-hardcoding. Exempt them (they ARE the
// single source of truth). Keep this list explicit + justified, not a broad glob,
// so it stays auditable and can't silently hide scattered hex.
const EXEMPT_FILES = new Set([
  'shared/config/brand.ts', //                base colour primitives (typed CSS-var mirror)
  'shared/config/status-colors.ts', //        shared StatusStyle contract
  'entities/work-item/model/types.ts', //     work-item type/state/priority/severity badge palette
  'features/milestones/status-colors.ts', //  milestone status badge palette
  'features/releases/status-colors.ts', //    release status badge palette
])

const HEX = /#[0-9a-fA-F]{3,8}\b/g

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !/\.(test|spec)\.(ts|tsx)$/.test(f))
    .filter((f) => !/\.d\.ts$/.test(f))
    .filter((f) => !f.startsWith(join('shared', 'api', 'generated')))
    .filter((f) => !EXEMPT_FILES.has(f.split(/[\\/]/).join('/')))
}

function countRawHex(): { total: number; byFile: Record<string, number> } {
  const byFile: Record<string, number> = {}
  let total = 0
  for (const rel of sourceFiles()) {
    const abs = join(SRC, rel)
    const matches = readFileSync(abs, 'utf8').match(HEX)
    if (matches?.length) {
      const key = relative(SRC, abs).split(/[\\/]/).join('/')
      byFile[key] = matches.length
      total += matches.length
    }
  }
  return { total, byFile }
}

describe('design-token ratchet: no new raw hex colours', () => {
  it(`keeps raw hex literal count <= ${MAX_RAW_HEX} (only ever decrease)`, () => {
    const { total, byFile } = countRawHex()
    if (total > MAX_RAW_HEX) {
      const worst = Object.entries(byFile)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([f, n]) => `  ${n.toString().padStart(3)}  ${f}`)
        .join('\n')
      throw new Error(
        `Raw hex colour count rose to ${total} (baseline ${MAX_RAW_HEX}). ` +
          `Use design tokens instead of raw hex. Worst files:\n${worst}`,
      )
    }
    expect(total).toBeLessThanOrEqual(MAX_RAW_HEX)
  })
})
