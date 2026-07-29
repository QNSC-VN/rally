/**
 * Date / duration helpers — single source for time-offset math so TTL logic is
 * not re-derived (and mis-derived) at each call site.
 */
import { z } from 'zod';

/**
 * A calendar date on the wire: `YYYY-MM-DD`, no time and no zone.
 *
 * Shared because `date` columns are compared and displayed as plain calendar days —
 * accepting a full ISO timestamp would let a client's zone shift the stored day. This
 * was copy-pasted identically into the releases and projects DTOs; keep new date
 * fields on this one so the error message and the accepted shape stay uniform.
 */
export const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format');

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Returns a new Date `days` from `from` (default now). */
export function addDays(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}

/** Returns a new Date `hours` from `from` (default now). */
export function addHours(hours: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + hours * MS_PER_HOUR);
}

/**
 * Parse a duration string into seconds. Accepts a bare number (seconds) or a
 * value suffixed with s/m/h/d (e.g. '15m', '1h', '7d', '30s', '900').
 * Used to keep client-facing `expiresIn` in sync with the JWT signing config.
 */
export function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration string: "${duration}"`);
  }
  const value = Number(match[1]);
  switch (match[2]) {
    case 'd':
      return value * 24 * 60 * 60;
    case 'h':
      return value * 60 * 60;
    case 'm':
      return value * 60;
    case 's':
    case undefined:
    default:
      return value;
  }
}
