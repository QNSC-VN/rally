/**
 * Shared timezone + locale option lists for the personal Profile and the
 * Workspace Settings forms. Locale drives Intl date/number formatting (the app
 * ships only an English string bundle, so it is not a UI-language switch).
 */
export const TIMEZONES = [
  'UTC',
  'Asia/Ho_Chi_Minh',
  'Asia/Tokyo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
] as const

export const LOCALES: { value: string; label: string }[] = [
  { value: 'en', label: 'English (US) - Jul 31, 2026' },
  { value: 'en-GB', label: 'English (UK) - 31 Jul 2026' },
  { value: 'vi', label: 'Tiếng Việt - 31 thg 7, 2026' },
]
