import { describe, expect, it } from 'vitest';
import {
  ALL_TEAMS,
  DEFAULT_WORKING_DAYS,
  addDays,
  endOfWorkspaceDay,
  frozenSeriesScope,
  isDayClosed,
  isEmptyTeamScope,
  isWorkingDay,
  isoDayOfWeek,
  restrictedTeamScope,
  roundForDisplay,
  startOfWorkspaceDay,
  teamScope,
  workingDaysBetween,
  workspaceLocalDate,
} from './report-scope';

describe('teamScope', () => {
  it('treats a missing team as All Teams rather than an error', () => {
    expect(teamScope(null)).toEqual(ALL_TEAMS);
    expect(teamScope(undefined)).toEqual(ALL_TEAMS);
    expect(teamScope('')).toEqual(ALL_TEAMS);
    expect(teamScope('t1')).toEqual({ kind: 'team', teamId: 't1' });
  });
});

/**
 * The BA ruling of 2026-08-17: an Editor has no All Teams and no Project Backlog, so their scope is
 * a THIRD kind rather than a flag on the other two.
 */
describe('restrictedTeamScope', () => {
  it('is a distinct kind, so no query can mistake it for All Teams', () => {
    expect(restrictedTeamScope(['t1', 't2'])).toEqual({ kind: 'teams', teamIds: ['t1', 't2'] });
  });

  it('de-duplicates, so a doubled roster row cannot lengthen the IN list', () => {
    expect(restrictedTeamScope(['t1', 't1'])).toEqual({ kind: 'teams', teamIds: ['t1'] });
  });

  it('keeps a ONE-team scope distinguishable from a selected Team', () => {
    // Not `{ kind: 'team', teamId: 't1' }`: the difference is the Project Backlog, which a selected
    // Team admits (`inScope`) and a restricted reader must not see.
    expect(restrictedTeamScope(['t1'])).not.toEqual({ kind: 'team', teamId: 't1' });
  });

  it('reports an empty roster as EMPTY, never as unrestricted', () => {
    expect(isEmptyTeamScope(restrictedTeamScope([]))).toBe(true);
    expect(isEmptyTeamScope(restrictedTeamScope(['t1']))).toBe(false);
    expect(isEmptyTeamScope(ALL_TEAMS)).toBe(false);
    expect(isEmptyTeamScope(teamScope('t1'))).toBe(false);
  });
});

describe('frozenSeriesScope', () => {
  it('leaves an unrestricted reader exactly as they were', () => {
    expect(frozenSeriesScope(ALL_TEAMS)).toEqual({ kind: 'all' });
    expect(frozenSeriesScope(teamScope('t1'))).toEqual({ kind: 'team', teamId: 't1' });
  });

  it('serves a single-Team reader that Team OWN rows', () => {
    expect(frozenSeriesScope(restrictedTeamScope(['t1']))).toEqual({ kind: 'team', teamId: 't1' });
  });

  it('serves NOTHING to a multi-Team reader rather than leaking or summing', () => {
    // The `team_id IS NULL` row was measured over every Team (a disclosure), and summing the two
    // team rows is forbidden — for the release burnup it also double-counts a team-agnostic child.
    // So the series they asked for was never measured, and the report says unavailable.
    expect(frozenSeriesScope(restrictedTeamScope(['t1', 't2']))).toBeNull();
  });

  it('serves nothing to a reader with no Team at all', () => {
    expect(frozenSeriesScope(restrictedTeamScope([]))).toBeNull();
  });
});

