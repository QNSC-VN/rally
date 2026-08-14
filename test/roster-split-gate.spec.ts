/**
 * The workspace roster is TWO routes by AUDIENCE, and only the administrative one carries a
 * permission code (RBE-07).
 *
 * THE DEFECT
 * `GET /v1/workspaces/:id/members-with-profile` carried no authorization at all — it was the single
 * `@AuthzGap` in the codebase — and `PolicyGuard` ALLOWS a handler with no policy metadata. So the
 * company user directory, with every member's `phone`, `lastLoginAt` and role ids, was readable by a
 * per-project Editor and by a No Access principal alike (no active `project_members` row anywhere).
 *
 * WHY IT COULD NOT SIMPLY BE GATED
 * The same route fed the Portfolio and Projects OWNER PICKERS, so an admin-only code would have 403'd
 * ordinary delivery screens — which is why CLAUDE.md recorded it as deferred behind "split the feed
 * first". The split is by audience:
 *   • `:id/member-options`       the assignee / owner picker feed — id, name, email, avatar. No code:
 *                               scoped in `WorkspaceService` by `listReadableProjectIds`, because an
 *                               Editor holds no workspace-tier code and there is no project in the
 *                               path to hang a project-tier one on.
 *   • `:id/members-with-profile` the User Management roster — `workspace:view`, Workspace Admin only.
 *
 * WHY THIS FILE, GIVEN test/route-policy.ratchet.spec.ts EXISTS
 * The ratchet reads SOURCE TEXT and counts undecorated handlers; its own docblock calls it "a smoke
 * detector, not an authorization test", so it cannot tell `workspace:view` from a plausible-looking
 * code an Editor happens to hold. This reads the DECORATOR METADATA the guard itself reads
 * (`POLICY_KEY`) and applies the guard's own decision function (`permissionGrants`) to the
 * catalogue's own per-Project permission sets. Same shape as `iteration-timebox-gate.spec.ts` and
 * `capacity-access-gate.spec.ts`, and it runs in the unit suite with no database.
 *
 * WHAT IT CANNOT SEE, and where that is covered
 * It does not exercise `PolicyGuard`, and it cannot see the picker feed's scope at all — that is a
 * run-time decision inside the service. `libs/modules/workspace/src/application/workspace.service.spec.ts`
 * asserts the three sentinel cases, and `test/e2e/directory-team-authz.e2e.spec.ts` drives both
 * routes over real HTTP in both directions.
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { POLICY_KEY } from '@modules/access';
import { ACCESS_LEVEL_PERMISSIONS, ROLE_PERMISSIONS, permissionGrants } from '@shared-kernel';
import { WorkspaceController } from '../libs/modules/workspace/src/interface/http/workspace.controller';

/** The `@RequirePermission` a handler declares, read exactly as `PolicyGuard` reads it. */
function policy(handler: keyof WorkspaceController): { permission?: string } | undefined {
  return Reflect.getMetadata(POLICY_KEY, WorkspaceController.prototype[handler]) as
    { permission?: string } | undefined;
}

const WORKSPACE_ADMIN = [...ROLE_PERMISSIONS.workspace_admin];

describe('the workspace roster is split, and only the administrative feed carries a code', () => {
  it('gates the User Management roster on workspace:view', () => {
    // The code that already gates `GET :id/settings` on this same controller: workspace-tier,
    // Workspace-Admin-only, and about workspace administration data — which a staff directory
    // carrying contact details and last-login times is. Deliberately not a NEW code: a new one
    // would need a backfill migration to reach an already-seeded workspace at all.
    expect(policy('listMembersWithProfile')?.permission).toBe('workspace:view');
  });

  it('REFUSES the User Management roster to an Editor and to a per-project Admin', () => {
    const required = policy('listMembersWithProfile')!.permission!;
    expect(permissionGrants([...ACCESS_LEVEL_PERMISSIONS.editor], required)).toBe(false);
    // Admin too: §3.1 makes assigning access and viewing the company roster Workspace Admin's, and
    // `phone` / `lastLoginAt` are not delivery data.
    expect(permissionGrants([...ACCESS_LEVEL_PERMISSIONS.admin], required)).toBe(false);
  });

  it('ALLOWS the User Management roster to a Workspace Admin', () => {
    // Without this the "fix" could be a code nobody holds, which breaks Settings > Members instead
    // of protecting it.
    const required = policy('listMembersWithProfile')!.permission!;
    expect(permissionGrants(WORKSPACE_ADMIN, required)).toBe(true);
  });

  it('leaves the picker feed with NO permission code, deliberately', () => {
    /**
     * This is the assertion that stops the next person "finishing the job" by decorating it. Any
     * workspace-tier code refuses an Editor, who must be able to resolve a person to a name on every
     * grid; and a project-tier code is a compile error here, because the tier-safe overloads require
     * a scope and this route has no project id. The scope is `listReadableProjectIds` in the service
     * — `null` UNRESTRICTED, `[]` nobody — which is what `@AuthorizedInService` declares.
     */
    expect(policy('listMemberOptions')).toBeUndefined();
  });

  it('is not satisfied by a code an Editor could hold', () => {
    // A guard against the documented trap of choosing a gate for where the id lives rather than for
    // what the action is: if a future edit swapped `workspace:view` for, say, `project:view`, the
    // first test would still name "a code" and this one would fail.
    const required = policy('listMembersWithProfile')!.permission!;
    expect(required.startsWith('workspace:')).toBe(true);
  });
});
