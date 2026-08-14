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
