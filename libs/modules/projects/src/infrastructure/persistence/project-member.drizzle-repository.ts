import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { projectMembers, teamMembers, projectTeams } from '../../../../../../db/schema/work';
import { users } from '../../../../../../db/schema/identity';
import type {
  ProjectMember,
  AddProjectMemberInput,
  UpdateProjectMemberInput,
} from '../../domain/project.types';
import { IProjectMemberRepository } from '../../domain/ports/project-member.repository';

@Injectable()
export class ProjectMemberDrizzleRepository implements IProjectMemberRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findMember(projectId: string, userId: string): Promise<ProjectMember | null> {
    const rows = await this.db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.status, 'active'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findMemberById(id: string): Promise<ProjectMember | null> {
    const rows = await this.db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByProject(projectId: string): Promise<ProjectMember[]> {
    // Explicit project members.
    const explicit = await this.db
      .select({
        id: projectMembers.id,
        workspaceId: projectMembers.workspaceId,
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        accessLevel: projectMembers.accessLevel,
        status: projectMembers.status,
        joinedAt: projectMembers.joinedAt,
        updatedAt: projectMembers.updatedAt,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(projectMembers)
      .leftJoin(users, eq(projectMembers.userId, users.id))
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.status, 'active')))
      .orderBy(projectMembers.joinedAt, asc(projectMembers.id));

    // Team-derived members: a user on a team LINKED to this project is a legitimate
    // Owner candidate on its work items even without an explicit project_members row
    // (TS-008 / P1-DC-012 — root cause of "added a team member, then they are not in
    // the Owner dropdown"). project_members and team_members stay separate tables
    // (this app deliberately does not collapse project and team the way Rally does);
    // this is read-only derivation for ownership eligibility, not a write-side sync,
    // so it can never drift the way a hook on addTeamMember would. Explicit members
    // win on conflict because they carry a real project role.
    const teamDerived = await this.db
      .select({
        id: teamMembers.id,
        workspaceId: teamMembers.workspaceId,
        projectId: projectTeams.projectId,
        userId: teamMembers.userId,
        status: teamMembers.status,
        joinedAt: teamMembers.joinedAt,
        updatedAt: teamMembers.createdAt,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(teamMembers)
      .innerJoin(
        projectTeams,
        and(
          eq(projectTeams.teamId, teamMembers.teamId),
          eq(projectTeams.projectId, projectId),
          eq(projectTeams.status, 'active'),
        ),
      )
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.status, 'active'));

    // Dedupe by userId: a user on >1 team linked to this project would otherwise
    // appear once per team. Explicit members win; among team-derived, first wins.
    const seenUserIds = new Set(explicit.map((m) => m.userId));
    const teamOnly = teamDerived
      .filter((m) => {
        if (seenUserIds.has(m.userId)) return false;
        seenUserIds.add(m.userId);
        return true;
      })
      .map((m) => ({
        ...m,
        accessLevel: null as string | null,
      })) as unknown as ProjectMember[];

    // Per-user team count, scoped to Teams LINKED to THIS project — the same
    // scoping `AccessService.assertTeamScoped` uses to gate Editor writes
    // (project_teams.projectId = this project, active on both sides). One
    // grouped query regardless of member count (O(1) round trips, not one per
    // member), merged into both member sets below by userId. This is what lets
    // the roster flag an Editor who holds the access level but has zero teams
    // to act in — a legal-but-useless grant, same shape as an unattached IAM
    // policy — without a per-row query.
    const teamCountRows = await this.db
      .select({
        userId: teamMembers.userId,
        teamCount: sql<number>`COUNT(DISTINCT ${teamMembers.teamId})::int`,
      })
      .from(teamMembers)
      .innerJoin(
        projectTeams,
        and(
          eq(projectTeams.teamId, teamMembers.teamId),
          eq(projectTeams.projectId, projectId),
          eq(projectTeams.status, 'active'),
        ),
      )
      .where(eq(teamMembers.status, 'active'))
      .groupBy(teamMembers.userId);
    const teamCountByUserId = new Map(teamCountRows.map((r) => [r.userId, r.teamCount]));

    const withTeamCount = (m: ProjectMember): ProjectMember => ({
      ...m,
      teamCount: teamCountByUserId.get(m.userId) ?? 0,
    });
    return [...explicit.map(withTeamCount), ...teamOnly.map(withTeamCount)];
  }

  async addMember(input: AddProjectMemberInput, tx?: DbExecutor): Promise<ProjectMember> {
    // `uq_project_member` is on (project_id, user_id) with no status qualifier, so
    // re-adding a user previously removed from this project collides with their
    // own `removed` row on a plain INSERT (raw unique-violation, surfaces as an
    // unhandled 500 — `findMember`'s pre-check only looks at active rows, so it
    // never sees this coming). Reactivate the row instead. `accessLevel` resets to
    // NULL on reactivation, same as a brand-new add: the caller always follows
    // with a PATCH to set the level (see this repo's addMember docblock upstream),
    // so a stale level from before removal is never silently resurrected.
    const rows = await (tx ?? this.db)
      .insert(projectMembers)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        userId: input.userId,
        status: 'active',
        joinedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { status: 'active', accessLevel: null, joinedAt: new Date(), updatedAt: new Date() },
      })
      .returning();
    return rows[0];
  }

  async updateMember(
    id: string,
    input: UpdateProjectMemberInput,
    tx?: DbExecutor,
  ): Promise<ProjectMember> {
    const rows = await (tx ?? this.db)
      .update(projectMembers)
      .set({
        ...(input.accessLevel !== undefined && { accessLevel: input.accessLevel }),
        ...(input.status !== undefined && { status: input.status }),
        updatedAt: new Date(),
      })
      .where(eq(projectMembers.id, id))
      .returning();
    return rows[0];
  }

  async removeMember(projectId: string, userId: string, tx?: DbExecutor): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(projectMembers)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    // No Access means NO access — the FE confirm dialog promises "their Team memberships
    // will be removed" on this exact action. Without this delete the rows survive, so
    // re-adding the user later silently restores their old team scope (and an Editor's
    // team-derived write boundary) with no re-assignment step and no trace.
    await db.delete(teamMembers).where(
      and(
        eq(teamMembers.userId, userId),
        inArray(
          teamMembers.teamId,
          this.db
            .select({ teamId: projectTeams.teamId })
            .from(projectTeams)
            .where(and(eq(projectTeams.projectId, projectId), eq(projectTeams.status, 'active'))),
        ),
      ),
    );
  }
}
