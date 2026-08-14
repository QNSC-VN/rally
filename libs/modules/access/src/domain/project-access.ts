import { PreconditionFailedException } from '@platform';
import { PROJECT_ACCESS_LEVEL, type ProjectAccessLevel } from '@shared-kernel';
import type { ProjectMemberStatus } from '../../../../../db/schema/enums';

/**
 * A per-Project access grant — one `work.project_members` row.
 *
 * Declared here rather than imported from `@modules/projects` because this module is the one
 * every other module may depend on: `AccessModule` imports NOTHING, which is what makes
 * `AccessService` reachable from `WorkspaceModule` (teams, invitations) and `ProjectsModule`
 * alike. Structurally identical to `ProjectMember` there, minus that type's optional
 * joined-from-`users` display fields, so it is assignable to it and the projects module keeps
 * returning its own richer type unchanged.
 */
export interface ProjectAccessGrant {
  id: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  accessLevel: string | null;
  status: ProjectMemberStatus;
  joinedAt: Date;
  updatedAt: Date;
}

/**
 * Whether the level covers every Team in its Project by itself.
 *
 * SRS §2.2 ("Admin always receives `All Teams`; individual Team selection is not shown"), §5.1
 * and §5.2 all state it, and it is why an Admin needs no `team_members` row at all:
 * An Admin covers every team by definition, so All Teams is the
 * ABSENCE of a scope rather than a set of rows some surface has to write.
 *
 * The backend mirror of `grantsAllTeams` in `apps/web/src/shared/config/access-levels.ts`. The
 * catalogue itself (`db/permissions.catalog.ts`) cannot hold it: it ships in the migrator image
 * and knows permission codes, not the team model.
 */
export function grantsAllTeams(level: ProjectAccessLevel | null | undefined): boolean {
  return level === 'admin';
}

/**
 * The one level a TEAM roster row may imply, derived rather than written down.
 *
 * A `team_members` row means "this user acts inside this team". Implying a level that
 * {@link grantsAllTeams} would make one team's roster a grant of authority over EVERY team in
 * the project — the exact opposite of what a team assignment says — so the implied level is the
 * level that is team-scoped, and there is exactly one.
 *
 * Derived from the catalogue instead of spelled `'editor'` so that adding a third level is a
 * loud failure here (the assertion below, pinned by a spec) rather than a silent mis-grant at
 * every team write. A level was in fact added and removed again inside one week — migrations
 * 0113 then 0115 — and a literal would have carried the wrong answer through both.
 */
const teamScopedLevels = PROJECT_ACCESS_LEVEL.filter((level) => !grantsAllTeams(level));

// Unreachable while the catalogue holds exactly one team-scoped level. Deliberately a throw at
// import rather than a spec-only assertion: with three levels `teamScopedLevels[0]` would still
// return *a* plausible answer, and a mis-grant that looks right is the failure mode this whole
// file exists to prevent.
if (teamScopedLevels.length !== 1) {
  throw new Error(
    `PROJECT_ACCESS_LEVEL must hold exactly one team-scoped level; found ${teamScopedLevels.length}. ` +
      'A team roster row implies a level, and that level must not be All Teams — decide which one before shipping.',
  );
}

/** The level a team roster row implies when the user has none yet. */
export const TEAM_ROSTER_ACCESS_LEVEL: ProjectAccessLevel = teamScopedLevels[0];

/**
 * The level a team roster row should grant a user who may already hold one.
 *
 * Never a DEMOTION: an existing Admin stays Admin, because being put on a team says nothing
 * about the project authority they were separately given, and silently narrowing it would
 * revoke access as a side effect of a roster edit. Anyone else lands on
 * {@link TEAM_ROSTER_ACCESS_LEVEL}.
 *
 * The same rule the SPA already encodes in `project-teams-tab.tsx`
 * (`currentLevel === 'admin' ? 'admin' : 'editor'`), lifted here so the SPA is no longer the only
 * place that knows it — `POST /v1/teams` reaches the same write with no SPA in front of it.
 * Rally agrees from the other direction: its Team Member checkbox auto-promotes to Editor.
 */
