import { describe, expect, it } from 'vitest';
import { permissionGrants } from './permissions';

describe('permissionGrants (shared wildcard-aware check)', () => {
  it('returns false for empty / missing permissions', () => {
    expect(permissionGrants(undefined, 'work_item:edit')).toBe(false);
    expect(permissionGrants([], 'work_item:edit')).toBe(false);
  });

  it('grants everything on the workspace:* wildcard', () => {
    expect(permissionGrants(['workspace:*'], 'work_item:edit')).toBe(true);
    expect(permissionGrants(['workspace:*'], 'project:delete')).toBe(true);
    expect(permissionGrants(['workspace:*'], 'release:manage')).toBe(true);
  });

  it('matches an exact permission code', () => {
    expect(permissionGrants(['work_item:edit', 'project:view'], 'work_item:edit')).toBe(true);
    expect(permissionGrants(['work_item:edit'], 'work_item:delete')).toBe(false);
  });

  it('honours the namespace ns:* wildcard (the branch the main guard was missing)', () => {
    expect(permissionGrants(['work_item:*'], 'work_item:edit')).toBe(true);
    expect(permissionGrants(['work_item:*'], 'work_item:delete')).toBe(true);
    // a different namespace is NOT granted by work_item:*
    expect(permissionGrants(['work_item:*'], 'project:edit')).toBe(false);
  });

  it('denies when nothing matches', () => {
    expect(permissionGrants(['work_item:view'], 'release:manage')).toBe(false);
  });
});
