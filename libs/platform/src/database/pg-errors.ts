/**
 * Postgres error recognisers.
 *
 * Drizzle WRAPS driver errors ("Failed query: …") and keeps the original on `.cause`, so a check
 * against `err.code` alone silently never matches. Every recogniser here walks the whole cause
 * chain for that reason.
 *
 * Lives in `@platform` because two modules needed the same check: iterations and capacity plans
 * both mint a `XX-<n>` key from MAX+1 and both retry on the unique violation that a concurrent
 * create can produce. A second copy would be the drift this package exists to prevent.
 */

/** PG `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

function hasPgCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  while (current !== null && current !== undefined) {
    if (typeof current === 'object' && 'code' in current) {
      if ((current as Record<string, unknown>).code === code) return true;
    }
    if (typeof current === 'object' && 'cause' in current) {
      current = (current as Record<string, unknown>).cause;
    } else {
      return false;
    }
  }
  return false;
}

/** True when `err` (or anything on its `.cause` chain) is a PG unique-constraint violation. */
export function isDuplicateKeyError(err: unknown): boolean {
  return hasPgCode(err, UNIQUE_VIOLATION);
}
