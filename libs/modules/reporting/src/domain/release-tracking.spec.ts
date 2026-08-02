import { describe, expect, it } from 'vitest';
import {
  bucketFeatures,
  buildBurnup,
  derivedStatus,
  directStatus,
  featureProgress,
  inScope,
  isFullMismatch,
  preliminaryTotal,
  releaseMismatches,
  releaseTotals,
  trackedLeaves,
  unparentedItems,
  type ReleaseChild,
  type ReleaseFeature,
} from './release-tracking';
import { ALL_TEAMS } from './report-scope';

const REL_A = 'rel-a';
const REL_B = 'rel-b';
const T1 = { kind: 'team', teamId: 't1' } as const;

const child = (over: Partial<ReleaseChild> = {}): ReleaseChild => ({
  id: 'c1',
  itemKey: 'US-1',
  type: 'story',
  title: 'A story',
  featureId: 'f1',
  releaseId: REL_A,
  releaseName: 'Release A',
  teamId: 't1',
  teamName: 'Team One',
  planEstimate: 5,
  acceptedEquivalent: false,
  scheduleState: 'defined',
  ...over,
});

const feature = (over: Partial<ReleaseFeature> = {}): ReleaseFeature => ({
  id: 'f1',
  itemKey: 'FE-311',
  name: 'Enterprise Authentication Suite',
  releaseId: REL_A,
  teamId: 't1',
  teamName: 'Team One',
  rank: 'a',
  plannedStartDate: null,
  plannedEndDate: null,
  refinedPoints: 0,
  refinedCount: 0,
  preliminaryPoints: 5,
  preliminaryCount: 3,
  ...over,
});

describe('inScope', () => {
  it('admits every Team under All Teams, including work with no Team yet', () => {
    expect(inScope('t1', ALL_TEAMS)).toBe(true);
    expect(inScope(null, ALL_TEAMS)).toBe(true);
  });

  it('admits only the selected Team otherwise (example 7)', () => {
    expect(inScope('t1', T1)).toBe(true);
    expect(inScope('t2', T1)).toBe(false);
    expect(inScope(null, T1)).toBe(false);
  });
});

describe('bucketFeatures (RT-BR-01, RT-BR-02)', () => {
  it('is Direct under its own Release and Derived under a child’s Release (example 1)', () => {
    const f1 = feature({ releaseId: REL_A });
    const s1 = child({ id: 's1', featureId: 'f1', releaseId: REL_B });

    const forA = bucketFeatures([f1], [s1], REL_A, ALL_TEAMS);
    expect(forA.direct.map((f) => f.id)).toEqual(['f1']);
    expect(forA.derived).toEqual([]);

    const forB = bucketFeatures([f1], [s1], REL_B, ALL_TEAMS);
    expect(forB.direct).toEqual([]);
    expect(forB.derived.map((f) => f.id)).toEqual(['f1']);
    expect(forB.derivedCause.get('f1')?.map((c) => c.id)).toEqual(['s1']);
  });

  it('never counts a Feature already in the Release as Derived for it (example 5)', () => {
    // Classification reads Feature.releaseId, not a child-match percentage.
    const f2 = feature({ id: 'f2', releaseId: REL_B });
    const someChildrenElsewhere = [
      child({ id: 'a', featureId: 'f2', releaseId: REL_B }),
      child({ id: 'b', featureId: 'f2', releaseId: REL_A }),
    ];
    const forB = bucketFeatures([f2], someChildrenElsewhere, REL_B, ALL_TEAMS);
    expect(forB.direct.map((f) => f.id)).toEqual(['f2']);
    expect(forB.derived).toEqual([]);
  });

  it('does not make a Feature Derived through a child with no Release (RT-BR-03, example 2)', () => {
    const f3 = feature({ id: 'f3', releaseId: null });
    const orphanChild = child({ id: 's2', featureId: 'f3', releaseId: null, releaseName: null });
    const forA = bucketFeatures([f3], [orphanChild], REL_A, ALL_TEAMS);
    expect(forA.direct).toEqual([]);
    expect(forA.derived).toEqual([]);
  });

  it('applies the Team scope to both the Feature and the causing child', () => {
    const own = feature({ id: 'f4', releaseId: REL_A, teamId: 't2' });
    expect(bucketFeatures([own], [], REL_A, T1).direct).toEqual([]);

    const other = feature({ id: 'f5', releaseId: null });
    const causeOutOfScope = child({ id: 's3', featureId: 'f5', releaseId: REL_A, teamId: 't2' });
    expect(bucketFeatures([other], [causeOutOfScope], REL_A, T1).derived).toEqual([]);
  });
});

