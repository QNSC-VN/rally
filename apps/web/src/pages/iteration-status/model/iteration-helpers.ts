type DateRange = { startDate?: string | null; endDate?: string | null }

/** `start - end` label for an iteration, with em-dash fallbacks for missing bounds. */
export function fmtRange(it: DateRange): string {
  const s = it.startDate ?? '—'
  const e = it.endDate ?? '—'
  return `${s} - ${e}`
}

/** Inclusive day count for an iteration; defaults to 10 when bounds are missing. */
export function computeTotalDays(it: DateRange | undefined): number {
  if (!it?.startDate || !it?.endDate) return 10
  const start = new Date(it.startDate)
  const end = new Date(it.endDate)
  const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  return Math.max(1, diff)
}
