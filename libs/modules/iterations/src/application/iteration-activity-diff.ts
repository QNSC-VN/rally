import type { Iteration, UpdateIterationInput } from '../domain/iteration.types';
import type { ActivityChange } from '../domain/activity-log.types';

export interface IterationActivityDiffEntry {
  change: ActivityChange;
}

// Rich-text fields: record that they changed, but never the body.
const RICH_TEXT_FIELDS = new Set(['theme', 'notes', 'goal']);

/** Normalise numeric-string / null for stable comparison. */
function changed(before: unknown, after: unknown): boolean {
  const a = before === undefined ? null : before;
  const b = after === undefined ? null : after;
  if (a === null && b === null) return false;
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(a) !== String(b);
}

/**
 * Compute the revision entries for an iteration update by diffing the persisted
 * row against the requested change set. Only changed non-state fields produce an
 * entry (state transitions are logged separately via commit/accept). Rich-text
 * fields record the field name only, never the body.
 */
export function diffIteration(
  before: Iteration,
  input: UpdateIterationInput,
): IterationActivityDiffEntry[] {
  const out: IterationActivityDiffEntry[] = [];
  const cur = before as unknown as Record<string, unknown>;

  const add = (field: keyof UpdateIterationInput) => {
    if (input[field] === undefined) return;
    if (!changed(cur[field], input[field])) return;
    const isRich = RICH_TEXT_FIELDS.has(field);
    out.push({
      change: {
        field,
        old: isRich ? null : (cur[field] ?? null),
        new: isRich ? null : (input[field] ?? null),
      },
    });
  };

  add('name');
  add('goal');
  add('theme');
  add('notes');
  add('teamId');
  add('plannedVelocity');
  add('startDate');
  add('endDate');

  return out;
}
