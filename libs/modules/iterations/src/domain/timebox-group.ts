import { createHash } from 'node:crypto';

/**
 * The stable shared timebox identity two Teams' iterations use to line up.
 *
 * An iteration is (project, team?), so a project running per-team iterations has one
 * "Sprint 25.1" row per Team. Every All Teams aggregate — Velocity's bars, Burndown's
 * snapshots and start baselines — has to fuse those into ONE timebox, and the Phase 6
 * contract is explicit that a display name is not a safe key ("DEV must align
 * Team-specific Iterations using a stable shared timebox key"). The approved mockup
 * shows what happens without one: its velocity axis renders two adjacent bars both
 * labelled 25.1.
 *
 * DERIVED, not random, and computed exactly ONCE — at create.
 *
 *   • Derived means two concurrent creates for the same window cannot mint two groups.
 *     A read-then-write ("find a group with these dates, else make one") has a race
 *     whose outcome is a silently split bar, and nothing would ever repair it.
 *   • Derived also means an iteration created after migration 0088 lands in the same
 *     group as the rows that migration backfilled — the SQL there uses this identical
 *     expression.
 *   • Computed once means a later date edit does NOT recompute the group. That is the
 *     whole reason this is a stored identity rather than a key derived from the dates on
 *     every read: shifting one Team's end date by a day must not split a historical bar.
 *
 * Returns null when either date is missing: a dateless iteration belongs to no timebox
 * and is excluded from All Teams aggregation, rather than being collapsed into a shared
 * "no dates" bucket with every other unscheduled iteration in the project.
 *
 * Kept byte-compatible with the migration's
 * `md5(project_id::text || ':' || start_date::text || ':' || end_date::text)::uuid`:
 * md5 hex, then the canonical 8-4-4-4-12 hyphenation Postgres' uuid cast produces.
 * MD5 is used as a stable non-cryptographic digest here, never as a security primitive.
 */
export function timeboxGroupIdFor(
  projectId: string,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string | null {
  if (!startDate || !endDate) return null;
  const hex = createHash('md5').update(`${projectId}:${startDate}:${endDate}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
