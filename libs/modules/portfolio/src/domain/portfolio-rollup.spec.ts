import { describe, expect, it } from 'vitest';
import {
  computeCapacityWarnings,
  computeCutlineIndex,
  computePortfolioProgress,
  defaultAllocationEstimate,
  resolveEstimate,
  type PortfolioForecastInput,
  type PortfolioRollupInput,
} from './portfolio-rollup';

const rollup = (over: Partial<PortfolioRollupInput> = {}): PortfolioRollupInput => ({
  rollupPoints: 0,
  rollupCount: 0,
  acceptedPoints: 0,
  acceptedCount: 0,
  ...over,
});

// The BA-documented default mapping for size M: 5 points / 3 items.
const forecast = (over: Partial<PortfolioForecastInput> = {}): PortfolioForecastInput => ({
  refinedPoints: null,
  refinedCount: null,
  preliminaryPoints: 5,
  preliminaryCount: 3,
  ...over,
});

describe('computePortfolioProgress', () => {
  it('divides accepted by the live rollup for the two Percent Done indicators', () => {
    const p = computePortfolioProgress(
      rollup({ rollupPoints: 40, acceptedPoints: 10, rollupCount: 8, acceptedCount: 2 }),
      forecast(),
    );
    expect(p.percentDoneByPlanEstimate).toBe(0.25);
    expect(p.percentDoneByCount).toBe(0.25);
  });

  it('keeps the two Percent Done dimensions independent', () => {
    // Weighted and unweighted progress genuinely differ: two big stories accepted out
    // of eight is 60% of the points but 25% of the count. Both are shown because they
    // answer different questions.
    const p = computePortfolioProgress(
      rollup({ rollupPoints: 50, acceptedPoints: 30, rollupCount: 8, acceptedCount: 2 }),
      forecast(),
    );
    expect(p.percentDoneByPlanEstimate).toBe(0.6);
    expect(p.percentDoneByCount).toBe(0.25);
  });

  it('scope growth lowers Percent Done, because the denominator is live', () => {
    const before = computePortfolioProgress(
      rollup({ rollupPoints: 10, acceptedPoints: 5 }),
      forecast(),
    );
    const afterAddingWork = computePortfolioProgress(
      rollup({ rollupPoints: 20, acceptedPoints: 5 }),
      forecast(),
    );
    expect(before.percentDoneByPlanEstimate).toBe(0.5);
    expect(afterAddingWork.percentDoneByPlanEstimate).toBe(0.25);
  });

  describe('Estimated Progress uses the forecast as denominator', () => {
    it('uses the refined estimate when supplied', () => {
      const p = computePortfolioProgress(
        rollup({ acceptedPoints: 6, acceptedCount: 4 }),
        forecast({ refinedPoints: 12, refinedCount: 8 }),
      );
      expect(p.estimatedProgressByPoints).toBe(0.5);
      expect(p.estimatedProgressByCount).toBe(0.5);
    });

    it('falls back to the Preliminary Estimate mapping when not refined', () => {
      const p = computePortfolioProgress(
        rollup({ acceptedPoints: 1, acceptedCount: 3 }),
        forecast(), // 5 points / 3 count
      );
      expect(p.estimatedProgressByPoints).toBe(0.2);
      expect(p.estimatedProgressByCount).toBe(1);
    });

    it('falls back per dimension independently', () => {
      // Refining points must not silently change the count indicator's denominator.
      const p = computePortfolioProgress(
        rollup({ acceptedPoints: 5, acceptedCount: 3 }),
        forecast({ refinedPoints: 20, refinedCount: null }),
      );
      expect(p.estimatedProgressByPoints).toBe(0.25); // 5/20 refined
      expect(p.estimatedProgressByCount).toBe(1); // 3/3 preliminary
    });
  });

  describe('null is not zero', () => {
    // "Nothing linked" and "nothing done" both render as an empty bar, but only the
    // first is a data-entry gap. Collapsing them to 0 would hide that.
    it('returns null for Percent Done when nothing is linked', () => {
      const p = computePortfolioProgress(rollup(), forecast());
      expect(p.percentDoneByPlanEstimate).toBeNull();
      expect(p.percentDoneByCount).toBeNull();
    });

    it('returns 0, not null, when work is linked but none accepted', () => {
      const p = computePortfolioProgress(rollup({ rollupPoints: 10, rollupCount: 4 }), forecast());
      expect(p.percentDoneByPlanEstimate).toBe(0);
      expect(p.percentDoneByCount).toBe(0);
    });

    it('returns null for Estimated Progress when the forecast is No Entry', () => {
      // Preliminary 'no_entry' maps to 0/0, so there is no target to measure against.
      const p = computePortfolioProgress(
        rollup({ acceptedPoints: 5 }),
        forecast({ preliminaryPoints: 0, preliminaryCount: 0 }),
      );
      expect(p.estimatedProgressByPoints).toBeNull();
      expect(p.estimatedProgressByCount).toBeNull();
    });
  });

  it('does not clamp Estimated Progress above 1', () => {
    // Delivering more than forecast is real information — the forecast was low.
    // Percent Done cannot exceed 1 (its denominator contains the numerator), but this
    // one can, and truncating it to 100% would hide the miss.
    const p = computePortfolioProgress(
      rollup({ acceptedPoints: 20 }),
      forecast({ refinedPoints: 10 }),
    );
    expect(p.estimatedProgressByPoints).toBe(2);
  });
});

