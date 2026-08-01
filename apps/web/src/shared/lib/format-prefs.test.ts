import { describe, it, expect, beforeEach } from 'vitest'
import { resolveFormatPrefs, setFormatPrefs, getFormatPrefs } from './format-prefs'
import { formatDate, formatDateIso, formatDateTime } from './utils'

describe('resolveFormatPrefs', () => {
  it('prefers the user override over the workspace default', () => {
    expect(
      resolveFormatPrefs(
        { locale: 'vi', timezone: 'Asia/Ho_Chi_Minh' },
        { locale: 'en', timezone: 'UTC' },
      ),
    ).toEqual({ locale: 'vi', timeZone: 'Asia/Ho_Chi_Minh' })
  })

  it('falls back to the workspace default when the user has none', () => {
    expect(resolveFormatPrefs({ locale: null, timezone: null }, { locale: 'en-GB', timezone: 'Europe/London' })).toEqual(
      { locale: 'en-GB', timeZone: 'Europe/London' },
    )
  })

  it('falls back to UTC/en when neither is set', () => {
    expect(resolveFormatPrefs(null, null)).toEqual({ locale: 'en', timeZone: 'UTC' })
  })
})

describe('date formatting honours resolved prefs', () => {
  beforeEach(() => setFormatPrefs({ locale: 'en', timeZone: 'UTC' }))

  it('date-only values are NEVER timezone-shifted', () => {
    // A far-west timezone would roll a UTC-midnight date back a day if applied.
    setFormatPrefs({ locale: 'en', timeZone: 'America/Los_Angeles' })
    expect(formatDateIso('2026-07-01')).toBe('2026-07-01')
    expect(formatDate('2026-07-01')).toBe('Jul 1, 2026')
  })

  it('timestamps resolve to their calendar day in the active timezone', () => {
    // 2026-07-01T05:00Z is still Jun 30 in Los Angeles (UTC-7).
    setFormatPrefs({ locale: 'en', timeZone: 'America/Los_Angeles' })
    expect(formatDateIso('2026-07-01T05:00:00Z')).toBe('2026-06-30')
  })

  it('locale changes the date style', () => {
    setFormatPrefs({ locale: 'en-GB', timeZone: 'UTC' })
    // en-GB renders day-first.
    expect(formatDate('2026-07-01')).toBe('1 Jul 2026')
  })

  it('returns the fallback for empty input', () => {
    expect(formatDate(null)).toBe('--')
    expect(formatDateTime(undefined)).toBe('--')
  })

  it('getFormatPrefs reflects the last set value', () => {
    setFormatPrefs({ locale: 'vi', timeZone: 'Asia/Ho_Chi_Minh' })
    expect(getFormatPrefs()).toEqual({ locale: 'vi', timeZone: 'Asia/Ho_Chi_Minh' })
  })
})
