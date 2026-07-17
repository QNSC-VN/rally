/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRAND } from '@/shared/config/brand'

/**
 * Drift guard: `brand.ts` (used in inline `style` / SVG paint) and the CSS custom
 * properties in `globals.css` (used by Tailwind token utilities + shadcn) MUST
 * describe the same palette. Historically they diverged silently — e.g. two
 * different destructive reds (#b91c1c inline vs #c41d2e in `--destructive`) and a
 * warning amber that did not match `--warning`. This test locks the semantic
 * tokens together so the two sources can never drift again without a failing test.
 */

const css = readFileSync(join(import.meta.dirname, './globals.css'), 'utf8')

/** Extract a CSS custom property value from the `:root {}` block. */
function rootVar(name: string): string {
  const root = css.slice(css.indexOf(':root'), css.indexOf('.dark {'))
  const match = root.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  if (!match) throw new Error(`CSS var ${name} not found in :root`)
  return match[1].trim().toLowerCase()
}

/** BRAND token → the `--css-var` that must hold the identical value. */
const PAIRS: ReadonlyArray<readonly [keyof typeof BRAND, string]> = [
  ['primary', '--primary'],
  ['primaryHover', '--primary-hover'],
  ['primaryLight', '--primary-light'],
  ['primaryLighter', '--primary-lighter'],
  ['pageBg', '--background'],
  ['surface', '--card'],
  ['surfaceHover', '--surface-hover'],
  ['surfaceSubtle', '--surface-subtle'],
  ['inputBg', '--input-background'],
  ['textPrimary', '--foreground'],
  ['textSecondary', '--muted-foreground'],
  ['textMuted', '--foreground-subtle'],
  ['textDisabled', '--foreground-disabled'],
  ['textFaint', '--foreground-faint'],
  ['border', '--border-strong'],
  ['borderSubtle', '--border-subtle'],
  ['borderInner', '--border-inner'],
  ['borderInput', '--input'],
  ['avatarBg', '--avatar'],
  ['avatarText', '--avatar-foreground'],
  ['sidebar', '--sidebar'],
  ['success', '--success'],
  ['successBg', '--success-bg'],
  ['successBorder', '--success-border'],
  ['danger', '--destructive'],
  ['dangerBg', '--destructive-bg'],
  ['dangerBorder', '--destructive-border'],
  ['warning', '--warning'],
  ['warningBg', '--warning-bg'],
]

describe('brand.ts ↔ globals.css palette sync', () => {
  it.each(PAIRS)('BRAND.%s equals %s', (brandKey, cssVar) => {
    expect(BRAND[brandKey].toLowerCase()).toBe(rootVar(cssVar))
  })
})