export function teamRosterAccessLevel(
  current: ProjectAccessLevel | null | undefined,
): ProjectAccessLevel {
  return current && grantsAllTeams(current) ? current : TEAM_ROSTER_ACCESS_LEVEL;
}

/**
 * Whether the level's authority is measured against TEAMS, so holding it means holding at least one
 * (§2.2: "Editor must be assigned to at least one active Team").
 *
 * The backend mirror of `requiresTeamSelection` in `apps/web/src/shared/config/access-levels.ts`,
 * and the exact complement of {@link grantsAllTeams} for the two levels the catalogue has today —
 * named separately for the reason §2.2 states the two halves separately, and because a THIRD level
 * would not answer the same to both. It is compared against {@link TEAM_ROSTER_ACCESS_LEVEL} rather
 * than `!grantsAllTeams(level)` for exactly that reason: a read-only level has no writes to scope,
 * so it would need no Team either, and `!grantsAllTeams` would silently start demanding one.
 */
export function requiresTeamAssignment(level: ProjectAccessLevel | null | undefined): boolean {
  return level === TEAM_ROSTER_ACCESS_LEVEL;
}

/**
 * PRJ-08 / §2.2 — THE ONE HOME OF "an Editor must have at least one Team".
 *
 * Stated three times on `product-docs` `origin/main`: the §2.2 level table ("One assigned Project and
 * one or more explicitly assigned Teams"), §2.2's own rule list ("Editor must be assigned to at least
 * one active Team"), and `00_Documents/mini_rally_usecase_role_mapping.md:81` ("`Editor` requires one
 * or more explicit Teams"). The SPA has blocked it since Phase 4.2; the API accepted it.
 *
 * It lives HERE, beside `grantsAllTeams` and `teamRosterAccessLevel`, because it is a fact about the
 * access model rather than about one route — and because it has to be reachable from the two callers
 * that write a level (`POST /projects/:id/members` and `PATCH /projects/:id/members/:memberId`)
 * without either of them owning a second copy of it.
 *
 * THE RULE IS ONLY ENFORCEABLE WHERE BOTH HALVES ARRIVE TOGETHER, which is why it is not in
 * `AccessService.grantProjectAccess`. The level and the Teams used to be two requests, so a refusal
 * at grant time would reject the FIRST of two calls the screen legitimately makes — and two
 * transactional callers still grant a level with no Teams beside it, on purpose: accepting an
 * invitation (§6.4, which carries a level and no team list at all, and would become permanently
 * unredeemable) and a team roster row implying a level (`teamRosterAccessLevel`, where the
 * `team_members` row is written in the same transaction, so the rule is satisfied by construction).
 * The COMBINED write is the enforcement point; see `ProjectsService.setProjectAccess`.
 *
 * TWO DELIBERATE EXEMPTIONS:
 *   • A level that {@link grantsAllTeams} needs no roster row at all — All Teams is the ABSENCE of a
 *     scope — so an Admin with zero Teams is correct, not invalid.
 *   • A project with NO Teams still accepts an Editor. Otherwise the level is unusable on a new
 *     project: there is nothing to assign, and refusing would mean a Workspace Admin has to invent a
 *     Team before they can give anyone delivery access. The SPA already made this exception on its
 *     own judgement (`AddExistingUserModal`'s `missingTeam`, and `isBlocked` in the user modal);
 *     this makes it explicit and server-side.
 */
export function assertTeamAssignmentForLevel(args: {
  /** The level the write is about to leave on the `project_members` row. */
  level: ProjectAccessLevel | null | undefined;
  /** The teams of THIS project the user will hold a roster row for once the write lands. */
  teamIds: readonly string[];
  /** Whether the project has any team to assign — see the second exemption. */
  projectHasTeams: boolean;
}): void {
  if (!requiresTeamAssignment(args.level)) return;
  if (!args.projectHasTeams) return;
  if (args.teamIds.length > 0) return;
  throw new PreconditionFailedException(
    'PROJECT_EDITOR_REQUIRES_TEAM',
    'An Editor must be assigned to at least one Team of this project',
  );
}
