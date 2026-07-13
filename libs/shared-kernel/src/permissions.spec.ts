import { describe, expect, it } from 'vitest';
import { permissionGrants } from './permissions';
import {
  PERMISSION,
  PERMISSION_TIER,
  isProjectTierPermission,
  type Permission,
} from '../../../db/permissions.catalog';

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

describe('PERMISSION_TIER (workspace vs project scope)', () => {
  const WORKSPACE_TIER: readonly Permission[] = [
    PERMISSION.WORKSPACE_ALL,
    PERMISSION.WORKSPACE_VIEW,
    PERMISSION.WORKSPACE_CREATE,
    PERMISSION.WORKSPACE_MANAGE_MEMBERS,
    PERMISSION.WORKSPACE_MANAGE_TEAMS,
    PERMISSION.PROJECT_CREATE,
  ];

  it('classifies every catalogued permission', () => {
    for (const code of Object.values(PERMISSION)) {
      expect(PERMISSION_TIER[code], `missing tier for ${code}`).toBeDefined();
    }
  });

  it('marks exactly the workspace-tier permissions as workspace', () => {
    for (const code of Object.values(PERMISSION)) {
      const expected = WORKSPACE_TIER.includes(code) ? 'workspace' : 'project';
      expect(PERMISSION_TIER[code], code).toBe(expected);
    }
  });

  it('everything acting on an existing project is project-tier', () => {
    // work items, iterations, releases, milestones, quality, team-status and
    // project edit/archive/restore/delete/manage_members are all per-project.
    expect(isProjectTierPermission(PERMISSION.WORK_ITEM_CREATE)).toBe(true);
    expect(isProjectTierPermission(PERMISSION.ITERATION_VIEW)).toBe(true);
    expect(isProjectTierPermission(PERMISSION.PROJECT_DELETE)).toBe(true);
    expect(isProjectTierPermission(PERMISSION.PROJECT_EDIT)).toBe(true);
    // minting a project (no instance yet) and workspace admin are NOT.
    expect(isProjectTierPermission(PERMISSION.PROJECT_CREATE)).toBe(false);
    expect(isProjectTierPermission(PERMISSION.WORKSPACE_MANAGE_MEMBERS)).toBe(false);
  });
});
