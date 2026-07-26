import { describe, it, expect } from 'vitest';
import { changed, diffFields, type ActivityDiffConfig } from './activity-diff';

interface Item extends Record<string, unknown> {
  name: string;
  points: number | null;
  notes: string | null;
}

describe('changed', () => {
  it('treats null and undefined as equal (no change)', () => {
    expect(changed(null, undefined)).toBe(false);
    expect(changed(undefined, null)).toBe(false);
    expect(changed(null, null)).toBe(false);
  });

  it('compares by stable string form', () => {
    expect(changed(3, '3')).toBe(false);
    expect(changed(3, 4)).toBe(true);
    expect(changed(null, 0)).toBe(true);
    expect(changed('a', 'b')).toBe(true);
  });
});

describe('diffFields', () => {
  const config: ActivityDiffConfig<Item> = {
    fields: ['name', 'points', 'notes'],
    richText: ['notes'],
    action: (f) => `item.${f}_changed`,
  };

  it('emits only fields present in input AND actually changed', () => {
    const before: Item = { name: 'A', points: 3, notes: 'x' };
    const out = diffFields(before, { name: 'B', points: 3 }, config);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      action: 'item.name_changed',
      change: { field: 'name', old: 'A', new: 'B' },
    });
  });

  it('never logs rich-text bodies — records the change with null old/new', () => {
    const before: Item = { name: 'A', points: 3, notes: 'old body' };
    const out = diffFields(before, { notes: 'new body' }, config);
    expect(out).toEqual([
      { action: 'item.notes_changed', change: { field: 'notes', old: null, new: null } },
    ]);
  });

  it('preserves config field order and omits the action when unconfigured', () => {
    const before: Item = { name: 'A', points: 1, notes: null };
    const out = diffFields(before, { points: 2, name: 'B' }, { fields: ['name', 'points', 'notes'] });
    expect(out.map((e) => e.change.field)).toEqual(['name', 'points']);
    expect(out[0].action).toBeUndefined();
  });

  it('ignores undefined input fields (partial update) and coerces null defaults', () => {
    const before: Item = { name: 'A', points: null, notes: null };
    const out = diffFields(before, { points: 5 }, config);
    expect(out).toEqual([
      { action: 'item.points_changed', change: { field: 'points', old: null, new: 5 } },
    ]);
  });
});
