/**
 * The shared report query contract (P6-RPT-01): scope, workspace-local dates and the
 * working-day calendar. Every Phase 6 report resolves its scope through this module so
 * three reports cannot disagree about what "this Team, this timebox, end of that day"
 * means.
 *
 * Pure. No clock, no request, no database — the same reason `portfolio-rollup.ts` is
 * pure: these are the rules the reports are judged on, and they must be verifiable
 * without a database.
 */

// ── Team scope ──────────────────────────────────────────────────────────────

/**
 * `All Teams` is a first-class scope, not "teamId omitted".
 *
 * Modelling it as `teamId?: string` made the two cases indistinguishable from a
 * forgotten parameter, and they behave differently in every report: All Teams fuses
 * per-Team iterations onto one timebox and must de-duplicate work items across Teams,
 * while a selected Team must return that Team ONLY.
 */
export type TeamScope =
  { readonly kind: 'team'; readonly teamId: string } | { readonly kind: 'all' };

export const ALL_TEAMS: TeamScope = { kind: 'all' };

export function teamScope(teamId: string | null | undefined): TeamScope {
  return teamId ? { kind: 'team', teamId } : ALL_TEAMS;
}

/** The scope every report query is bounded by. Project is never optional. */
export interface ReportScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly team: TeamScope;
  /** IANA zone from `workspace_settings.timezone`. Every date cutoff uses it. */
  readonly timeZone: string;
  /** ISO day numbers from `workspace_settings.working_days` (1 = Mon … 7 = Sun). */
  readonly workingDays: readonly number[];
}

// ── The working-day calendar ────────────────────────────────────────────────

/** Mon–Fri. The column default; repeated here for pure callers and tests. */
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/** ISO day of week (1 = Monday … 7 = Sunday) for a `YYYY-MM-DD` calendar date. */
export function isoDayOfWeek(localDate: string): number {
  // Parsed as UTC midnight on purpose: a calendar date has no zone, and using local
  // parsing would shift the weekday for anyone west of UTC.
  const day = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isWorkingDay(localDate: string, workingDays: readonly number[]): boolean {
  return workingDays.includes(isoDayOfWeek(localDate));
}

/**
 * Whether this is a real `YYYY-MM-DD` calendar date.
 *
 * Shape AND validity: `'2026-02-30'` has the right shape and is not a date, and every helper
 * here reaches for `new Date(...)` immediately after.
 */
export function isCalendarDate(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Add whole days to a `YYYY-MM-DD` date, staying in the calendar (no zone involved). */
export function addDays(localDate: string, days: number): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Every working day from `start` to `end` inclusive.
 *
 * This is the Burndown x-axis (IB §2) and the denominator of the Ideal line's
 * working-day index (IB-BR-03). Weekend snapshots may still be STORED for audit; they
 * are simply not plotted.
 *
 * Returns `[]` when either endpoint is missing or unparseable, when the range is inverted, or
 * when the window contains no working day at all — an empty axis is an explicit empty state,
 * never a fabricated one.
 *
 * The missing-endpoint guard is load-bearing, not defensive dressing. A dateless iteration
 * reaches here as `''` (the caller has nothing else to pass), and `'' < ''` is false, so the
 * inverted-range check let it through into the loop — where `addDays('')` calls
 * `toISOString()` on an Invalid Date and throws `RangeError`. That was a 500 on every
 * iteration with no dates.
 */
export function workingDaysBetween(
  start: string,
  end: string,
  workingDays: readonly number[] = DEFAULT_WORKING_DAYS,
): string[] {
  if (!isCalendarDate(start) || !isCalendarDate(end)) return [];
  if (end < start) return [];
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isWorkingDay(d, workingDays)) out.push(d);
  }
  return out;
}

