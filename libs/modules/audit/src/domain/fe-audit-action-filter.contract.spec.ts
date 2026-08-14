import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION } from '@platform';
// The SPA's Action-filter vocabulary. It cannot import server code into the browser bundle, so it
// mirrors the catalogue; this test runs in the backend suite, where both are importable, and is
// what stops the two drifting.
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ACTION_OPTIONS,
} from '../../../../../apps/web/src/features/audit/model/action-filter-options';

/**
 * The Audit Log's Action filter must offer every action the log can hold.
 *
 * P45-04: the free-text box on that screen searches the loaded page, because the Detail sentence is
 * assembled in the browser and no column holds it. `action` IS a column, so filtering on it is the
 * part of "what happened" a query can answer across the whole log — but only if the picker's
 * vocabulary is complete. A code missing from the mirror is invisible in exactly the way this repo
 * has been bitten by before: nothing fails, no cell is empty, and one kind of administrative event
 * simply cannot be found. Same reason `fe-audit-describer-contract.spec.ts` exists for the sentences.
 *
 * Deliberately an EQUALITY check in both directions, unlike the describer contract:
 *  - a code in the catalogue and not in the picker cannot be filtered;
 *  - a code in the picker and not in the catalogue is an option that can only ever return an empty
 *    page, which is a control promising more than the query delivers.
 *
 * `auth.*` is listed literally, from `AuthService`'s own emits, for the same reason the describer
 * contract lists it: those codes belong to `@qnsc-vn/identity` and are in no `AUDIT_ACTION` entry,
 * yet they are the highest-volume rows in the log — a rename there must fail here rather than
 * quietly drop sign-ins out of the filter.
 */
const IDENTITY_AUTH_ACTIONS = [
  'auth.login.sso',
  'auth.login.dev',
  'auth.logout',
  'auth.switch_workspace',
  'auth.token_theft_detected',
];

describe('frontend audit action-filter contract', () => {
  const offered = AUDIT_ACTION_OPTIONS.map((o) => o.code);
  const recordable = [...Object.values(AUDIT_ACTION), ...IDENTITY_AUTH_ACTIONS];

  it('offers every action code the backend can record', () => {
    const missing = recordable.filter((code) => !offered.includes(code));
    expect(
      missing,
      `these actions are recorded but cannot be filtered for: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('offers no action code nothing records', () => {
    const unknown = offered.filter((code) => !recordable.includes(code));
    expect(
      unknown,
      `these filter options can only ever return an empty page: ${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('assigns every option to a known group, so none is unreachable in the picker', () => {
    const stray = AUDIT_ACTION_OPTIONS.filter(
      (o) => !(AUDIT_ACTION_GROUPS as readonly string[]).includes(o.group),
    ).map((o) => o.code);
    expect(stray).toEqual([]);
  });

  it('lists each code once', () => {
    expect(offered.length).toBe(new Set(offered).size);
  });
});
