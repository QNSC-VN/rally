import { describe, expect, it } from 'vitest';
import { permissionGrants } from './permissions';
import {
  ACCESS_LEVEL_PERMISSIONS,
  PERMISSION,
  PERMISSION_TIER,
  PROJECT_ACCESS_LEVEL,
  isProjectAccessLevel,
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
    expect(permissionGrants(['workspace:*'], 'release:edit')).toBe(true);
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
    expect(permissionGrants(['work_item:view'], 'release:edit')).toBe(false);
  });
});

describe('PERMISSION_TIER (workspace vs project scope)', () => {
  const WORKSPACE_TIER: readonly Permission[] = [
    PERMISSION.WORKSPACE_ALL,
    PERMISSION.WORKSPACE_VIEW,
    PERMISSION.WORKSPACE_CREATE,
    PERMISSION.WORKSPACE_EDIT,
    PERMISSION.WORKSPACE_DELETE,
    PERMISSION.USERS_INVITE,
    PERMISSION.USERS_REMOVE,
    PERMISSION.USERS_ASSIGN_ROLE,
    PERMISSION.ROLES_VIEW,
    PERMISSION.ROLES_EDIT,
    PERMISSION.TEAMS_CREATE,
    PERMISSION.TEAMS_EDIT,
    PERMISSION.TEAMS_MANAGE_MEMBERS,
    PERMISSION.AUDIT_VIEW,
    PERMISSION.SCM_MANAGE,
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
    expect(isProjectTierPermission(PERMISSION.USERS_ASSIGN_ROLE)).toBe(false);
  });
});

describe('per-Project access levels', () => {
  it('has a permission set for every level, and no level without one', () => {
    // Guards the shape both ways: a level added to the constant without a set would resolve
    // `undefined` and spread into an empty permission array, i.e. silently No Access.
    expect(Object.keys(ACCESS_LEVEL_PERMISSIONS).sort()).toEqual([...PROJECT_ACCESS_LEVEL].sort());
  });

  it('recognises exactly the catalogued levels', () => {
    for (const level of PROJECT_ACCESS_LEVEL) expect(isProjectAccessLevel(level)).toBe(true);
    // The values a `project_members` row can otherwise hold, and the shapes a bad cast produces.
    for (const other of [null, undefined, '', 'workspace_admin', 'project_admin', 'ADMIN', 3])
      expect(isProjectAccessLevel(other)).toBe(false);
  });

  it('gives Viewer read-only codes, and nothing else', () => {
    /**
     * `viewer` is written out rather than derived, so this is the test that keeps it honest: a
     * write code reaching the read-only level is the one defect the level exists to prevent, and it
     * would arrive by someone appending to the list rather than by a type error.
     */
    for (const code of ACCESS_LEVEL_PERMISSIONS.viewer) {
      expect(code.endsWith(':view'), `${code} is not a view code`).toBe(true);
    }
  });

  it('keeps Viewer strictly below Editor', () => {
    // A read-only level that could see something an Editor cannot would be an escalation dressed as
    // a restriction. Every viewer code must therefore also be an editor code.
    const editor = new Set<string>(ACCESS_LEVEL_PERMISSIONS.editor);
    for (const code of ACCESS_LEVEL_PERMISSIONS.viewer) {
      expect(editor.has(code), `viewer holds ${code} but editor does not`).toBe(true);
    }
  });

  it('withholds the Admin-only surfaces from Viewer', () => {
    // §3.2 makes Reports, Portfolio Items and Capacity Planning Admin/WA surfaces — an Editor cannot
    // see them, so a Viewer must not either. Named explicitly because a future `:view` code would
    // satisfy the read-only test above while breaking this one.
    for (const code of [
      PERMISSION.REPORT_VIEW,
      PERMISSION.PORTFOLIO_VIEW,
      PERMISSION.CAPACITY_VIEW,
    ]) {
      expect(ACCESS_LEVEL_PERMISSIONS.viewer).not.toContain(code);
    }
  });

  it('gives Admin no permission an Editor lacks unless it is deliberate', () => {
    // Admin ⊇ Editor. The tiers derive from ROLE_PERMISSIONS, so this catches a hand-edit that
    // removes a code from Admin while leaving it with Editor — which would make "promote to Admin"
    // a partial DEMOTION, the least expected outcome of an access change.
    const admin = new Set<string>(ACCESS_LEVEL_PERMISSIONS.admin);
    for (const code of ACCESS_LEVEL_PERMISSIONS.editor) {
      expect(admin.has(code), `editor holds ${code} but admin does not`).toBe(true);
    }
  });
});