describe('resolveEstimate — Allocated → Refined → Preliminary', () => {
  it('prefers allocated over every forecast', () => {
    // Once demand is committed, that total is the truth.
    expect(resolveEstimate({ totalAllocated: 30, refined: 20, preliminary: 5 })).toEqual({
      value: 30,
      tier: 'allocated',
    });
  });

  it('prefers refined over preliminary when nothing is allocated', () => {
    expect(resolveEstimate({ totalAllocated: 0, refined: 20, preliminary: 5 })).toEqual({
      value: 20,
      tier: 'refined',
    });
  });

  it('falls back to preliminary', () => {
    expect(resolveEstimate({ totalAllocated: 0, refined: null, preliminary: 5 })).toEqual({
      value: 5,
      tier: 'preliminary',
    });
  });

  it('reports none when every tier is empty', () => {
    // Drives the "Point Estimated missing" warning.
    expect(resolveEstimate({ totalAllocated: 0, refined: null, preliminary: 0 })).toEqual({
      value: 0,
      tier: 'none',
    });
  });

  it('treats a zero refined estimate as absent', () => {
    // The DB CHECK forbids storing 0, but a caller computing it must agree.
    expect(resolveEstimate({ totalAllocated: 0, refined: 0, preliminary: 5 }).tier).toBe(
      'preliminary',
    );
  });
});

describe('defaultAllocationEstimate — the anti-circularity rule', () => {
  // The subtlest rule in the feature. The Allocate dialog's blank default must NOT
  // consult the allocated tier: folding it back in would mean a blank field commits
  // the sum of the very allocations it is being used to create.
  it('ignores allocated even when allocations already exist', () => {
    expect(defaultAllocationEstimate({ refined: 20, preliminary: 5 })).toEqual({
      value: 20,
      tier: 'refined',
    });
  });

  it('differs from resolveEstimate for the same feature', () => {
    const input = { totalAllocated: 30, refined: 20, preliminary: 5 };
    expect(resolveEstimate(input).tier).toBe('allocated');
    expect(defaultAllocationEstimate(input).tier).toBe('refined');
  });

  it('falls back to preliminary, then none', () => {
    expect(defaultAllocationEstimate({ refined: null, preliminary: 5 }).tier).toBe('preliminary');
    expect(defaultAllocationEstimate({ refined: null, preliminary: 0 })).toEqual({
      value: 0,
      tier: 'none',
    });
  });
});

