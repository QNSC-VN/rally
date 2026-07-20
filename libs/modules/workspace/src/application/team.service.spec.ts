import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  PreconditionFailedException,
  UnitOfWork,
  AuditProducer,
} from '@platform';
import { TeamService } from './team.service';
import { TEAM_REPOSITORY } from '../domain/ports/team.repository';
import { TEAM_MEMBER_REPOSITORY } from '../domain/ports/team-member.repository';
import { WORKSPACE_REPOSITORY } from '../domain/ports/workspace.repository';
import { WORKSPACE_MEMBER_REPOSITORY } from '../domain/ports/workspace-member.repository';

const mockTeam = (o: Record<string, unknown> = {}) => ({
  id: 'team-1',
  workspaceId: 'ws-1',
  name: 'Platform',
  key: 'PLT',
  description: null,
  leadId: null,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const makeTeamRepo = () => ({
  findById: vi.fn().mockResolvedValue(mockTeam()),
});

const makeTeamMemberRepo = () => ({
  findMember: vi.fn().mockResolvedValue(null),
  addMember: vi.fn().mockResolvedValue({ id: 'tm-1', teamId: 'team-1', userId: 'user-2' }),
});

const makeWorkspaceRepo = () => ({
  findById: vi.fn().mockResolvedValue({ id: 'ws-1' }),
});

const makeWorkspaceMemberRepo = () => ({
  isMember: vi.fn().mockResolvedValue(true),
});

const makeUow = () => ({
  run: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
});

describe('TeamService.addTeamMember', () => {
  let service: TeamService;
  let teamRepo: ReturnType<typeof makeTeamRepo>;
  let teamMemberRepo: ReturnType<typeof makeTeamMemberRepo>;
  let workspaceMemberRepo: ReturnType<typeof makeWorkspaceMemberRepo>;

  beforeEach(async () => {
    teamRepo = makeTeamRepo();
    teamMemberRepo = makeTeamMemberRepo();
    workspaceMemberRepo = makeWorkspaceMemberRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: TEAM_REPOSITORY, useValue: teamRepo },
        { provide: TEAM_MEMBER_REPOSITORY, useValue: teamMemberRepo },
        { provide: WORKSPACE_REPOSITORY, useValue: makeWorkspaceRepo() },
        { provide: WORKSPACE_MEMBER_REPOSITORY, useValue: workspaceMemberRepo },
        { provide: UnitOfWork, useValue: makeUow() },
        { provide: AuditProducer, useValue: { emit: vi.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(TeamService);
  });

  it('adds a member who is an active workspace member', async () => {
    await service.addTeamMember('team-1', 'user-2', 'ws-1', 'actor-1');
    expect(workspaceMemberRepo.isMember).toHaveBeenCalledWith('ws-1', 'user-2');
    expect(teamMemberRepo.addMember).toHaveBeenCalled();
  });

  it('rejects a user who is not an active workspace member', async () => {
    workspaceMemberRepo.isMember.mockResolvedValue(false);
    await expect(
      service.addTeamMember('team-1', 'outsider', 'ws-1', 'actor-1'),
    ).rejects.toThrow(PreconditionFailedException);
    expect(teamMemberRepo.addMember).not.toHaveBeenCalled();
  });

  it('rejects when the team is not in the workspace (404) before member checks', async () => {
    teamRepo.findById.mockResolvedValue(null);
    await expect(
      service.addTeamMember('foreign-team', 'user-2', 'ws-1', 'actor-1'),
    ).rejects.toThrow(NotFoundException);
    expect(workspaceMemberRepo.isMember).not.toHaveBeenCalled();
    expect(teamMemberRepo.addMember).not.toHaveBeenCalled();
  });
});
