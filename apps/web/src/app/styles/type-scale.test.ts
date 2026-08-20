/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buttonVariants } from '@/shared/ui/button'

/**
 * The `text-ui-*` scale, pinned three ways.
 *
 * The tokens are declared as `rem` with the intended px in a trailing comment, and `html` pins the
 * root to an absolute 14px — so the comment is the only statement of what a reader actually sees, and
 * a rem edited without its comment (or a root changed without the tokens) silently moves every size in
 * the app. The first case recomputes each token against the real root rather than trusting either.
 *
 * The floor is 11px. `--text-ui-2xs` (9px) was retired on 2026-08-20: it was 32 nodes of badge and
 * meta text below anything the product it models renders, and keeping the token defined would let it
 * come back one class at a time.
 */
const css = readFileSync(join(import.meta.dirname, './globals.css'), 'utf8')

const ROOT_PX = Number(/html\s*\{[^}]*font-size:\s*([\d.]+)px/.exec(css)?.[1])

/** Every `--text-ui-<name>` declaration with its rem value and its px comment, in source order. */
const SCALE = [...css.matchAll(/--text-ui-([a-z0-9]+):\s*([\d.]+)rem;\s*\/\* (\d+)px \*\//g)].map(
  ([, name, rem, px]) => ({ name, rem: Number(rem), px: Number(px) }),
)

describe('text-ui-* type scale', () => {
  it('reads a 14px root and six sizes', () => {
    expect(ROOT_PX).toBe(14)
    expect(SCALE.map((s) => s.name)).toEqual(['xs', 'sm', 'md', 'lg', 'xl'])
  })

  it.each(SCALE)('--text-ui-$name resolves to the $px px its comment claims', ({ rem, px }) => {
    // Sub-half-pixel, so a rem rounded to six places passes and a stale comment does not.
    expect(Math.abs(rem * ROOT_PX - px)).toBeLessThan(0.5)
  })

  it('ascends, and nothing renders below the 11px floor', () => {
    const px = SCALE.map((s) => s.px)
    expect(px).toEqual([...px].sort((a, b) => a - b))
    expect(new Set(px).size).toBe(px.length)
    expect(Math.min(...px)).toBeGreaterThanOrEqual(11)
  })

  it('does not define the retired 9px token', () => {
    expect(css).not.toMatch(/--text-ui-2xs\s*:/)
  })
})

/**
 * WCAG 2.5.8 Target Size (Minimum, AA) is 24×24 CSS px. `min-h-[24px]` is a px literal because
 * `min-h-6` is a rem and would resolve to 21px against this app's 14px root — under the floor, from
 * the class that exists to hold it.
 */
describe('Button meets the 24px target-size minimum', () => {
  it.each(['md', 'sm', 'xs', 'icon'] as const)('size=%s carries the floor', (size) => {
    expect(buttonVariants({ size })).toContain('min-h-[24px]')
  })

  it('gives the icon-only size a width floor too', () => {
    // Square target: an icon button has no text to widen it.
    expect(buttonVariants({ size: 'icon' })).toContain('min-w-[24px]')
  })
})
