import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge's default config buckets every `text-*` class (font size AND
 * color) into one conflict group, so `text-primary-foreground text-ui-sm`
 * silently dropped the color half — the last `text-*` class in the string
 * always won, regardless of whether it was actually a color or a size. This
 * broke any element combining a text-color utility with our custom `text-ui-*`
 * font-size scale (see globals.css `--text-ui-*`), e.g. every <Button> variant
 * — its color class was discarded, leaving default (dark) text color on a
 * navy background. Registering the custom scale as its own `font-size` group
 * tells tailwind-merge it does not conflict with color utilities.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['ui-2xs', 'ui-xs', 'ui-sm', 'ui-md', 'ui-lg', 'ui-xl'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format an ISO date string as a relative time (e.g. "5m ago", "2h ago", "3d ago"). */
export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  // For older items, fall back to a short date
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Format an ISO date string as a short calendar date, e.g. "Jul 31, 2026". */
export function formatDate(iso: string | null | undefined, fallback = '—'): string {
  if (!iso) return fallback
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? fallback
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Format an ISO timestamp as a short date + time, e.g. "Jul 31, 2026, 2:30 PM". */
export function formatDateTime(iso: string | null | undefined, fallback = '—'): string {
  if (!iso) return fallback
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? fallback
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
}
