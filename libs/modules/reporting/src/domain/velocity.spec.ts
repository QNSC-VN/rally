import { describe, expect, it } from 'vitest';
import { buildBar, classify, computeAverages, selectWindow, type VelocityItem } from './velocity';
import { endOfWorkspaceDay } from './report-scope';

const END = endOfWorkspaceDay('2026-01-16', 'UTC');

const item = (over: Partial<VelocityItem> = {}): VelocityItem => ({
  id: 'i1',
  planEstimate: 5,
  acceptedEquivalent: true,
  acceptedDate: new Date('2026-01-16T10:00:00Z'),
  ...over,
});

describe('classify (Velocity §3)', () => {
  it('counts an item accepted ON the end date as During (example 1)', () => {
    expect(classify(item({ acceptedDate: new Date('2026-01-16T23:59:59Z') }), END)).toBe('during');
  });

  it('counts an item accepted the day after as After (example 2)', () => {
    expect(classify(item({ acceptedDate: new Date('2026-01-17T00:00:01Z') }), END)).toBe('after');
  });

  it('counts an item still in Completed as Not Accepted (example 3)', () => {
    // Completed is NOT accepted-equivalent — the distinction the whole report turns on.
    expect(classify(item({ acceptedEquivalent: false, acceptedDate: null }), END)).toBe(
      'not-accepted',
    );
  });

  it('keeps a Release item in During when its acceptance predates the end (example 4)', () => {
    expect(classify(item({ acceptedDate: new Date('2026-01-10T00:00:00Z') }), END)).toBe('during');
  });

  it('refuses to guess for an accepted item with no acceptedDate', () => {
    // "the report must not guess whether it was accepted during or after the Iteration"
    expect(classify(item({ acceptedDate: null }), END)).toBe('unclassified');
  });
});

describe('buildBar', () => {
  const bar = (items: VelocityItem[]) =>
    buildBar({
      timeboxKey: 'tb',
      name: 'Sprint 25.1',
      startDate: '2026-01-05',
      endDate: '2026-01-16',
      endBoundary: END,
      iterationCount: 1,
      items,
    });

  it('puts every point in exactly one segment and preserves the §3 invariant', () => {
    const result = bar([
      item({ id: 'a', planEstimate: 5, acceptedDate: new Date('2026-01-16T09:00:00Z') }),
      item({ id: 'b', planEstimate: 3, acceptedDate: new Date('2026-01-17T09:00:00Z') }),
      item({ id: 'c', planEstimate: 8, acceptedEquivalent: false, acceptedDate: null }),
      item({ id: 'd', planEstimate: 2, acceptedDate: null }), // data-quality gap
    ]);
    expect(result.acceptedDuring).toBe(5);
    expect(result.acceptedAfter).toBe(3);
    expect(result.notAccepted).toBe(8);
    expect(result.unclassified).toBe(2);
    expect(result.unclassifiedItems).toBe(1);
    // during + after + notAccepted + unclassified === every distinct assigned estimate
    expect(
      result.acceptedDuring + result.acceptedAfter + result.notAccepted + result.unclassified,
    ).toBe(18);
  });

  it('de-duplicates by work item id, which is what All Teams needs', () => {
    // The same story reached through two Teams' iteration joins must count once.
    const result = bar([item({ id: 'a', planEstimate: 5 }), item({ id: 'a', planEstimate: 5 })]);
    expect(result.acceptedDuring).toBe(5);
  });

  it('treats a missing plan estimate as zero points rather than dropping the item', () => {
    const result = bar([item({ id: 'a', planEstimate: null, acceptedEquivalent: false })]);
    expect(result.notAccepted).toBe(0);
  });
});

describe('computeAverages (Velocity §5 and §7.7)', () => {
  const bars = (during: number[]) =>
    during.map((v, i) =>
      buildBar({
        timeboxKey: `tb${i}`,
        name: `S${i}`,
        startDate: null,
        endDate: null,
        endBoundary: END,
        iterationCount: 1,
        items: [item({ id: `x${i}`, planEstimate: v })],
      }),
    );

  it('matches the worked example [36, 51, 43, 52, 34]', () => {
    const a = computeAverages(bars([36, 51, 43, 52, 34]));
    expect(a.last3).toBe(43); // [43, 52, 34]
    expect(a.best3).toBe(48.67); // [52, 51, 43]
    expect(a.worst3).toBe(37.67); // [34, 36, 43]
    expect(a.trend).toBe(43.2);
    expect(a.sampleSize).toBe(5);
  });

  it('uses every available value and reports the real sample size below three', () => {
    const a = computeAverages(bars([40, 20]));
    expect(a.last3).toBe(30);
    expect(a.best3).toBe(30);
    expect(a.worst3).toBe(30);
    expect(a.sampleSize).toBe(2);
  });

  it('returns nulls rather than zeros with no eligible iteration', () => {
    // A zero average would read as measured performance; there is nothing measured.
    expect(computeAverages([])).toEqual({
      trend: null,
      last3: null,
      best3: null,
      worst3: null,
      sampleSize: 0,
    });
  });

  it('excludes After and Not Accepted from every average', () => {
    const late = buildBar({
      timeboxKey: 'tb',
      name: 'S',
      startDate: null,
      endDate: null,
      endBoundary: END,
      iterationCount: 1,
      items: [
        item({ id: 'a', planEstimate: 5, acceptedDate: new Date('2026-01-20T00:00:00Z') }),
        item({ id: 'b', planEstimate: 8, acceptedEquivalent: false, acceptedDate: null }),
      ],
    });
    expect(computeAverages([late]).trend).toBe(0);
  });
});

describe('selectWindow (§2, §7.6)', () => {
  it('keeps the most recent N of the ascending list', () => {
    const eligible = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ endDate: `2026-01-0${n}` }));
    expect(selectWindow(eligible, 5).map((e) => e.endDate)).toEqual([
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
    ]);
    expect(selectWindow(eligible, 10)).toHaveLength(7);
  });
});
