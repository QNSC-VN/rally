import { describe, it, expect } from 'vitest';
import {
  between,
  initialRank,
  evenlySpacedRanks,
  rankNeedsRebalance,
  RANK_REBALANCE_THRESHOLD,
} from './lexorank.util';

describe('lexorank', () => {
  it('produces a rank between null bounds', () => {
    const r = between(null, null);
    expect(r).toBe(initialRank());
  });

  it('produces a rank after low (append)', () => {
    const r = between('i', null);
    expect(r > 'i').toBe(true);
  });

  it('produces a rank before high (prepend)', () => {
    const r = between(null, 'i');
    expect(r < 'i').toBe(true);
    expect(r > '').toBe(true);
  });

  it('produces a rank strictly between two neighbours', () => {
    const r = between('a', 'b');
    expect(r > 'a').toBe(true);
    expect(r < 'b').toBe(true);
  });

  it('handles adjacent single-digit neighbours by extending length', () => {
    const r = between('a', 'b'); // adjacent digits 10 and 11
    expect(r > 'a').toBe(true);
    expect(r < 'b').toBe(true);
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it('handles adjacent multi-char neighbours', () => {
    const low = 'aaaa';
    const high = 'aaab';
    const r = between(low, high);
    expect(r > low).toBe(true);
    expect(r < high).toBe(true);
  });

  it('throws when neighbours are out of order', () => {
    expect(() => between('b', 'a')).toThrow();
    expect(() => between('a', 'a')).toThrow();
  });

  it('supports repeated insertion between the same tightening gap', () => {
    let low = 'a';
    const high = 'b';
    let prev = low;
    for (let n = 0; n < 50; n += 1) {
      const r = between(low, high);
      expect(r > low).toBe(true);
      expect(r < high).toBe(true);
      expect(r > prev || low !== prev).toBe(true);
      prev = r;
      low = r; // keep inserting just after the newest item
    }
  });

  it('evenlySpacedRanks returns strictly increasing ranks', () => {
    const ranks = evenlySpacedRanks(20);
    expect(ranks).toHaveLength(20);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]! > ranks[i - 1]!).toBe(true);
    }
    expect(evenlySpacedRanks(0)).toEqual([]);
  });

  it('flags overly-long ranks for rebalance', () => {
    expect(rankNeedsRebalance('i')).toBe(false);
    expect(rankNeedsRebalance('x'.repeat(RANK_REBALANCE_THRESHOLD + 1))).toBe(true);
  });
});