// ── Workspace-local date boundaries ─────────────────────────────────────────
//
// "All timestamps and date cutoffs use the Workspace timezone. Store timestamps in UTC
// and convert to Workspace local date when applying an end-of-day or Iteration-end
// boundary." Implemented with Intl rather than a date library: the backend has no date
// dependency, and pulling one in for two functions would be the larger change.

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const at = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour` formats midnight as 24 under hour12:false in some ICU versions.
  const hour = at('hour') % 24;
  const asIfUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    hour,
    at('minute'),
    at('second'),
  );
  // Compare against the instant truncated to whole seconds. Intl reports no
  // milliseconds, so subtracting the untruncated instant would fold the instant's own
  // fractional second into the offset — enough to push a 23:59:59.999 boundary a second
  // past midnight.
  return asIfUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

/** The workspace-local calendar date (`YYYY-MM-DD`) an instant falls on. */
export function workspaceLocalDate(instant: Date, timeZone: string): string {
  return new Date(instant.getTime() + zoneOffsetMs(instant, timeZone)).toISOString().slice(0, 10);
}

/**
 * The instant a workspace-local day ENDS — the cutoff `acceptedDate <= endOfDay(d)`
 * compares against.
 *
 * Two passes: the offset has to be read at roughly the target instant, because reading
 * it at the wrong side of a DST change would move the boundary by an hour and silently
 * reclassify an item accepted late on the last evening of an iteration.
 */
export function endOfWorkspaceDay(localDate: string, timeZone: string): Date {
  const naive = new Date(`${localDate}T23:59:59.999Z`).getTime();
  const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  return new Date(naive - zoneOffsetMs(firstGuess, timeZone));
}

/**
 * Was this snapshot taken at the END of its own local day, or partway through it?
 *
 * IB-BR-01 calls the Burndown source an "end-of-day snapshot", and the job is what makes that true:
 * it writes TODAY repeatedly and the last write before local midnight is the value that survives. If
 * the job stops early — a crash, a deploy, a paused schedule — the surviving value is whatever the
 * morning looked like, and `finalizeSnapshotsBefore` freezes it anyway, because a closed day cannot be
 * re-measured. Freezing is right; presenting a 10:00 reading as the closing figure is not.
 *
 * The cron runs hourly, so a genuine end-of-day capture lands within an hour of local midnight. A
 * wider window would call a mid-afternoon crash "end of day"; a narrower one would flag a tick that
 * merely ran a few minutes early. `windowHours` is a parameter so a different schedule can say so
 * rather than silently inheriting an assumption about this one.
 */
export function isEndOfDayCapture(
  capturedAt: Date,
  localDate: string,
  timeZone: string,
  windowHours = 1,
): boolean {
  const closes = endOfWorkspaceDay(localDate, timeZone).getTime();
  const opensWindow = closes - windowHours * 60 * 60 * 1000;
  const at = capturedAt.getTime();
  // `<= closes` and not `< closes`: the final tick can land inside the same millisecond as the
  // boundary, and a capture AFTER the day closed belongs to the next day, not this one.
  return at >= opensWindow && at <= closes;
}

/** The instant a workspace-local day BEGINS. */
export function startOfWorkspaceDay(localDate: string, timeZone: string): Date {
  const naive = new Date(`${localDate}T00:00:00.000Z`).getTime();
  const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  return new Date(naive - zoneOffsetMs(firstGuess, timeZone));
}

/**
 * Has this workspace-local date finished?
 *
 * What makes a daily snapshot finalizable (IB §4): a closed day is frozen, today is
 * still being written. Comparing dates as strings rather than instants keeps the answer
 * in the workspace's own calendar.
 */
export function isDayClosed(localDate: string, now: Date, timeZone: string): boolean {
  return localDate < workspaceLocalDate(now, timeZone);
}

// ── Display rounding ────────────────────────────────────────────────────────

/**
 * "Aggregate full-precision source values first, then display… maximum two decimals."
 *
 * A number, not a string: the API returns numbers and the SPA formats them. Rounding
 * here exists so a sum of fractional points does not arrive as 43.000000000000004.
 */
export function roundForDisplay(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
