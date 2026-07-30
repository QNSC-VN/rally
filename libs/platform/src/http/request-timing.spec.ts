import { describe, expect, it } from 'vitest';
import { albReceivedAtMs, arrivalAtMs, registerRequestTiming } from './request-timing';

/**
 * The decoding is the whole value of this module — a wrong epoch would produce a
 * plausible-looking `albWaitMs` that silently mis-attributes latency, which is the
 * exact failure the field exists to end.
 */
describe('albReceivedAtMs', () => {
  it('decodes the ALB receive time from a real trace id', () => {
    // Captured from production: 0x6a6a10cc = 1785336012 = 2026-07-29T14:40:12Z.
    const at = albReceivedAtMs('Root=1-6a6a10cc-48b353c62edb77150d3f7e54');
    expect(at).toBe(1785336012_000);
    expect(new Date(at!).toISOString()).toBe('2026-07-29T14:40:12.000Z');
  });

  it('accepts the header case-insensitively and with trailing segments', () => {
    expect(albReceivedAtMs('ROOT=1-6A6A10CC-48B353C62EDB77150D3F7E54;Sampled=1')).toBe(
      1785336012_000,
    );
  });

  it('returns undefined rather than guessing for anything that is not an ALB root id', () => {
    // Each of these would otherwise decode to a nonsense epoch and produce a
    // fabricated latency number. Absent is the honest answer.
    expect(albReceivedAtMs(undefined)).toBeUndefined();
    expect(albReceivedAtMs('')).toBeUndefined();
    expect(albReceivedAtMs('Self=1-6a6a10cc-48b353c62edb77150d3f7e54')).toBeUndefined();
    expect(albReceivedAtMs('Root=1-zzzzzzzz-48b353c62edb77150d3f7e54')).toBeUndefined();
    // Right shape, wrong widths — 7 hex then 24, and 8 hex then 23.
    expect(albReceivedAtMs('Root=1-6a6a10c-48b353c62edb77150d3f7e54')).toBeUndefined();
    expect(albReceivedAtMs('Root=1-6a6a10cc-48b353c62edb77150d3f7e5')).toBeUndefined();
    expect(albReceivedAtMs('Root=1-00000000-48b353c62edb77150d3f7e54')).toBeUndefined();
  });
});

describe('registerRequestTiming', () => {
  it('stamps arrival on the onRequest hook, which is the earliest point available', () => {
    let hookName: string | undefined;
    let handler: ((req: unknown, reply: unknown, done: () => void) => void) | undefined;
    const fakeApp = {
      addHook(name: string, fn: typeof handler) {
        hookName = name;
        handler = fn;
      },
    };

    registerRequestTiming(fakeApp as never);
    // Anything later than onRequest would fold body-receipt time into the arrival
    // timestamp and collapse the two intervals apart.
    expect(hookName).toBe('onRequest');

    const req = {};
    const before = Date.now();
    let called = false;
    handler!(req, {}, () => {
      called = true;
    });

    // Must always continue the chain: a timing hook that can stall a request is a
    // worse bug than the latency it measures.
    expect(called).toBe(true);
    const at = arrivalAtMs(req as never);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('reports undefined arrival on a request the hook never saw', () => {
    expect(arrivalAtMs({} as never)).toBeUndefined();
  });
});
