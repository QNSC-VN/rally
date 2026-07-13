import { describe, expect, it } from 'vitest'
import { cn, relativeTime } from './utils'

describe('cn (class name merge)', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  it('applies conditional object syntax', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })

  it('dedupes conflicting tailwind utilities (last wins)', () => {
    // tailwind-merge keeps the later of two conflicting utilities.
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm', 'text-lg')).toBe('text-lg')
  })
})

describe('relativeTime', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

  it('returns "just now" under a minute', () => {
    expect(relativeTime(ago(30_000))).toBe('just now')
  })

  it('returns minutes for under an hour', () => {
    expect(relativeTime(ago(5 * 60_000))).toBe('5m ago')
  })

  it('returns hours for under a day', () => {
    expect(relativeTime(ago(3 * 60 * 60_000))).toBe('3h ago')
  })

  it('returns days for under a month', () => {
    expect(relativeTime(ago(4 * 24 * 60 * 60_000))).toBe('4d ago')
  })

  it('falls back to a short date for older items', () => {
    // 60 days ago → "Mon D" style, never the relative suffix.
    const result = relativeTime(ago(60 * 24 * 60 * 60_000))
    expect(result).not.toMatch(/ago|just now/)
    expect(result).toMatch(/[A-Z][a-z]{2} \d{1,2}/)
  })
})