describe('unparentedItems (RT-BR-04, example 3)', () => {
  const d1 = child({
    id: 'd1',
    itemKey: 'DE-1',
    type: 'defect',
    featureId: null,
    releaseId: REL_B,
  });

  it('appears only under its own Release and a scope containing its Team', () => {
    expect(unparentedItems([d1], REL_B, ALL_TEAMS).map((c) => c.id)).toEqual(['d1']);
    expect(unparentedItems([d1], REL_A, ALL_TEAMS)).toEqual([]);
    expect(unparentedItems([d1], REL_B, { kind: 'team', teamId: 't2' })).toEqual([]);
  });

  it('excludes an item that has a Feature parent', () => {
    expect(
      unparentedItems([child({ featureId: 'f1', releaseId: REL_B })], REL_B, ALL_TEAMS),
    ).toEqual([]);
  });
});

describe('Status cells (RT-BR-05, RT-AC-07)', () => {
  const children = [
    child({ id: 'a', planEstimate: 5, releaseId: REL_A, acceptedEquivalent: true }),
    child({ id: 'b', planEstimate: 3, releaseId: REL_B }),
    child({ id: 'c', planEstimate: 2, releaseId: null }),
  ];

  it('uses EVERY direct child for a Direct Feature, including other/no Release', () => {
    expect(directStatus(children, 'points')).toEqual({ accepted: 5, total: 10, percent: 50 });
    expect(directStatus(children, 'count')).toEqual({ accepted: 1, total: 3, percent: 33 });
  });

  it('floors the percentage so 99.x never displays as 100', () => {
    const nearly = [
      child({ id: 'x', planEstimate: 99.6, acceptedEquivalent: true }),
      child({ id: 'y', planEstimate: 0.4 }),
    ];
    expect(directStatus(nearly, 'points').percent).toBe(99);
  });

  it('uses only the matching-Release scoped children for a Derived Feature, with no percentage', () => {
    const scoped = [
      child({ id: 'a', planEstimate: 5, releaseId: REL_A, acceptedEquivalent: true }),
    ];
    expect(derivedStatus(scoped, 'points')).toEqual({ accepted: 5, total: 5, percent: null });
  });

  it('returns a null percentage rather than 0% when nothing is linked', () => {
    expect(directStatus([], 'points')).toEqual({ accepted: 0, total: 0, percent: null });
  });
});

describe('release totals (RT-BR-06…08, RT-AC-08)', () => {
  const leaves = [
    child({ id: 'a', planEstimate: 5, acceptedEquivalent: true, scheduleState: 'accepted' }),
    child({ id: 'b', planEstimate: 3, acceptedEquivalent: true, scheduleState: 'release' }),
    child({ id: 'c', planEstimate: 8, acceptedEquivalent: false, scheduleState: 'completed' }),
  ];

  it('counts Accepted and Release but not Completed (example 4)', () => {
    expect(releaseTotals(leaves, [], 'points')).toEqual({
      planned: 16,
      accepted: 8,
      preliminary: 0,
    });
  });

  it('switches every numerator and denominator with the unit (example 6)', () => {
    expect(releaseTotals(leaves, [], 'count')).toEqual({ planned: 3, accepted: 2, preliminary: 0 });
  });

  it('builds the tracked population from release + scope and de-duplicates by id', () => {
    const all = [
      child({ id: 'a', releaseId: REL_A, teamId: 't1' }),
      child({ id: 'a', releaseId: REL_A, teamId: 't1' }), // same item, second join path
      child({ id: 'b', releaseId: REL_B, teamId: 't1' }),
      child({ id: 'c', releaseId: REL_A, teamId: 't2' }),
    ];
    expect(trackedLeaves(all, REL_A, ALL_TEAMS).map((c) => c.id)).toEqual(['a', 'c']);
    expect(trackedLeaves(all, REL_A, T1).map((c) => c.id)).toEqual(['a']);
  });

  it('prefers the refined forecast over the Preliminary size mapping, and de-duplicates Features', () => {
    const refined = feature({ id: 'f1', refinedPoints: 21, refinedCount: 9 });
    const sized = feature({
      id: 'f2',
      refinedPoints: 0,
      refinedCount: 0,
      preliminaryPoints: 8,
      preliminaryCount: 4,
    });
    expect(preliminaryTotal([refined, sized, refined], 'points')).toBe(29);
    expect(preliminaryTotal([refined, sized, refined], 'count')).toBe(13);
  });
});

