import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '@platform';
import { SYSTEM_ROLE } from '@shared-kernel';
import { systemRoles, userRoleAssignments } from '../../../../../../db/schema/access';
import { users } from '../../../../../../db/schema/identity';
import { workspaceMembers } from '../../../../../../db/schema/workspace';

/**
 * The users whose project authority IS the workspace-wide grant — the ONE home of that
 * predicate (AC-8, §2.1).
 *
 * "A Workspace Admin is not added as a Project user": their authority comes
 * from the workspace-scoped `workspace_admin` assignment, which the catalogue gives every
 * project-tier code explicitly, so a `work.project_members` row adds them nothing and only
 * misrepresents the model. Nothing anti-joined them anywhere — the seed writes the row and
 * migration 0104 promoted it to `access_level = 'admin'` — so a WA appeared in every roster,
 * in `memberCount`, and as an addable candidate.
 *
 * THE "OR TEAM MEMBER" HALF OF THAT SENTENCE IS GONE (BA feature, 2026-08-20). A Workspace Admin is
 * now an eligible TEAM member — operational scope, and explicitly no project grant — so this predicate
 * is about `work.project_members` and nothing else. A `team_members` row for a Workspace Admin is
 * legitimate: the roster BADGES them (`TeamService.listTeamMembersForReader`) rather than filtering
 * them, and `grantTeamRosterProjectAccess` still skips the RBE-06 grant for them, which is what keeps
 * the two halves apart.
 *
 * It lives in its own file because THREE readers need it and they must not disagree: the
 * roster (`ProjectMemberDrizzleRepository.listByProject`), the roster's SIZE
 * (`ProjectDrizzleRepository.listByWorkspaceWithStats`, which is rendered beside it), and
 * `AccessService.grantProjectAccess`, which refuses to create the row in the first place. A
 * roster that hides a WA while the count beside it still counts them is the two-call-sites
 * bug this repo keeps re-learning, so there is one expression of the rule and three callers.
 *
 * It lives in the ACCESS module — and is exported from `@modules/access` for the two projects
 * repositories above — because "who holds authority by workspace grant alone" is an
 * authorization fact, and because `AccessModule` imports nothing. The grant writer had to move
 * here to be reachable from `WorkspaceModule` (invitations, teams) without a module cycle, and
 * this predicate had to come with it or there would be two copies of the rule again.
 *
 * Mirrors `IWorkspaceMemberRepository.isActiveAdmin` exactly — workspace-scoped assignment of
 * the `workspace_admin` slug PLUS an active workspace membership — in set form, because that
 * port has no plural and a per-row existence check would be one query per roster row. The
 * active-membership half matters: a suspended member is not a Workspace Admin, so if they
 * somehow hold a project row it must stay VISIBLE rather than be filtered as an admin's.
 */
export async function selectWorkspaceAdminUserIds(
  db: DbExecutor,
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ userId: userRoleAssignments.userId })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(systemRoles.id, userRoleAssignments.roleId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, userRoleAssignments.workspaceId),
        eq(workspaceMembers.userId, userRoleAssignments.userId),
        eq(workspaceMembers.status, 'active'),
      ),
    )
    .where(
      and(
        eq(userRoleAssignments.workspaceId, workspaceId),
        eq(userRoleAssignments.scopeType, 'workspace'),
        eq(systemRoles.slug, SYSTEM_ROLE.WORKSPACE_ADMIN),
      ),
    );
  // A user can hold the role through more than one assignment row; the callers want a set.
  return [...new Set(rows.map((r) => r.userId))];
}

/** One Workspace Admin, with the profile fields a roster row needs to render. */
export interface WorkspaceAdminProfile {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

/**
 * The same predicate as {@link selectWorkspaceAdminUserIds}, with the profile a ROW needs.
 *
 * Added for the Project `Users & Permissions` list, which now shows every active Workspace Admin as a
 * system-generated read-only row (BA report 2026-08-21). That REVERSES one sentence of the SRS —
 * §5.2:138 "Workspace Admin is excluded from rows and candidates" — and keeps the rest of it: the row
 * is not a `work.project_members` record, it is not counted in `memberCount`, and `Add Existing User`
 * still offers normal users only. So the display changed and the membership rule did not.
 *
 * A projection of the same query rather than a second predicate, because the two must never disagree
 * about who a Workspace Admin IS. Kept as a separate exported function rather than widening the id
 * version: the id set has three callers that want a `Set<string>` for filtering, and handing them rows
 * they must map would be slower on every roster read for no reader's benefit.
 */
export async function selectWorkspaceAdminProfiles(
  db: DbExecutor,
  workspaceId: string,
): Promise<WorkspaceAdminProfile[]> {
  const rows = await db
    .select({
      userId: userRoleAssignments.userId,
      displayName: users.displayName,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(userRoleAssignments)
    .innerJoin(systemRoles, eq(systemRoles.id, userRoleAssignments.roleId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, userRoleAssignments.workspaceId),
        eq(workspaceMembers.userId, userRoleAssignments.userId),
        eq(workspaceMembers.status, 'active'),
      ),
    )
    .innerJoin(users, eq(users.id, userRoleAssignments.userId))
    .where(
      and(
        eq(userRoleAssignments.workspaceId, workspaceId),
        eq(userRoleAssignments.scopeType, 'workspace'),
        eq(systemRoles.slug, SYSTEM_ROLE.WORKSPACE_ADMIN),
      ),
    );
  // One user can hold the role through several assignment rows; a roster shows them once.
  const byUser = new Map<string, WorkspaceAdminProfile>();
  for (const r of rows) if (!byUser.has(r.userId)) byUser.set(r.userId, r);
  return [...byUser.values()];
}
