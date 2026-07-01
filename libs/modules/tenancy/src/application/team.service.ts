import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { NotFoundException, ConflictException } from '@platform';
import { ITeamRepository, TEAM_REPOSITORY } from '../domain/ports/team.repository';
import {
  ITeamMemberRepository,
  TEAM_MEMBER_REPOSITORY,
} from '../domain/ports/team-member.repository';
import { IWorkspaceRepository, WORKSPACE_REPOSITORY } from '../domain/ports/workspace.repository';
import type { Team, TeamMember, UpdateTeamInput } from '../domain/team.types';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @Inject(TEAM_REPOSITORY) private readonly teamRepo: ITeamRepository,
    @Inject(TEAM_MEMBER_REPOSITORY) private readonly teamMemberRepo: ITeamMemberRepository,
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: IWorkspaceRepository,
  ) {}

  async listTeams(workspaceId: string): Promise<Team[]> {
    return this.teamRepo.listByWorkspace(workspaceId);
  }

  async createTeam(
    tenantId: string,
    workspaceId: string,
    name: string,
    key: string,
    description?: string,
    leadId?: string,
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

    const team = await this.teamRepo.create({
      id: uuidv7(),
      tenantId,
      workspaceId,
      name,
      key,
      description,
      leadId,
    });

    this.logger.log({ teamId: team.id, workspaceId }, 'Team created');
    return team;
  }

  async getTeam(id: string, tenantId?: string): Promise<Team> {
    const team = await this.teamRepo.findById(id);
    // Return 404 for both "not found" and "wrong tenant" — avoids cross-tenant enumeration.
    if (!team || (tenantId !== undefined && team.tenantId !== tenantId)) {
      throw new NotFoundException('TEAM_NOT_FOUND', 'Team not found');
    }
    return team;
  }

  async updateTeam(id: string, input: UpdateTeamInput, tenantId?: string): Promise<Team> {
    const team = await this.getTeam(id, tenantId);

    if (input.status === 'archived' && team.status === 'archived') {
      throw new ConflictException('TEAM_ALREADY_ARCHIVED', 'Team is already archived');
    }

    return this.teamRepo.update(id, input);
  }

  async listTeamMembers(teamId: string, tenantId?: string): Promise<TeamMember[]> {
    await this.getTeam(teamId, tenantId);
    return this.teamMemberRepo.listByTeam(teamId);
  }

  async addTeamMember(teamId: string, userId: string, tenantId: string): Promise<TeamMember> {
    await this.getTeam(teamId);

    const existing = await this.teamMemberRepo.findMember(teamId, userId);
    if (existing) {
      throw new ConflictException(
        'TEAM_MEMBER_ALREADY_EXISTS',
        'User is already a member of this team',
      );
    }

    const member = await this.teamMemberRepo.addMember(uuidv7(), tenantId, teamId, userId);
    this.logger.log({ teamId, userId }, 'Team member added');
    return member;
  }

  async removeTeamMember(teamId: string, userId: string, tenantId?: string): Promise<void> {
    await this.getTeam(teamId, tenantId);

    const existing = await this.teamMemberRepo.findMember(teamId, userId);
    if (!existing) {
      throw new NotFoundException('TEAM_MEMBER_NOT_FOUND', 'User is not a member of this team');
    }

    await this.teamMemberRepo.removeMember(teamId, userId);
    this.logger.log({ teamId, userId }, 'Team member removed');
  }
}
