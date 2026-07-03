/**
 * LexoRank — lexicographically-orderable fractional keys for backlog ordering.
 *
 * A rank is a string of base-36 digits (`0-9a-z`). Items are ordered by plain
 * string comparison of their ranks. To place an item between two neighbours we
 * compute a string strictly between their ranks, so a single-item move is a
 * single-row UPDATE — no re-numbering of the whole backlog.
 *
 * The alphabet is `0-9a-z` (digit value 0..35). Ranks are treated as fractions
 * in base 36: the value of `"abc"` is 0.abc₍₃₆₎. `between(a, b)` returns a rank
 * `r` with `a < r < b` under string comparison. Either bound may be omitted to
 * mean "before everything" (`null` low) or "after everything" (`null` high).
 *
 * When the gap between two adjacent ranks is exhausted (no shorter midpoint
 * exists) we extend the length, so the space is effectively unbounded; a full
 * project-scoped rebalance is only ever needed if ranks grow pathologically
 * long, which the caller can detect via {@link rankNeedsRebalance}.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length; // 36
const MIN_CHAR = ALPHABET[0]!; // '0'
const MAX_CHAR = ALPHABET[BASE - 1]!; // 'z'

/** Ranks longer than this suggest the neighbour gap is degenerate — rebalance. */
export const RANK_REBALANCE_THRESHOLD = 48;

function digit(c: string): number {
  const v = ALPHABET.indexOf(c);
  if (v < 0) throw new Error(`Invalid LexoRank character: ${JSON.stringify(c)}`);
  return v;
}

/**
 * Compute a rank strictly between `low` and `high` under string comparison.
 *
 * - `between(null, null)` → a middle rank for the first item.
 * - `between(low, null)`  → a rank after `low` (append to end).
 * - `between(null, high)` → a rank before `high` (prepend to start).
 *
 * Throws if `low >= high`.
 */
export function between(low: string | null, high: string | null): string {
  const a = low ?? '';
  const b = high ?? '';

  if (low !== null && high !== null && low >= high) {
    throw new Error(`LexoRank neighbours out of order: ${low} >= ${high}`);
  }

  let result = '';
  let i = 0;

  // Walk digit positions, carrying the constraint a < result < b.
  for (;;) {
    const lo = i < a.length ? digit(a[i]!) : 0;
    // With no upper bound, treat the ceiling as BASE (one past 'z') so we can
    // pick a digit strictly above `lo` and terminate.
    const hi = i < b.length ? digit(b[i]!) : BASE;

    if (lo === hi) {
      // Digits equal here — copy and descend to the next position.
      result += ALPHABET[lo];
      i += 1;
      continue;
    }

    const mid = Math.floor((lo + hi) / 2);
    if (mid > lo) {
      // There is room for a digit strictly between the bounds at this position.
      return result + ALPHABET[mid];
    }

    // Adjacent digits (hi === lo + 1): no integer between them. Keep the low
    // digit and append below it, staying above `a` on subsequent positions.
    result += ALPHABET[lo];
    i += 1;

    // Once past the end of `a`, any digit above MIN keeps us > a and < b.
    if (i >= a.length) {
      return result + ALPHABET[Math.floor(BASE / 2)];
    }
  }
}

/** Initial rank when a list is empty (a comfortable midpoint). */
export function initialRank(): string {
  return ALPHABET[Math.floor(BASE / 2)]!; // 'i'
}

/** True when a rank has grown long enough to warrant a project-scoped rebalance. */
export function rankNeedsRebalance(rank: string): boolean {
  return rank.length > RANK_REBALANCE_THRESHOLD;
}

/**
 * Evenly-spaced ranks for `count` items — used to (re)initialise or rebalance a
 * whole ordered list in one pass. Returns `count` strictly-increasing ranks.
 */
export function evenlySpacedRanks(count: number): string[] {
  if (count <= 0) return [];
  const ranks: string[] = [];
  let prev: string | null = null;
  for (let n = 0; n < count; n += 1) {
    const next = between(prev, null);
    ranks.push(next);
    prev = next;
  }
  return ranks;
}

export const LEXORANK_MIN_CHAR = MIN_CHAR;
export const LEXORANK_MAX_CHAR = MAX_CHAR;