describe('computeCapacityWarnings', () => {
  it('warns when the rollup outgrows the commitment', () => {
    expect(computeCapacityWarnings({ rollup: 40, estimated: 30, capacity: 100 })).toContain(
      'rollup_exceeds_estimated',
    );
  });

  it('warns when the rollup exceeds capacity', () => {
    expect(computeCapacityWarnings({ rollup: 120, estimated: 130, capacity: 100 })).toContain(
      'rollup_exceeds_capacity',
    );
  });

  it('warns when committed demand exceeds capacity', () => {
    expect(computeCapacityWarnings({ rollup: 0, estimated: 130, capacity: 100 })).toContain(
      'estimated_exceeds_capacity',
    );
  });

  it('returns nothing when everything fits', () => {
    expect(computeCapacityWarnings({ rollup: 20, estimated: 30, capacity: 100 })).toEqual([]);
  });

  describe('Feature rows carry no capacity of their own', () => {
    it('evaluates only the rollup-vs-estimated rule when capacity is null', () => {
      // The spec's Feature-row behaviour, with no separate code path.
      expect(computeCapacityWarnings({ rollup: 40, estimated: 30, capacity: null })).toEqual([
        'rollup_exceeds_estimated',
      ]);
    });

    it('returns nothing for a healthy Feature row', () => {
      expect(computeCapacityWarnings({ rollup: 10, estimated: 30, capacity: null })).toEqual([]);
    });
  });

  describe('target load — Rally advises leaving ~20% spare', () => {
    it('warns above the target but under capacity', () => {
      // 95 of 100 with an 80% target: not over capacity, but no room for a defect.
      expect(
        computeCapacityWarnings({ rollup: 0, estimated: 95, capacity: 100, targetLoadPct: 80 }),
      ).toContain('load_above_target');
    });

    it('stays silent at or below the target', () => {
      expect(
        computeCapacityWarnings({ rollup: 0, estimated: 80, capacity: 100, targetLoadPct: 80 }),
      ).toEqual([]);
    });

    it('does not add the target warning once genuinely over capacity', () => {
      // The over-capacity rule already fired; repeating the point is noise.
      const w = computeCapacityWarnings({
        rollup: 0,
        estimated: 130,
        capacity: 100,
        targetLoadPct: 80,
      });
      expect(w).toContain('estimated_exceeds_capacity');
      expect(w).not.toContain('load_above_target');
    });

    it('is disabled by a target of 100 or an absent target', () => {
      const at100 = computeCapacityWarnings({
        rollup: 0,
        estimated: 95,
        capacity: 100,
        targetLoadPct: 100,
      });
      const absent = computeCapacityWarnings({ rollup: 0, estimated: 95, capacity: 100 });
      expect(at100).toEqual([]);
      expect(absent).toEqual([]);
    });
  });

  it('ignores capacity rules when capacity is zero', () => {
    // Zero capacity is a planner statement, but dividing a target by it is meaningless.
    const w = computeCapacityWarnings({ rollup: 5, estimated: 5, capacity: 0, targetLoadPct: 80 });
    expect(w).toEqual([]);
  });
});

describe('computeCutlineIndex', () => {
  // Rally draws the line only in rank-ascending order: in any other order a running
  // total means nothing.
  it('returns the index of the last item that fits', () => {
    // 30+25+20+25 = 100 exactly; the fifth item would exceed.
    expect(computeCutlineIndex([30, 25, 20, 25, 15], 100)).toBe(3);
  });

  it('includes an item that lands exactly on capacity', () => {
    expect(computeCutlineIndex([50, 50], 100)).toBe(1);
  });

  it('returns -1 when the first item alone exceeds capacity', () => {
    expect(computeCutlineIndex([150, 10], 100)).toBe(-1);
  });

  it('returns the last index when everything fits', () => {
    expect(computeCutlineIndex([10, 20, 30], 100)).toBe(2);
  });

  it('stops at the first overflow rather than packing later small items', () => {
    // Deliberately NOT a bin-packing optimisation: the cutline reflects priority
    // order, so a small item below the line stays below it.
    expect(computeCutlineIndex([90, 20, 5], 100)).toBe(0);
  });

  it('returns null when no capacity has been entered', () => {
    expect(computeCutlineIndex([10, 20], null)).toBeNull();
    expect(computeCutlineIndex([10, 20], 0)).toBeNull();
  });

  it('handles an empty list', () => {
    expect(computeCutlineIndex([], 100)).toBe(-1);
  });

  it('treats a zero-estimate item as fitting', () => {
    // An unestimated feature does not consume capacity, so it must not push the line up.
    expect(computeCutlineIndex([50, 0, 50], 100)).toBe(2);
  });
});
