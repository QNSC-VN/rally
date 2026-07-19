import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  ConflictException,
  UnitOfWork,
  AuditProducer,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
} from '@platform';
import { ITeamRepository, TEAM_REPOSITORY } from '../domain/ports/team.repository';
import {
  ITeamMemberRepository,
  TEAM_MEMBER_REPOSITORY,
} from '../domain/ports/team-member.repository';
import { IWorkspaceRepository, WORKSPACE_REPOSITORY } from '../domain/ports/workspace.repository';
import type { Team, TeamMember, TeamWithStats, UpdateTeamInput } from '../domain/team.types';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @Inject(TEAM_REPOSITORY) private readonly teamRepo: ITeamRepository,
    @Inject(TEAM_MEMBER_REPOSITORY) private readonly teamMemberRepo: ITeamMemberRepository,
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: IWorkspaceRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditProducer,
  ) {}

  async listTeams(workspaceId: string): Promise<TeamWithStats[]> {
    return this.teamRepo.listByWorkspaceWithStats(workspaceId);
  }

  async createTeam(
    workspaceId: string,
    name: string,
    key: string,
    description: string | undefined,
    leadId: string | undefined,
    actorId: string,
  ): Promise<Team> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND', 'Workspace not found');
    }

    const existing = await this.teamRepo.findByKey(workspaceId, key.toUpperCase());
    if (existing) {
      throw new ConflictException(
        'TEAM_KEY_TAKEN',
        `Team key "${key.toUpperCase()}" is already taken in this workspace`,
      );
    }

    const teamId = uuidv7();
    const team = await this.uow.run(async (tx) => {
      const created = await this.teamRepo.create(
        {
          id: teamId,
          workspaceId,
          name,
          key: key.toUpperCase(),
          description,
          leadId,
        },
        tx,
      );
      await this.audit.emit(
        {
          action: AUDIT_ACTION.TEAM_CREATED,
          resourceType: AUDIT_RESOURCE.TEAM,
          resourceId: teamId,
          workspaceId,
          actor: { id: actorId },
          changes: { after: { name, key: key.toUpperCase(), leadId } },
        },
        tx,
      );
      return created;
    });

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
    input: UpdateTeamInput,
    workspaceId: string,
    actorId: string,
  ): Promise<Team> {
    const team = await this.getTeam(id, workspaceId);

    if (input.status === 'archived' && team.status === 'archived') {
      throw new ConflictException('TEAM_ALREADY_ARCHIVED', 'Team is already archived');
    }

    return this.uow.run(async (tx) => {
      const after = await this.teamRepo.update(id, input, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.TEAM_UPDATED,
          resourceType: AUDIT_RESOURCE.TEAM,
          resourceId: id,
          workspaceId,
          actor: { id: actorId },
          changes: { before: team, after },
        },
        tx,
      );
      return after;
    });
  }

  async listTeamMembers(teamId: string, workspaceId: string): Promise<TeamMember[]> {
    await this.getTeam(teamId, workspaceId);
    return this.teamMemberRepo.listByTeam(teamId);
  }

  async addTeamMember(
    teamId: string,
    userId: string,
    workspaceId: string,
    actorId: string,
  ): Promise<TeamMember> {
    // Pass workspaceId so a team from another workspace can't be targeted (was a gap).
    await this.getTeam(teamId, workspaceId);

    const existing = await this.teamMemberRepo.findMember(teamId, userId);
    if (existing) {
      throw new ConflictException(
        'TEAM_MEMBER_ALREADY_EXISTS',
        'User is already a member of this team',
      );
    }

    const memberId = uuidv7();
    const member = await this.uow.run(async (tx) => {
      const created = await this.teamMemberRepo.addMember(
        memberId,
        workspaceId,
        teamId,
        userId,
        tx,
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
    this.logger.log({ teamId, userId }, 'Team member added');
    return member;
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
      await this.teamMemberRepo.removeMember(teamId, userId, tx);
      await this.audit.emit(
        {
          action: AUDIT_ACTION.TEAM_MEMBER_REMOVED,
          resourceType: AUDIT_RESOURCE.TEAM_MEMBER,
          resourceId: existing.id,
          workspaceId,
          actor: { id: actorId },
          changes: { before: { teamId, userId } },
        },
        tx,
      );
    });
    this.logger.log({ teamId, userId }, 'Team member removed');
  }
}