describe('issues (RT §5, RT-AC-10, RT-AC-11)', () => {
  it('flags a child pointing at another Release and ignores an unassigned one', () => {
    const children = [
      child({ id: 'a', releaseId: REL_A }),
      child({ id: 'b', releaseId: REL_B, releaseName: 'Release B' }),
      child({ id: 'c', releaseId: null, releaseName: null }),
    ];
    const issues = releaseMismatches(children, REL_A);
    expect(issues.map((i) => i.childId)).toEqual(['b']);
    expect(issues[0].itemReleaseName).toBe('Release B');
  });

  it('warns separately when EVERY release-assigned child mismatches (example 8)', () => {
    const allElsewhere = [
      child({ id: 'a', releaseId: REL_B, acceptedEquivalent: true }),
      child({ id: 'b', releaseId: REL_B, acceptedEquivalent: true }),
      child({ id: 'c', releaseId: null }),
    ];
    expect(isFullMismatch(allElsewhere, REL_A)).toBe(true);
    // Independent of % Done: this Feature is fully accepted and still fully mismatched.
    expect(
      directStatus(
        allElsewhere.filter((c) => c.releaseId !== null),
        'count',
      ).percent,
    ).toBe(100);
  });

  it('does not call a partially matching Feature a full mismatch', () => {
    expect(
      isFullMismatch(
        [child({ id: 'a', releaseId: REL_A }), child({ id: 'b', releaseId: REL_B })],
        REL_A,
      ),
    ).toBe(false);
  });

  it('reports total, Story and Defect progress from ALL direct children', () => {
    const children = [
      child({ id: 'a', type: 'story', planEstimate: 4, acceptedEquivalent: true }),
      child({ id: 'b', type: 'story', planEstimate: 2 }),
      child({ id: 'c', type: 'defect', planEstimate: 0 }),
      child({ id: 'd', type: 'defect', planEstimate: 0, acceptedEquivalent: true }),
    ];
    const p = featureProgress(children);
    expect(p.points).toEqual({ accepted: 4, total: 6, percent: 66 });
    expect(p.stories).toEqual({ accepted: 1, total: 2, percent: 50 });
    expect(p.defects).toEqual({ accepted: 1, total: 2, percent: 50 });
  });
});

describe('buildBurnup (RT-BR-09)', () => {
  const axis = ['2026-01-01', '2026-01-02', '2026-01-03'];

  it('draws Ideal from 0 to the persisted target across the window', () => {
    const { points } = buildBurnup({ axis, idealTarget: 30, snapshots: [] });
    expect(points.map((p) => p.ideal)).toEqual([0, 15, 30]);
  });

  it('emits null for a day with no snapshot instead of a fabricated zero', () => {
    const { points, historyState } = buildBurnup({
      axis,
      idealTarget: 30,
      snapshots: [{ date: '2026-01-02', accepted: 5, planned: 25, preliminary: 18 }],
    });
    expect(points.map((p) => p.accepted)).toEqual([null, 5, null]);
    expect(historyState).toBe('partial');
  });

  it('has no Ideal at all without a persisted baseline', () => {
    // Reconstructing it from today's Planned value is what RT-BR-09 forbids.
    const { points, historyState } = buildBurnup({ axis, idealTarget: null, snapshots: [] });
    expect(points.every((p) => p.ideal === null)).toBe(true);
    expect(historyState).toBe('no-baseline');
  });

  it('reports missing history when a baseline exists but nothing was captured', () => {
    expect(buildBurnup({ axis, idealTarget: 30, snapshots: [] }).historyState).toBe('missing');
  });

  it('is complete when every axis day was captured', () => {
    const snapshots = axis.map((date) => ({ date, accepted: 1, planned: 2, preliminary: 3 }));
    expect(buildBurnup({ axis, idealTarget: 30, snapshots }).historyState).toBe('complete');
  });
});
