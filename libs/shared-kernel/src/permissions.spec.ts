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

  it('is exactly admin and editor — no viewer', () => {
    /**
     * The BA's three-level model: Workspace Admin plus per-Project `admin` or `editor`, with No
     * Access implicit when no row exists. A `viewer` level was added by ruling and removed again on
     * the BA's instruction (migrations 0113 then 0115), so this asserts the DECISION rather than
     * merely the current contents — a re-add has to change this line and argue for it.
     *
     * Real Rally does have Viewer, and the reasons are in `permissions.catalog.ts`. That is a known
     * divergence, not a gap to close quietly.
     */
    expect([...PROJECT_ACCESS_LEVEL]).toEqual(['admin', 'editor']);
  });

  it('recognises exactly the catalogued levels', () => {
    for (const level of PROJECT_ACCESS_LEVEL) expect(isProjectAccessLevel(level)).toBe(true);
    // The values a `project_members` row can otherwise hold, and the shapes a bad cast produces.
    for (const other of [null, undefined, '', 'workspace_admin', 'project_admin', 'ADMIN', 3])
      expect(isProjectAccessLevel(other)).toBe(false);
  });

  it('hides the Timeboxes surface from an Editor without taking away the timebox READ', () => {
    /**
     * §3.2 marks `Timeboxes / Iterations` **Hidden** for an Editor and `Create, View, Edit,
     * Delete` for Admin, while the row directly above it grants the Editor `Iteration Status |
     * View and update in assigned Teams`. `iteration:view` gated BOTH surfaces, so an Editor read
     * the whole timebox inventory on a screen the BA hides (RBE-09 / P23-08 / P01-11).
     *
     * Both directions, because either one alone passes for the wrong reason. Asserting only the
     * refusal would also pass if `iteration:view` had simply been revoked from the Editor — which
     * would 403 Iteration Status, the Backlog's iteration filter, Team Status and Quality, all of
     * which read `GET /iterations`. Asserting only the grant would pass on today's pre-split
     * catalogue.
     */
    expect(ACCESS_LEVEL_PERMISSIONS.editor).not.toContain(PERMISSION.TIMEBOX_VIEW);
    expect(ACCESS_LEVEL_PERMISSIONS.editor).toContain(PERMISSION.ITERATION_VIEW);
    expect(ACCESS_LEVEL_PERMISSIONS.admin).toContain(PERMISSION.TIMEBOX_VIEW);
    expect(ACCESS_LEVEL_PERMISSIONS.admin).toContain(PERMISSION.ITERATION_VIEW);

    /**
     * A NAMESPACE OF ITS OWN, and these three lines are why that matters.
     *
     * `iteration:*` — which a custom role can carry — must NOT reach the administration surface,
     * because §3.2 hides it independently of iteration CRUD. Its own namespace wildcard does. And
     * the retired string `iteration:manage` (deleted from every role by migration 0048, when the
     * coarse create+edit+delete bundle was split) must not grant it either: recycling that code
     * would let a pre-0048 role or backup silently open a screen nobody granted.
     */
    expect(permissionGrants(['iteration:*'], PERMISSION.TIMEBOX_VIEW)).toBe(false);
    expect(permissionGrants(['timebox:*'], PERMISSION.TIMEBOX_VIEW)).toBe(true);
    expect(permissionGrants(['iteration:manage'], PERMISSION.TIMEBOX_VIEW)).toBe(false);
    // …and the Editor's own code does not, which is the whole split.
    expect(permissionGrants([PERMISSION.ITERATION_VIEW], PERMISSION.TIMEBOX_VIEW)).toBe(false);
  });

  it('hides Team Status from an Editor without taking away the Editor surfaces next to it', () => {
    /**
     * §3.2:81 is `| Team Status | View/Update | View/Update | Hidden |`, and
     * `Phase 3/01_Team_Status/SRS.md:43` states it in words — "Project `Editor` does not enter Team
     * Status" — with `P3-TS-FR-028` ("Editor and unassigned users cannot open the page or mutate
     * Capacity, Task Name or Task State") and `P3-TS-FR-039` ("direct access and mutation are
     * rejected safely"). `00_Documents/mini_rally_usecase_role_mapping.md:50` agrees:
     * `| Team Status - View/Edit | All | Project | No | No |`.
     *
     * This REVERSES an earlier grant, so the assertion is on the decision. `GET /team-status`
     * returns every member's Capacity hours and each task's Estimate / To Do / Actual, so an Editor
     * holding `team_status:view` read the whole team's per-person hours. Backfilled to existing
     * workspaces by migration `0126_revoke_editor_team_status`, because `db/seeds/bootstrap.ts`
     * upserts the tier roles with `set: { name }` and a catalogue edit alone reaches no existing
     * workspace.
     *
     * BOTH DIRECTIONS, for the same reason the Timeboxes test above needs them: asserting only the
     * refusal would also pass if the Editor had lost `work_item:view` or `iteration:view`
     * wholesale, which would 403 Backlog, Iteration Status and Quality — the three §3.2 surfaces
     * the Editor KEEPS, all of which sit beside this one and share its data. The failure this pins
     * is a revocation that takes the neighbours with it.
     */
    expect(ACCESS_LEVEL_PERMISSIONS.editor).not.toContain(PERMISSION.TEAM_STATUS_VIEW);
    expect(ACCESS_LEVEL_PERMISSIONS.editor).not.toContain(PERMISSION.TEAM_STATUS_EDIT);
    expect(ACCESS_LEVEL_PERMISSIONS.editor).toContain(PERMISSION.WORK_ITEM_VIEW);
    expect(ACCESS_LEVEL_PERMISSIONS.editor).toContain(PERMISSION.ITERATION_VIEW);
    expect(ACCESS_LEVEL_PERMISSIONS.editor).toContain(PERMISSION.QUALITY_VIEW);
    // §3.2:81 gives a per-Project Admin `View/Update`, so the surface is not hidden from everyone —
    // which is what makes this a scoping rule rather than a dead permission.
    expect(ACCESS_LEVEL_PERMISSIONS.admin).toContain(PERMISSION.TEAM_STATUS_VIEW);
    expect(ACCESS_LEVEL_PERMISSIONS.admin).toContain(PERMISSION.TEAM_STATUS_EDIT);

    /**
     * The wildcard route in, which is the half a `not.toContain` cannot see: the Editor's own codes
     * must not GRANT `team_status:view` through a namespace wildcard either. `permissionGrants` is
     * what `PolicyGuard` actually calls, so this is the check the route performs.
     */
    expect(
      permissionGrants([...ACCESS_LEVEL_PERMISSIONS.editor], PERMISSION.TEAM_STATUS_VIEW),
    ).toBe(false);
    expect(
      permissionGrants([...ACCESS_LEVEL_PERMISSIONS.editor], PERMISSION.TEAM_STATUS_EDIT),
    ).toBe(false);
    // …and `work_item:*` — the namespace the Editor's job lives in, and the code the nav entry used
    // to be gated on — does not reach the team-status namespace.
    expect(permissionGrants(['work_item:*'], PERMISSION.TEAM_STATUS_VIEW)).toBe(false);
    expect(permissionGrants(['team_status:*'], PERMISSION.TEAM_STATUS_VIEW)).toBe(true);
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
