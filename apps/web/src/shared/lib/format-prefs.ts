/**
 * Formatting preferences — the resolved locale + timezone the date/number
 * formatters in `./utils` use. Resolved ONCE at auth bootstrap (and again after
 * a profile / workspace-settings save) from the precedence chain:
 *
 *   user override  →  workspace default  →  UTC / 'en'
 *
 * A module singleton (same pattern as `shared/api/csrf`) so the pure `formatX`
 * helpers stay call-site-free — no prop drilling a locale through every table.
 *
 * NOTE: `locale` drives Intl *formatting* (date/number style), not the UI
 * language — the app currently ships only an English string bundle.
 */
export interface FormatPrefs {
  locale: string
  timeZone: string
}

let prefs: FormatPrefs = { locale: 'en', timeZone: 'UTC' }

/** Merge in resolved prefs; blank/nullish values keep the current setting. */
export function setFormatPrefs(next: Partial<FormatPrefs>): void {
  prefs = {
    locale: next.locale || prefs.locale,
    timeZone: next.timeZone || prefs.timeZone,
  }
}

export function getFormatPrefs(): FormatPrefs {
  return prefs
}

/** Resolve the effective prefs from the user's own settings, then the workspace default. */
export function resolveFormatPrefs(
  user: { locale?: string | null; timezone?: string | null } | null,
  workspace: { locale?: string | null; timezone?: string | null } | null,
): FormatPrefs {
  return {
    locale: user?.locale || workspace?.locale || 'en',
    timeZone: user?.timezone || workspace?.timezone || 'UTC',
  }
}
