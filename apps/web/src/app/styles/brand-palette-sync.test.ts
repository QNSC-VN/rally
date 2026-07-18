/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRAND } from '@/shared/config/brand'

/**
 * Single-source-of-truth guard. `brand.ts` is a typed accessor over the CSS
 * custom properties in `globals.css`: every entry is a `var(--token)` reference,
 * so the palette values live in exactly ONE place (the CSS `:root` / `.dark`
 * blocks) and inline `style` / SVG paint follow the light/dark cascade.
 *
 * This test locks that contract: every BRAND entry must (a) be a `var(--token)`
 * reference and (b) point at a variable that actually exists in `:root`, so a
 * typo or a removed CSS var can never leave a dangling reference behind.
 */
const css = readFileSync(join(import.meta.dirname, './globals.css'), 'utf8')
const root = css.slice(css.indexOf(':root'), css.indexOf('.dark {'))

function rootHasVar(name: string): boolean {
  return new RegExp(`${name}\\s*:`).test(root)
}

describe('brand.ts ↔ globals.css single source of truth', () => {
  it.each(Object.entries(BRAND))('BRAND.%s references an existing CSS var', (_key, value) => {
    const match = /^var\((--[a-z0-9-]+)\)$/.exec(value)
    expect(match, `expected a var(--token) reference, got "${value}"`).not.toBeNull()
    expect(rootHasVar(match![1]), `${match![1]} is not defined in :root`).toBe(true)
  })
})
