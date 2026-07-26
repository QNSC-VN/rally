/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAIL_OPEN_FIELD, failOpenLog } from '@qnsc-vn/observability';

/**
 * The log helper itself now lives in `@qnsc-vn/observability`; what stays here is the
 * part only this repo can assert — that the field name the package emits is the one
 * this repo's Terraform actually filters on. The coupling is invisible from both
 * sides, so a package rename or an infra edit must fail a test rather than silently
 * disarm the alarm.
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