describe('the working-day calendar', () => {
  it('numbers days ISO-style, Monday = 1 through Sunday = 7', () => {
    expect(isoDayOfWeek('2026-01-05')).toBe(1); // Monday
    expect(isoDayOfWeek('2026-01-10')).toBe(6); // Saturday
    expect(isoDayOfWeek('2026-01-11')).toBe(7); // Sunday
  });

  it('excludes the weekend under the Mon–Fri default', () => {
    expect(isWorkingDay('2026-01-09', DEFAULT_WORKING_DAYS)).toBe(true);
    expect(isWorkingDay('2026-01-10', DEFAULT_WORKING_DAYS)).toBe(false);
  });

  it('honours a non-Mon–Fri week, which is why the calendar is configuration', () => {
    const sunToThu = [7, 1, 2, 3, 4];
    expect(isWorkingDay('2026-01-11', sunToThu)).toBe(true); // Sunday works
    expect(isWorkingDay('2026-01-09', sunToThu)).toBe(false); // Friday does not
  });

  it('builds the burndown axis inclusively and skips weekends', () => {
    // The approved mockup's own axis: 10-14…10-18, then 10-21…10-25 — no 10-19/10-20.
    expect(workingDaysBetween('2024-10-14', '2024-10-21', DEFAULT_WORKING_DAYS)).toEqual([
      '2024-10-14',
      '2024-10-15',
      '2024-10-16',
      '2024-10-17',
      '2024-10-18',
      '2024-10-21',
    ]);
  });

  it('returns an empty axis for an inverted range or a weekend-only window', () => {
    expect(workingDaysBetween('2026-01-16', '2026-01-05')).toEqual([]);
    expect(workingDaysBetween('2026-01-10', '2026-01-11')).toEqual([]);
  });

  it('returns an empty axis for a MISSING or unparseable endpoint instead of throwing', () => {
    /**
     * The guard that stops a 500, not a defensive nicety.
     *
     * A dateless iteration reaches this function as `''` — the caller has nothing else to pass —
     * and `'' < ''` is false, so the inverted-range check let it through into the loop, where
     * `addDays('')` calls `toISOString()` on an Invalid Date and throws `RangeError: Invalid time
     * value`. Reproduced live as HTTP 500 against 99 of 206 local iterations.
     */
    expect(workingDaysBetween('', '')).toEqual([]);
    expect(workingDaysBetween('', '2026-01-16')).toEqual([]);
    expect(workingDaysBetween('2026-01-05', '')).toEqual([]);
    // Right shape, not a real date — `new Date` would roll it over to March.
    expect(workingDaysBetween('2026-02-30', '2026-03-02')).toEqual([]);
    expect(workingDaysBetween('not-a-date', '2026-01-16')).toEqual([]);
  });

  it('accepts a single-day window that IS a working day', () => {
    // The boundary the guard must not swallow: start === end is a legitimate one-day axis.
    expect(workingDaysBetween('2026-01-05', '2026-01-05')).toEqual(['2026-01-05']);
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // leap year
  });
});

describe('workspace-local boundaries', () => {
  it('resolves the local date an instant falls on', () => {
    // 23:30 UTC is already the next day in Ho Chi Minh City (UTC+7).
    const instant = new Date('2026-01-05T23:30:00Z');
    expect(workspaceLocalDate(instant, 'UTC')).toBe('2026-01-05');
    expect(workspaceLocalDate(instant, 'Asia/Ho_Chi_Minh')).toBe('2026-01-06');
  });

  it('ends the day at local midnight, not UTC midnight', () => {
    // The cutoff Velocity compares acceptedDate against. In UTC+7 the local day ends
    // 17:00 UTC, so an item accepted at 18:00 UTC belongs to the NEXT day — classifying it
    // as During would credit the iteration with work it did not finish in time.
    expect(endOfWorkspaceDay('2026-01-05', 'UTC').toISOString()).toBe('2026-01-05T23:59:59.999Z');
    expect(endOfWorkspaceDay('2026-01-05', 'Asia/Ho_Chi_Minh').toISOString()).toBe(
      '2026-01-05T16:59:59.999Z',
    );
    expect(startOfWorkspaceDay('2026-01-05', 'Asia/Ho_Chi_Minh').toISOString()).toBe(
      '2026-01-04T17:00:00.000Z',
    );
  });

  it('reads the offset at the target instant, so a DST change cannot move the boundary', () => {
    // New York is UTC-5 in January and UTC-4 in July. A fixed offset would put one of
    // these an hour out and silently reclassify anything accepted in that hour.
    expect(endOfWorkspaceDay('2026-01-15', 'America/New_York').toISOString()).toBe(
      '2026-01-16T04:59:59.999Z',
    );
    expect(endOfWorkspaceDay('2026-07-15', 'America/New_York').toISOString()).toBe(
      '2026-07-16T03:59:59.999Z',
    );
  });

  it('knows whether a local day has closed, which is what freezes a snapshot', () => {
    const now = new Date('2026-01-06T02:00:00Z'); // 09:00 on the 6th in UTC+7
    expect(isDayClosed('2026-01-05', now, 'Asia/Ho_Chi_Minh')).toBe(true);
    expect(isDayClosed('2026-01-06', now, 'Asia/Ho_Chi_Minh')).toBe(false);
    // Still the 5th in UTC-8, so the 5th is NOT closed there yet.
    expect(isDayClosed('2026-01-05', now, 'America/Los_Angeles')).toBe(false);
  });
});

describe('roundForDisplay', () => {
  it('rounds to two decimals only at the end, so sums keep full precision', () => {
    expect(roundForDisplay(0.1 + 0.2)).toBe(0.3);
    expect(roundForDisplay(43.005)).toBe(43.01);
    expect(roundForDisplay(129 / 3)).toBe(43);
  });
});
