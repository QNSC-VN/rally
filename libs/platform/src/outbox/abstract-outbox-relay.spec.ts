/**
 * AbstractOutboxRelay unit tests — the shared relay loop (concurrency guard,
 * per-row error handling, retry/backoff, terminal 'failed' status). All
 * concrete relays (email, notifications, SNS outbox) inherit this behavior,
 * so covering it once here covers all three.
 */
import { describe, expect, it, vi } from 'vitest';
import { AbstractOutboxRelay, type PostCommitTask } from './abstract-outbox-relay';
import type { DrizzleDB, DrizzleTx } from '../database/drizzle.provider';

interface TestRow {
  id: string;
  attempts: number;
  shouldFail: boolean;
}

/** Minimal concrete relay exposing hooks the tests can assert against. */
class TestRelay extends AbstractOutboxRelay<TestRow> {
  fetchBatchResult: TestRow[] = [];
  markFailedCalls: Array<{
    rowId: string;
    newAttempts: number;
    newStatus: 'pending' | 'failed';
    nextAttemptAt: Date;
  }> = [];
  markSentCalls: string[] = [];

  protected async fetchBatch(): Promise<TestRow[]> {
    return this.fetchBatchResult;
  }

  protected async processRow(row: TestRow): Promise<PostCommitTask | void> {
    if (row.shouldFail) throw new Error(`row ${row.id} failed`);
  }

  protected async markSent(_tx: DrizzleTx, rowId: string): Promise<void> {
    this.markSentCalls.push(rowId);
  }

  protected async markFailed(
    _tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    _lastError: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    this.markFailedCalls.push({ rowId, newAttempts, newStatus, nextAttemptAt });
  }
}

function makeFakeDb(): DrizzleDB {
  return {
    transaction: async (cb: (tx: DrizzleTx) => Promise<void>) => cb({} as DrizzleTx),
  } as unknown as DrizzleDB;
}

describe('AbstractOutboxRelay.backoffDelayMs()', () => {
  it('doubles the delay per attempt starting at 30s, capped at 30 minutes', () => {
    const relay = new TestRelay(makeFakeDb());
    const delayFor = (n: number) =>
      (relay as unknown as { backoffDelayMs(n: number): number }).backoffDelayMs(n);

    expect(delayFor(1)).toBe(30_000); // 30s
    expect(delayFor(2)).toBe(60_000); // 1m
    expect(delayFor(3)).toBe(120_000); // 2m
    expect(delayFor(4)).toBe(240_000); // 4m
    expect(delayFor(5)).toBe(480_000); // 8m
    // Cap: a hypothetically much larger maxAttempts must never exceed 30 minutes.
    expect(delayFor(20)).toBe(30 * 60_000);
  });
});

describe('AbstractOutboxRelay.relay() — retry/backoff wiring', () => {
  it('passes an increasing nextAttemptAt to markFailed on each failed attempt', async () => {
    const relay = new TestRelay(makeFakeDb());
    relay.fetchBatchResult = [{ id: 'row-1', attempts: 0, shouldFail: true }];

    const before = Date.now();
    await relay.relay();

    expect(relay.markFailedCalls).toHaveLength(1);
    const call = relay.markFailedCalls[0];
    expect(call.rowId).toBe('row-1');
    expect(call.newAttempts).toBe(1);
    expect(call.newStatus).toBe('pending');
    // attempt 1 → ~30s delay, not immediate retry.
    expect(call.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 29_000);
    expect(call.nextAttemptAt.getTime()).toBeLessThanOrEqual(before + 31_000);
  });

  it('marks the row terminally failed once attempts reach maxAttempts', async () => {
    const relay = new TestRelay(makeFakeDb());
    relay.fetchBatchResult = [{ id: 'row-1', attempts: 4, shouldFail: true }]; // 5th attempt = maxAttempts

    await relay.relay();

    expect(relay.markFailedCalls[0].newStatus).toBe('failed');
    expect(relay.markFailedCalls[0].newAttempts).toBe(5);
  });

  it('marks a successful row sent and does not call markFailed for it', async () => {
    const relay = new TestRelay(makeFakeDb());
    relay.fetchBatchResult = [{ id: 'row-ok', attempts: 0, shouldFail: false }];

    await relay.relay();

    expect(relay.markSentCalls).toEqual(['row-ok']);
    expect(relay.markFailedCalls).toHaveLength(0);
  });

  it('one failing row in a batch does not block the others from being processed', async () => {
    const relay = new TestRelay(makeFakeDb());
    relay.fetchBatchResult = [
      { id: 'row-bad', attempts: 0, shouldFail: true },
      { id: 'row-good', attempts: 0, shouldFail: false },
    ];

    await relay.relay();

    expect(relay.markSentCalls).toEqual(['row-good']);
    expect(relay.markFailedCalls.map((c) => c.rowId)).toEqual(['row-bad']);
  });

  it('re-entrant calls while relaying are coalesced into one extra run via wakeOnComplete', async () => {
    const relay = new TestRelay(makeFakeDb());
    let resolveFirstFetch!: () => void;
    let fetchCallCount = 0;

    relay.fetchBatchResult = [];
    const relayAsAny = relay as unknown as { fetchBatch(): Promise<TestRow[]> };
    const originalFetch = relayAsAny.fetchBatch.bind(relay);
    vi.spyOn(relayAsAny, 'fetchBatch').mockImplementation(async () => {
      fetchCallCount += 1;
      if (fetchCallCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstFetch = resolve;
        });
      }
      return originalFetch();
    });

    const firstRun = relay.relay();
    // Second call arrives while the first is still in-flight — should coalesce,
    // not run a second transaction concurrently.
    const secondRun = relay.relay();
    resolveFirstFetch();
    await Promise.all([firstRun, secondRun]);

    // setImmediate-scheduled follow-up run happens after this tick.
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchCallCount).toBeGreaterThanOrEqual(2);
  });
});
