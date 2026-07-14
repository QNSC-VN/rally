import { describe, it, expect } from 'vitest';
// Backend authoritative catalogue (db/permissions.catalog.ts).
import { PERMISSION as BACKEND_PERMISSION, permissionGrants } from './permissions';
// Frontend mirror + its single gating implementation. The SPA can't import
// server code into the browser bundle, so it maintains a hand-written view of
// the catalogue and its own copy of the wildcard rule. This contract test —
// which runs in the Node backend suite where both are importable — is what
// keeps the two from silently drifting.
import { PERMISSION as FRONTEND_PERMISSION } from '../../../apps/web/src/shared/config/permissions';
import { grants as frontendGrants } from '../../../apps/web/src/shared/config/permission-check';

describe('frontend permission catalogue contract', () => {
  const backendCodes = new Set<string>(Object.values(BACKEND_PERMISSION));

  it('every frontend permission code exists in the backend catalogue', () => {
    // The frontend intentionally mirrors only the subset of codes it gates on,
    // so this is a subset check (FE ⊆ BE), not equality. A typo or a code the
    // backend renamed/removed fails here.
    const unknown = Object.entries(FRONTEND_PERMISSION).filter(
      ([, code]) => !backendCodes.has(code),
    );
    expect(unknown, `frontend codes missing from backend: ${JSON.stringify(unknown)}`).toEqual([]);
  });
});

describe('frontend permission-check parity with backend permissionGrants', () => {
  // Every backend code plus synthetic edge cases (namespace wildcard, unknown
  // namespace, and a colon-less code) — the universe the rule is evaluated over.
  const codes = [
    ...Object.values(BACKEND_PERMISSION),
    'work_item:view',
    'unknown:action',
    'colonless',
  ];

  // Representative permission sets: empty, super-wildcard, namespace wildcard,
  // exact grants, mixed, and an irrelevant grant.
  const permissionSets: string[][] = [
    [],
    ['workspace:*'],
    ['work_item:*'],
    ['project:view'],
    ['work_item:view', 'release:*'],
    ['unrelated:permission'],
  ];

  for (const permissions of permissionSets) {
    for (const code of codes) {
      it(`grants(${JSON.stringify(permissions)}, '${code}') matches backend`, () => {
        expect(frontendGrants(permissions, code)).toBe(permissionGrants(permissions, code));
      });
    }
  }
});
