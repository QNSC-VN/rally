/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAIL_OPEN_FIELD, failOpenLog } from './fail-open';

/**
 * The CloudWatch metric filter in each environment's `infra/live` main.tf matches
 * this log field by name, so the coupling is real but invisible from either side.
 * These tests make a rename fail here instead of silently disarming the alarm.
 */
describe('failOpenLog', () => {
  it('tags the control that degraded', () => {
    expect(failOpenLog('denylist')).toEqual({ securityFailOpen: 'denylist' });
    expect(failOpenLog('rate_limit')).toEqual({ securityFailOpen: 'rate_limit' });
  });

  it('preserves the caller context', () => {
    const err = new Error('ECONNRESET');
    expect(failOpenLog('rate_limit', { err, ip: '1.1.1.1' })).toEqual({
      err,
      ip: '1.1.1.1',
      securityFailOpen: 'rate_limit',
    });
  });

  it('uses the field name both infra environments filter on', () => {
    // Guards the rename: the alarm is worthless if the field drifts.
    expect(FAIL_OPEN_FIELD).toBe('securityFailOpen');

    const root = join(__dirname, '../../../..');
    for (const env of ['develop', 'prod']) {
      const tf = readFileSync(join(root, 'infra/live', env, 'main.tf'), 'utf8');
      expect(tf, `${env} is missing a metric filter for ${FAIL_OPEN_FIELD}`).toContain(
        `$.${FAIL_OPEN_FIELD}`,
      );
    }
  });
});
