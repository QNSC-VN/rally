import type { ActivityChange } from './activity-log.types';

/**
 * Config-driven field diff — the single replacement for every per-module diff
 * (diffWorkItem / diffIteration) and the duplicated `changed()` helpers.
 */
export interface ActivityDiffConfig<T> {
  /** Fields to diff, in the order entries should be emitted. */
  fields: (keyof T & string)[];
  /** Fields whose body is never logged — record that they changed, old/new null. */
  richText?: (keyof T & string)[];
  /** Field → action name (e.g. `scheduleState` → 'work_item.schedule_state_changed').
   *  When omitted, the caller supplies the action. */
  action?: (field: string) => string;
}

export interface ActivityDiffEntry {
  /** Present when the config maps the field to an action; else the caller decides. */
  action?: string;
  change: ActivityChange;
}

/** Normalise numeric-string / null|undefined for a stable "did it change" check. */
export function changed(before: unknown, after: unknown): boolean {
  const a = before === undefined ? null : before;
  const b = after === undefined ? null : after;
  if (a === null && b === null) return false;
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(a) !== String(b);
}

/**
 * Diff `before` against the requested `input` change-set per `config`. Only
 * fields present in `input` AND actually changed produce an entry; rich-text
 * fields emit the field name with null old/new (never the body).
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  input: Partial<T>,
  config: ActivityDiffConfig<T>,
): ActivityDiffEntry[] {
  const rich = new Set<string>(config.richText ?? []);
  const cur = before as Record<string, unknown>;
  const next = input as Record<string, unknown>;
  const out: ActivityDiffEntry[] = [];

  for (const field of config.fields) {
    if (next[field] === undefined) continue;
    if (!changed(cur[field], next[field])) continue;
    const isRich = rich.has(field);
    out.push({
      action: config.action?.(field),
      change: {
        field,
        old: isRich ? null : (cur[field] ?? null),
        new: isRich ? null : (next[field] ?? null),
      },
    });
  }
  return out;
}
