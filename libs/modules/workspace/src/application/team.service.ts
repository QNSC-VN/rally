import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  UnitOfWork,
  AuditProducer,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
} from '@platform';
import type { DrizzleTx } from '@platform';
import { AccessService, teamRosterAccessLevel } from '@modules/access';
import { ITeamRepository, TEAM_REPOSITORY } from '../domain/ports/team.repository';
import {
  ITeamMemberRepository,
  TEAM_MEMBER_REPOSITORY,
} from '../domain/ports/team-member.repository';
import { IWorkspaceRepository, WORKSPACE_REPOSITORY } from '../domain/ports/workspace.repository';
import {
  IWorkspaceMemberRepository,
  WORKSPACE_MEMBER_REPOSITORY,
} from '../domain/ports/workspace-member.repository';
import type {
  Team,
  TeamMember,
  TeamStatus,
  TeamWithStats,
  UpdateTeamInput,
  TeamRelationsInput,
} from '../domain/team.types';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @Inject(TEAM_REPOSITORY) private readonly teamRepo: ITeamRepository,
    @Inject(TEAM_MEMBER_REPOSITORY) private readonly teamMemberRepo: ITeamMemberRepository,
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: IWorkspaceRepository,
    @Inject(WORKSPACE_MEMBER_REPOSITORY)
    private readonly workspaceMemberRepo: IWorkspaceMemberRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditProducer,
    private readonly access: AccessService,
  ) {}

  /**
   * EVERY team in the workspace, unscoped — an INTERNAL helper, not a reader's list.
   *
   * `ProjectsService` calls it to validate the team ids on a create/link write it has already
   * authorized. HTTP reads must use {@link listTeamsForReader}; see its docblock for why (RBE-08).
   */
  async listTeams(workspaceId: string, includeInactive = false): Promise<TeamWithStats[]> {
    return this.teamRepo.listByWorkspaceWithStats(workspaceId, includeInactive);
  }

  /**
   * The projects this actor may READ, or `null` for unrestricted.
   *
   * One helper so the list and the two detail reads below cannot answer the same question two ways —
   * the property whose absence produced the zero-point Velocity bars (CLAUDE.md, "Eligibility must
   * be counted in the SAME scope as the measurement").
   */
  private async readableProjectIds(workspaceId: string, actorId: string): Promise<string[] | null> {
    return this.access.listReadableProjectIds(workspaceId, actorId, 'project:view');
  }

  /**
   * Teams a reader may see: those linked to at least one project they can read (RBE-08 / PRJ-07).
   *
   * `GET /workspaces/:id/teams` carried no permission at all, and a route with no metadata is OPEN —
   * so every team's name, key, lead, member count AND the name and key of every project it is linked
   * to were readable by any authenticated caller, including one with No Access. §3.1 gives "View
   * Project Details and Teams" as a per-Project row, not a workspace-wide one.
   *
   * A team is reached THROUGH its project links, which is what makes this a cross-project list and
   * `listReadableProjectIds` the fact that scopes it. Both sentinels are load-bearing:
   *   • `null` → unrestricted (a Workspace Admin sees every team, including an unlinked one).
   *   • `[]`   → nothing, WITHOUT querying. Flattening it to "all" leaks the workspace; and never
   *              build a predicate from an empty set — `inArray(col, [])` is not portable as
   *              "match nothing".
   *
   * The per-team `projects` array is narrowed too, not just the team rows: a team linked to both a
   * readable and an unreadable project would otherwise disclose the second project's key and name,
   * which is the same leak in a nested field.
   */
  async listTeamsForReader(
    workspaceId: string,
    actorId: string,
    includeInactive = false,
  ): Promise<TeamWithStats[]> {
    const readable = await this.readableProjectIds(workspaceId, actorId);
    if (readable === null) return this.listTeams(workspaceId, includeInactive);
    if (readable.length === 0) return [];

    const allowed = new Set(readable);
    const all = await this.teamRepo.listByWorkspaceWithStats(workspaceId, includeInactive);
    return all
      .filter((t) => t.projects.some((p) => allowed.has(p.projectId)))
      .map((t) => ({ ...t, projects: t.projects.filter((p) => allowed.has(p.projectId)) }));
  }

  /**
   * Refuse a team whose every project link is unreadable by this actor.
   *
   * 404, not 403, and for the reason {@link getTeam} already gives: a team the reader has no path to
   * must not be distinguishable from one that does not exist. It also matches what
   * {@link listTeamsForReader} does — a surface that hides a row in the list and then admits its
   * existence on the detail route has not hidden it.
   *
   * Kept OFF {@link getTeam} deliberately. That method is the pre-read for `updateTeam`,
   * `addTeamMember` and `removeTeamMember`, which are Workspace-Admin-gated writes at the route —
   * putting a reader's scope check inside it would put a second, differently-derived authorization
   * decision on every write path.
   */
  private async assertTeamReadable(
    teamId: string,
    workspaceId: string,
    actorId: string,
  ): Promise<void> {
    const readable = await this.readableProjectIds(workspaceId, actorId);
    if (readable === null) return;
    const allowed = new Set(readable);
    const linked = await this.teamRepo.listActiveProjectIds(teamId);
    // An empty `readable` falls out here with no special case: nothing can be in an empty set.
    if (!linked.some((projectId) => allowed.has(projectId))) {
      throw new NotFoundException('TEAM_NOT_FOUND', 'Team not found');
    }
  }

  /**
   * Validate that every id in `projectIds` is a project in this workspace.
   * The "at least one project" create-form rule (SRS §2A / TEAM-FR-003) is
   * enforced at the HTTP DTO boundary; the domain still permits an unlinked
   * team (e.g. once every project is unlinked), so this only checks existence.
   */
  private async assertProjectsExist(workspaceId: string, projectIds: string[]): Promise<string[]> {
    const unique = [...new Set(projectIds)];
    if (unique.length === 0) return unique;
    const found = await this.teamRepo.countProjectsInWorkspace(workspaceId, unique);
    if (found !== unique.length) {
      throw new PreconditionFailedException(
        'PROJECT_NOT_FOUND',
        'One or more selected projects do not exist in this workspace',
      );
    }
    return unique;
  }

  /**
   * A team roster row implies per-Project access — RBE-06, P4-RBAC-010, and §5's closing sentence
   * (AC-9) that all three journeys update the same source.
   *
   * Before this, `work.team_members` was written here with NO project grant, and the SPA
   * COMPENSATED: `project-teams-tab.tsx` follows its `POST /v1/teams` with a `POST
   * /projects/{id}/members` per selected member. So the rule held for exactly one caller. Any other
   * caller of `POST /v1/teams` — a script, the API directly, a future surface — produced a team
   * member of a project they cannot open, which is the same shape of defect as a rule implemented
   * as one write's hook (see `derived-invariants.e2e.spec.ts`).
   *
   * THE LEVEL IS RESOLVED, NEVER LITERAL. {@link teamRosterAccessLevel} is the rule and it lives in
   * the access module beside the checks that consume it:
   *   * `admin` is the one level a roster row must never IMPLY. team membership was only ever scoped for
   *     `editor`, and `grantsAllTeams` means an Admin needs no `team_members` row at all — so
   *     implying Admin would turn one team's membership into authority over every team in the
   *     project, the opposite of what a team assignment says.
   *   * An existing Admin is never DEMOTED. Being added to a team says nothing about the project
   *     authority someone was separately given, and narrowing it as a side effect of a roster edit
   *     would revoke access with nothing on screen to say so. The SPA already encodes exactly this
   *     (`currentLevel === 'admin' ? 'admin' : 'editor'`); the backend reuses the rule rather than
   *     re-deriving it.
   *
   * Runs INSIDE the caller's transaction — which is why `grantProjectAccess` takes one: its
   * active-workspace-member check has to see the rows this transaction is writing, and
   * `UnitOfWork.run` is `db.transaction`, which does not nest. Returns the users to invalidate,
   * because a grant applied inside a transaction cannot know when that transaction committed.
   */
  private async grantTeamRosterProjectAccess(
    tx: DrizzleTx,
    workspaceId: string,
    projectIds: readonly string[],
    memberUserIds: readonly string[],
    actorId: string,
  ): Promise<string[]> {
    const granted = new Set<string>();
    for (const projectId of projectIds) {
      for (const userId of memberUserIds) {
        // The level the user holds BEFORE this roster edit. Read outside the transaction on
        // purpose: it is a fact about prior state, and this transaction has not granted anything to
        // this user on this project yet.
        const current = await this.access.getProjectAccessLevel(workspaceId, userId, projectId);
        const grant = await this.access.grantProjectAccess(
          {
            workspaceId,
            projectId,
            userId,
            accessLevel: teamRosterAccessLevel(current),
            actorId,
            // A Workspace Admin already has every project (§2.1 keeps them off project rosters), so
            // writing nothing is correct — and refusing would make a team uncreatable because one
            // selected member happens to be an admin of this workspace.
            onWorkspaceAdmin: 'skip',
          },
          tx,
        );
        if (grant) granted.add(userId);
      }
    }
    return [...granted];
  }

  /** Validate every member id is an active workspace member; returns the deduped set. */
  private async assertMembers(workspaceId: string, memberUserIds: string[]): Promise<string[]> {
    const unique = [...new Set(memberUserIds)];
    for (const userId of unique) {
      if (!(await this.workspaceMemberRepo.isMember(workspaceId, userId))) {
        throw new PreconditionFailedException(
          'TEAM_MEMBER_NOT_WORKSPACE_MEMBER',
          'One or more selected members are not active members of this workspace',
        );
      }
    }
    return unique;
  }

  async createTeam(
    workspaceId: string,
    input: {
      name: string;
      key: string;
      description?: string;
      leadId?: string;
      status?: TeamStatus;
      projectIds?: string[];
      memberUserIds?: string[];
    },
    actorId: string,
  ): Promise<Team> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND', 'Workspace not found');
    }

    const key = input.key.toUpperCase();
    const existing = await this.teamRepo.findByKey(workspaceId, key);
    if (existing) {
      throw new ConflictException(
        'TEAM_KEY_TAKEN',
        `Team key "${key}" is already taken in this workspace`,
      );
    }

    const projectIds = await this.assertProjectsExist(workspaceId, input.projectIds ?? []);
    const memberUserIds = await this.assertMembers(workspaceId, input.memberUserIds ?? []);

    const teamId = uuidv7();
    let toInvalidate: string[] = [];
    const team = await this.uow.run(async (tx) => {
      const created = await this.teamRepo.create(
        {
          id: teamId,
          workspaceId,
          name: input.name,
          key,
          description: input.description,
          leadId: input.leadId,
        },
        tx,
      );
      if (input.status && input.status !== 'active') {
        await this.teamRepo.update(teamId, { status: input.status }, tx);
      }
      await this.teamRepo.setProjectLinks(workspaceId, teamId, projectIds, tx);
      await this.teamMemberRepo.setMembers(workspaceId, teamId, memberUserIds, tx);
      // RBE-06 — a roster row implies project access. See `grantTeamRosterProjectAccess`.
      toInvalidate = await this.grantTeamRosterProjectAccess(
        tx,
        workspaceId,
        projectIds,
        memberUserIds,
        actorId,
      );
      await this.audit.emit(
        {
          action: AUDIT_ACTION.TEAM_CREATED,
          resourceType: AUDIT_RESOURCE.TEAM,
          resourceId: teamId,
          workspaceId,
          actor: { id: actorId },
          changes: { after: { name: input.name, key, leadId: input.leadId, projectIds } },
        },
        tx,
      );
      return created;
    });

    // After commit, matching `assignRole`: invalidating first lets a concurrent request repopulate
    // the cache from pre-commit state, which is the staleness the cache exists to remove.
    await this.access.invalidateUsers(workspaceId, toInvalidate);
    this.logger.log({ teamId: team.id, workspaceId }, 'Team created');
    return team;
  }

  async getTeam(id: string, workspaceId: string): Promise<Team> {
    // findById already filters by workspace_id — a wrong-workspace id returns null,
    // which we surface as 404 to avoid cross-workspace enumeration.
    const team = await this.teamRepo.findById(id, workspaceId);
    if (!team) {
      throw new NotFoundException('TEAM_NOT_FOUND', 'Team not found');
    }
    return team;
  }

  async updateTeam(
    id: string,
    input: UpdateTeamInput & TeamRelationsInput,
    workspaceId: string,
    actorId: string,
  ): Promise<Team> {
    const team = await this.getTeam(id, workspaceId);

    if (input.status === 'archived' && team.status === 'archived') {
      throw new ConflictException('TEAM_ALREADY_ARCHIVED', 'Team is already archived');
    }

    // Validate relations up-front (outside the tx) so a bad request fails fast.
    const projectIds =
      input.projectIds !== undefined
        ? await this.assertProjectsExist(workspaceId, input.projectIds)
        : undefined;
    const memberUserIds =
      input.memberUserIds !== undefined
        ? await this.assertMembers(workspaceId, input.memberUserIds)
        : undefined;

    // Mirror of the project-side unlink guard (PROJECT_TEAM_HAS_CAPACITY_PLAN):
    // dropping a project link while the team sits on that project's capacity plan
    // must be refused, not silently orphan committed planning demand.
    if (projectIds !== undefined) {
      const current = await this.teamRepo.listActiveProjectIds(id);
      const removed = current.filter((pid) => !projectIds.includes(pid));
      if (removed.length > 0) {
        const blocking = await this.teamRepo.findBlockingCapacityPlans(workspaceId, id, removed);
        if (blocking.length > 0) {
          throw new ConflictException(
            'PROJECT_TEAM_HAS_CAPACITY_PLAN',
            `Team is allocated on capacity plan(s) ${blocking.map((b) => b.planKey).join(', ')} — remove the team from those plans before unlinking the project`,
          );
        }
      }
    }

    let toInvalidate: string[] = [];
    const updated = await this.uow.run(async (tx) => {
      const after = await this.teamRepo.update(
        id,
        {
          name: input.name,
          description: input.description,
          leadId: input.leadId,
          status: input.status,
        },
        tx,
      );
      if (projectIds !== undefined) {
        await this.teamRepo.setProjectLinks(workspaceId, id, projectIds, tx);
      }
      if (memberUserIds !== undefined) {
        await this.teamMemberRepo.setMembers(workspaceId, id, memberUserIds, tx);
      }
      /**
       * RBE-06 on the EDIT path too, and for the reason `derived-invariants.e2e.spec.ts` records:
       * a rule stated as a condition over membership cannot be implemented as a hook on one
       * particular write. A member added by editing a team, or an existing member reached by
       * linking a new project, is in exactly the state `createTeam` now refuses to leave anyone in.
       *
       * The roster is taken from the patch when it supplied one and from the stored rows otherwise,
       * so linking a project grants the team's CURRENT members — and likewise a new member gets the
       * team's current projects. Adding access only, never removing: `setMembers` and
       * `setProjectLinks` are replacements, but a project grant is not a team's to revoke (it may
       * have been given for other reasons entirely, on the Users & Permissions screen).
       */
      const rosterUserIds =
        memberUserIds ?? (await this.teamMemberRepo.listByTeam(id)).map((m) => m.userId);
      const linkedProjectIds = projectIds ?? (await this.teamRepo.listActiveProjectIds(id));
      toInvalidate = await this.grantTeamRosterProjectAccess(
        tx,
        workspaceId,
        linkedProjectIds,
        rosterUserIds,
        actorId,
      );
      await this.audit.emit(
        {
          action: AUDIT_ACTION.TEAM_UPDATED,
          resourceType: AUDIT_RESOURCE.TEAM,
          resourceId: id,
          workspaceId,
          actor: { id: actorId },
          changes: { before: team, after: { ...after, projectIds, memberUserIds } },
        },
        tx,
      );
      return after;
    });
    await this.access.invalidateUsers(workspaceId, toInvalidate);
    return updated;
  }

  async listTeamMembers(teamId: string, workspaceId: string): Promise<TeamMember[]> {
    await this.getTeam(teamId, workspaceId);
    return this.teamMemberRepo.listByTeam(teamId);
  }

  /** {@link getTeam}, narrowed to a team the actor can reach — see {@link assertTeamReadable}. */
  async getTeamForReader(id: string, workspaceId: string, actorId: string): Promise<Team> {
    const team = await this.getTeam(id, workspaceId);
    await this.assertTeamReadable(id, workspaceId, actorId);
    return team;
  }

  /**
   * {@link listTeamMembers}, narrowed the same way.
   *
   * This roster carries every member's display name AND EMAIL (the repository's `identity.users`
   * join), so an unscoped read of it is the directory leak of RBE-07 reached through a team id.
   */
  async listTeamMembersForReader(
    teamId: string,
    workspaceId: string,
    actorId: string,
  ): Promise<TeamMember[]> {
    await this.getTeam(teamId, workspaceId);
    await this.assertTeamReadable(teamId, workspaceId, actorId);
    return this.withWorkspaceAdminFlag(workspaceId, await this.teamMemberRepo.listByTeam(teamId));
  }

  /**
   * Label the rows that hold the workspace-wide grant (BA feature, 2026-08-20).
   *
   * A Workspace Admin may now be a Team member, and §2.1 still keeps them off `project_members` — so
   * their roster row has no access level to show and must read `Workspace Admin` rather than `Admin`
   * or `Editor`. The flag is resolved here, once per read, rather than joined into the repository
   * query: "who holds the workspace grant" is an AUTHORIZATION fact with one home in `AccessService`,
   * and a second expression of it in SQL is the drift this repo keeps re-learning.
   *
   * One extra query per roster read, and none at all for an empty roster.
   */
  private async withWorkspaceAdminFlag(
    workspaceId: string,
    members: TeamMember[],
  ): Promise<TeamMember[]> {
    if (members.length === 0) return members;
    const admins = new Set(await this.access.listWorkspaceAdminIds(workspaceId));
    return members.map((m) => ({ ...m, isWorkspaceAdmin: admins.has(m.userId) }));
  }

  /**
   * Delete an ARCHIVED team that carries no history — the only shape of team delete this product has.
   *
   * DB design §488 is "Archive Team does not delete the linked Work Item/Sprint history", and until now
   * that was implemented as "a team cannot be deleted at all". That left archiving as a one-way door:
   * an archived team disappeared from every feed (`GET /projects/:id/teams` narrows to active, by
   * design, so pickers cannot offer it) and nothing could ever remove a team created by mistake. The
   * product owner asked for delete; the answer is delete WHEN THERE IS NOTHING TO DESTROY, which keeps
   * §488 intact rather than trading it away.
   *
   * TWO REFUSALS, and they are different questions:
   *   • `TEAM_NOT_ARCHIVED` — delete is an operation on the archive. Archive first, so the destructive
   *     step is always preceded by a reversible one that already removed the team from every picker.
   *   • `TEAM_HAS_HISTORY` — the message NAMES the sources and their counts, because "you cannot delete
   *     this" without saying what holds it is a dead end, and the holder is usually something the admin
   *     can move (reassign the work items, delete the draft plan) rather than a mystery.
   *
   * The guard is not belt-and-braces over a database constraint: half the referencing columns have NO
   * foreign key and the other half CASCADE. Postgres would let this succeed and quietly take frozen
   * Burndown history with it. See `countHistoryReferences`.
   */
  async deleteTeam(teamId: string, workspaceId: string, actorId: string): Promise<void> {
    const team = await this.getTeam(teamId, workspaceId);

    if (team.status !== 'archived') {
      throw new PreconditionFailedException(
        'TEAM_NOT_ARCHIVED',
        'Archive this team before deleting it',
      );
    }

    const blocking = await this.teamRepo.countHistoryReferences(teamId, workspaceId);
    if (blocking.length > 0) {
      const named = blocking.map((b) => `${b.count} ${b.source}`).join(', ');
      throw new PreconditionFailedException(
        'TEAM_HAS_HISTORY',
        `This team still holds ${named}. Move or remove them before deleting it — deleting would ` +
          'discard recorded delivery and report history.',
      );
    }

    // The roster is read BEFORE the delete removes it: those users may hold project access that RBE-06
    // granted from their membership, so their cached permissions have to be dropped afterwards.
    const roster = await this.teamMemberRepo.listByTeam(teamId);
    await this.uow.run(async (tx) => {
      await this.teamRepo.deleteTeam(teamId, workspaceId, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.TEAM_DELETED,
          resourceType: AUDIT_RESOURCE.TEAM,
          resourceId: teamId,
          workspaceId,
          actor: { id: actorId },
          changes: { before: team },
        },
        tx,
      );
    });
    await this.access.invalidateUsers(
      workspaceId,
      roster.map((m) => m.userId),
    );
    this.logger.log({ teamId, actorId }, 'Team deleted');
  }

  async addTeamMember(
    teamId: string,
    userId: string,
    workspaceId: string,
    actorId: string,
  ): Promise<TeamMember> {
    // Pass workspaceId so a team from another workspace can't be targeted (was a gap).
    await this.getTeam(teamId, workspaceId);

    // A team member must be an active member of the owning workspace — same rule
    // enforced for project members and work-item assignees. Prevents adding a
    // user from another workspace/tenant to a team.
    if (!(await this.workspaceMemberRepo.isMember(workspaceId, userId))) {
      throw new PreconditionFailedException(
        'TEAM_MEMBER_NOT_WORKSPACE_MEMBER',
        'User is not an active member of this workspace',
      );
    }

    /**
     * A team roster row is PROJECT-SCOPED work, so the candidate must already belong to a project the
     * team serves (BA report 2026-08-21: "Backend validation must also reject adding a user who does
     * not belong to the Project").
     *
     * Checked against ANY actively linked project, not every one: a team can serve several projects
     * and `POST /teams/:id/members` carries none, so "every" would make a multi-project team almost
     * unstaffable and would refuse adds that are legitimate on the screen the reader is looking at.
     *
     * A WORKSPACE ADMIN passes with no `project_members` row of their own. That absence is §2.1 and
     * migration 0118, not a missing grant — their authority is the workspace-wide one, which is why
     * `grantTeamRosterProjectAccess` skips them below and why the Project `Users & Permissions` list
     * shows them as a synthesized row. Excluding them here would remove the only path to the
     * Workspace-Admin-on-a-Team feature (2026-08-20) that the same BA asked for.
     *
     * A team with NO active project link admits any active workspace member: there is no project to
     * be outside of, and refusing would make such a team permanently unstaffable.
     */
    const linkedProjectIds = await this.teamRepo.listActiveProjectIds(teamId);
    if (linkedProjectIds.length > 0 && !(await this.access.isWorkspaceAdmin(workspaceId, userId))) {
      const levels = await Promise.all(
        linkedProjectIds.map((projectId) =>
          this.access.getProjectAccessLevel(workspaceId, userId, projectId),
        ),
      );
      if (levels.every((level) => level === null)) {
        throw new PreconditionFailedException(
          'TEAM_MEMBER_NOT_PROJECT_MEMBER',
          "User does not belong to any of this team's projects",
        );
      }
    }

    const existing = await this.teamMemberRepo.findMember(teamId, userId);
    if (existing) {
      throw new ConflictException(
        'TEAM_MEMBER_ALREADY_EXISTS',
        'User is already a member of this team',
      );
    }

    const memberId = uuidv7();
    let toInvalidate: string[] = [];
    const member = await this.uow.run(async (tx) => {
      const created = await this.teamMemberRepo.addMember(
        memberId,
        workspaceId,
        teamId,
        userId,
        tx,
      );
      // RBE-06 — the same rule as `createTeam`, on the third write that can add a roster row.
      // Its scope is the team's currently-linked projects.
      toInvalidate = await this.grantTeamRosterProjectAccess(
        tx,
        workspaceId,
        linkedProjectIds,
        [userId],
        actorId,
      );
      await this.audit.emit(
        {
          action: AUDIT_ACTION.TEAM_MEMBER_ADDED,
          resourceType: AUDIT_RESOURCE.TEAM_MEMBER,
          resourceId: memberId,
          workspaceId,
          actor: { id: actorId },
          changes: { after: { teamId, userId } },
        },
        tx,
      );
      return created;
    });
    await this.access.invalidateUsers(workspaceId, toInvalidate);
    this.logger.log({ teamId, userId }, 'Team member added');
    // Flagged on the way back out, so the row the client renders immediately after the write says the
    // same thing as the roster it will re-fetch. `toInvalidate` is EMPTY for a Workspace Admin — the
    // roster grant is skipped for them (§2.1), which is AC1's "no Admin or Editor Project Access
    // assignment is created or required".
    return {
      ...member,
      isWorkspaceAdmin: await this.access.isWorkspaceAdmin(workspaceId, userId),
    };
  }

  async removeTeamMember(
    teamId: string,
    userId: string,
    workspaceId: string,
    actorId: string,
  ): Promise<void> {
    await this.getTeam(teamId, workspaceId);

    const existing = await this.teamMemberRepo.findMember(teamId, userId);
    if (!existing) {
      throw new NotFoundException('TEAM_MEMBER_NOT_FOUND', 'User is not a member of this team');
    }

    await this.uow.run(async (tx) => {
      await this.dropMemberRow(tx, { workspaceId, teamId, userId, actorId, rowId: existing.id });
    });
    this.logger.log({ teamId, userId }, 'Team member removed');
  }

  /**
   * Drop ONE roster row and the delivery state that hangs off it, inside the caller's transaction.
   *
   * Extracted from {@link removeTeamMember} so the combined project-access write
   * (`ProjectsService.setProjectAccess`) removes a membership by exactly the same rules rather than
   * by a second `teamMemberRepo.removeMember` call that forgets the task unassignment — the shape of
   * bug this repo records as "a rule stated as an invariant implemented as one write's hook".
   */
  private async dropMemberRow(
    tx: DrizzleTx,
    args: { workspaceId: string; teamId: string; userId: string; actorId: string; rowId: string },
  ): Promise<void> {
    const { workspaceId, teamId, userId, actorId, rowId } = args;
    // Unassign this member's tasks IN THIS TEAM before dropping the roster row.
    // Team Status groups rows by task owner and folds in any user who still owns
    // a task, so an owned task would keep a removed member visible. Nulling the
    // assignee drops those tasks to the Unassigned group (SRS P3-TS §8.3:
    // "unassigned can appear as Unassigned") and the member disappears from every
    // Team Status / Iteration Status view. Scoped to this team via
    // coalesce(task team, parent team) so a user on several teams keeps their
    // tasks elsewhere. Not in the BA SRS (which is silent on removal) — this is
    // the ruled fix for the fold-in dev gap.
    const result = await tx.execute(sql`
      UPDATE work.tasks t
      SET assignee_id = NULL, updated_by = ${actorId}, updated_at = NOW()
      WHERE t.assignee_id = ${userId}
        AND t.deleted_at IS NULL
        AND COALESCE(
              t.team_id,
              (SELECT wi.team_id FROM work.work_items wi WHERE wi.id = t.parent_id),
              (SELECT it.team_id FROM work.iterations it WHERE it.id = t.iteration_id)
            ) = ${teamId}
    `);
    const unassignedTaskCount = Number(result?.rowCount ?? 0);

    await this.teamMemberRepo.removeMember(teamId, userId, tx);
    await this.audit.emit(
      {
        action: AUDIT_ACTION.TEAM_MEMBER_REMOVED,
        resourceType: AUDIT_RESOURCE.TEAM_MEMBER,
        resourceId: rowId,
        workspaceId,
        actor: { id: actorId },
        changes: { before: { teamId, userId }, after: { unassignedTaskCount } },
      },
      tx,
    );
  }

  /**
   * The teams AMONG `teamIds` this user is an active member of.
   *
   * Narrow on purpose: the caller passes one project's teams, so the answer is the user's team scope
   * INSIDE that project. `teamMemberRepo.setTeamsForUser` cannot serve this — it reconciles across
   * the whole workspace, so using it from a project-scoped write would silently drop the user's
   * memberships in every OTHER project's teams.
   */
  async listUserTeamIds(userId: string, teamIds: readonly string[]): Promise<string[]> {
    const held = await Promise.all(
      teamIds.map(async (teamId) =>
        (await this.teamMemberRepo.findMember(teamId, userId)) ? teamId : null,
      ),
    );
    return held.filter((id): id is string => id !== null);
  }

  /**
   * Apply an explicit roster diff for ONE user, inside the caller's transaction.
   *
   * The tx-joinable half of {@link addTeamMember} / {@link removeTeamMember}, for the one caller that
   * must write a project access level and its Teams ATOMICALLY
   * (`ProjectsService.setProjectAccess`): if the team write fails the level must not have landed, and
   * `UnitOfWork.run` is `db.transaction`, which does not nest — so those two methods' own
   * transactions could neither be joined nor rolled back with the caller's.
   *
   * It deliberately does NOT imply a project access level the way `addTeamMember` does. That
   * implication reads the user's CURRENT level through `getProjectAccessLevel`
   * (`teamRosterAccessLevel`), which cannot see this transaction — so on a promotion to Admin it
   * would resolve the pre-transaction level and write `editor` back over the Admin grant the same
   * transaction is making. The one caller decides the level itself and passes it to
   * `grantProjectAccess` in this same transaction, which is a stronger guarantee than the
   * implication, not a weaker one.
   *
   * Adds precede removes so the user is never momentarily left with no team at all — the same
   * ordering, and for the same reason, as the SPA's Editor Teams dialog.
   */
  async applyTeamMembershipDiff(
    tx: DrizzleTx,
    args: {
      workspaceId: string;
      userId: string;
      actorId: string;
      add: readonly string[];
      remove: readonly string[];
    },
  ): Promise<void> {
    const { workspaceId, userId, actorId, add, remove } = args;
    for (const teamId of add) {
      const memberId = uuidv7();
      await this.teamMemberRepo.addMember(memberId, workspaceId, teamId, userId, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.TEAM_MEMBER_ADDED,
          resourceType: AUDIT_RESOURCE.TEAM_MEMBER,
          resourceId: memberId,
          workspaceId,
          actor: { id: actorId },
          changes: { after: { teamId, userId } },
        },
        tx,
      );
    }
    for (const teamId of remove) {
      const existing = await this.teamMemberRepo.findMember(teamId, userId);
      if (!existing) continue;
      await this.dropMemberRow(tx, { workspaceId, teamId, userId, actorId, rowId: existing.id });
    }
  }
}
