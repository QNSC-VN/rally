import { describe, expect, it, vi } from 'vitest'

import { formatNumber, formatPercent, formatPoints, formatWholePercent } from './utils'

vi.mock('./format-prefs', () => ({ getFormatPrefs: () => ({ locale: 'en-US' }) }))

/**
 * These cover the distinction the whole audit turned on: a missing number and a zero are
 * different facts, and only one of them may render as `0`.
 */
describe('formatNumber', () => {
  it('renders an em-dash for null and undefined, not 0', () => {
    expect(formatNumber(null)).toBe('--')
    expect(formatNumber(undefined)).toBe('--')
  })

  it('renders a real 0 as 0 — a zero is not a missing value', () => {
    expect(formatNumber(0)).toBe('0')
  })

  it('accepts the strings Drizzle returns for numeric columns', () => {
    expect(formatNumber('5.00')).toBe('5')
    expect(formatNumber('2.50')).toBe('2.5')
  })

  it('treats an empty string as missing, since form inputs produce it', () => {
    expect(formatNumber('')).toBe('--')
  })

  it('refuses NaN and Infinity, which fall out of arithmetic on absent inputs', () => {
    expect(formatNumber(Number.NaN)).toBe('--')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('--')
    expect(formatNumber(1 / 0)).toBe('--')
  })

  it('groups thousands so long numbers stay readable', () => {
    expect(formatNumber(12345)).toBe('12,345')
  })

  it('honours an explicit fallback for the cases where 0 IS the truth', () => {
    expect(formatNumber(null, { fallback: '0' })).toBe('0')
  })
})

describe('formatPoints', () => {
  it('drops the trailing .00 that numeric(6,2) columns carry', () => {
    expect(formatPoints('8.00')).toBe('8')
  })

  it('keeps a genuine fraction — half-point stories exist', () => {
    expect(formatPoints('0.50')).toBe('0.5')
  })

  it('em-dashes a missing estimate', () => {
    expect(formatPoints(null)).toBe('--')
  })
})

describe('formatPercent', () => {
  it('renders null as an em-dash, NOT 0% — the bug class this audit found', () => {
    // "none of the work is done" and "we cannot tell" must not look identical.
    expect(formatPercent(null)).toBe('--')
    expect(formatPercent(undefined)).toBe('--')
  })

  it('renders a real 0 ratio as 0%', () => {
    expect(formatPercent(0)).toBe('0%')
  })

  it('rounds to whole percent', () => {
    expect(formatPercent(0.625)).toBe('63%')
    expect(formatPercent(1)).toBe('100%')
  })

  it('does not clamp above 100 — overdelivery is real and worth seeing', () => {
    expect(formatPercent(1.5)).toBe('150%')
  })

  it('refuses a non-finite ratio from a zero denominator', () => {
    expect(formatPercent(0 / 0)).toBe('--')
  })
})

describe('formatWholePercent', () => {
  /**
   * This pair exists because passing an already-whole percent to `formatPercent` renders
   * `10000%` — a bug that shipped into a first draft of the Reports widget and was caught
   * only by looking at the rendered page.
   */
  it('does not multiply a value that is already a percent', () => {
    expect(formatWholePercent(100)).toBe('100%')
    expect(formatWholePercent(24)).toBe('24%')
  })

  it('renders null as an em-dash, not 0%', () => {
    expect(formatWholePercent(null)).toBe('--')
    expect(formatWholePercent(undefined)).toBe('--')
  })

  it('renders a real 0 as 0%', () => {
    expect(formatWholePercent(0)).toBe('0%')
  })

  it('differs from formatPercent for the same input — the whole point of the split', () => {
    expect(formatWholePercent(100)).toBe('100%')
    expect(formatPercent(100)).toBe('10000%')
  })
})
