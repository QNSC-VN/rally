import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '@platform';
import { SYSTEM_ROLE } from '@shared-kernel';
import { systemRoles, userRoleAssignments } from '../../../../../../db/schema/access';
import { workspaceMembers } from '../../../../../../db/schema/workspace';

/**
 * The users whose project authority IS the workspace-wide grant — the ONE home of that
 * predicate (AC-8, §2.1).
 *
 * "A Workspace Admin is not added as a Project user or Team member": their authority comes
 * from the workspace-scoped `workspace_admin` assignment, which the catalogue gives every
 * project-tier code explicitly, so a `work.project_members` row adds them nothing and only
 * misrepresents the model. Nothing anti-joined them anywhere — the seed writes the row and
 * migration 0104 promoted it to `access_level = 'admin'` — so a WA appeared in every roster,
 * in `memberCount`, and as an addable candidate.
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
