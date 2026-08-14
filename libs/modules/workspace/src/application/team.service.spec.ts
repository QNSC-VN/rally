import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  PreconditionFailedException,
  UnitOfWork,
  AuditProducer,
} from '@platform';
import { AccessService } from '@modules/access';
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
  findByKey: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockImplementation((input: { id: string }) => Promise.resolve(mockTeam(input))),
  update: vi.fn().mockResolvedValue(mockTeam()),
  countProjectsInWorkspace: vi
    .fn()
    .mockImplementation((_ws: string, ids: string[]) => Promise.resolve(ids.length)),
  setProjectLinks: vi.fn().mockResolvedValue(undefined),
  // The team's currently-linked projects — the scope a roster row's project grant covers.
  listActiveProjectIds: vi.fn().mockResolvedValue(['proj-1']),
  findBlockingCapacityPlans: vi.fn().mockResolvedValue([]),
});

const makeTeamMemberRepo = () => ({
  findMember: vi.fn().mockResolvedValue(null),
  addMember: vi.fn().mockResolvedValue({ id: 'tm-1', teamId: 'team-1', userId: 'user-2' }),
  listByTeam: vi.fn().mockResolvedValue([]),
  setMembers: vi.fn().mockResolvedValue(undefined),
});

/**
 * The one per-Project grant writer. RBE-06 is that a team roster row implies project access, and
 * `TeamService` reaches it through here — so these mocks are what the RBE-06 tests assert on.
 * `getProjectAccessLevel` defaults to `null` = the user holds no level yet.
 */
const makeAccessService = () => ({
  getProjectAccessLevel: vi.fn().mockResolvedValue(null),
  grantProjectAccess: vi.fn().mockResolvedValue({ id: 'pm-1' }),
  invalidateUsers: vi.fn().mockResolvedValue(undefined),
});

const makeWorkspaceRepo = () => ({
  findById: vi.fn().mockResolvedValue({ id: 'ws-1' }),
});

const makeWorkspaceMemberRepo = () => ({
  isMember: vi.fn().mockResolvedValue(true),
});

/** Exposes the tx so a test can prove the grant enlisted on the SAME transaction as the roster row. */
const makeUow = () => {
  const tx = { __tx: 'uow', execute: vi.fn().mockResolvedValue({ rowCount: 0 }) };
  return { run: vi.fn((fn: (tx: unknown) => unknown) => fn(tx)), tx };
};

describe('TeamService — team membership and its project access', () => {
  let service: TeamService;
  let teamRepo: ReturnType<typeof makeTeamRepo>;
  let teamMemberRepo: ReturnType<typeof makeTeamMemberRepo>;
  let workspaceMemberRepo: ReturnType<typeof makeWorkspaceMemberRepo>;
  let access: ReturnType<typeof makeAccessService>;
  let uow: ReturnType<typeof makeUow>;

  beforeEach(async () => {
    teamRepo = makeTeamRepo();
    teamMemberRepo = makeTeamMemberRepo();
    workspaceMemberRepo = makeWorkspaceMemberRepo();
    access = makeAccessService();
    uow = makeUow();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: TEAM_REPOSITORY, useValue: teamRepo },
        { provide: TEAM_MEMBER_REPOSITORY, useValue: teamMemberRepo },
        { provide: WORKSPACE_REPOSITORY, useValue: makeWorkspaceRepo() },
        { provide: WORKSPACE_MEMBER_REPOSITORY, useValue: workspaceMemberRepo },
        { provide: UnitOfWork, useValue: uow },
        { provide: AuditProducer, useValue: { emit: vi.fn().mockResolvedValue(undefined) } },
        { provide: AccessService, useValue: access },
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
    await expect(service.addTeamMember('team-1', 'outsider', 'ws-1', 'actor-1')).rejects.toThrow(
      PreconditionFailedException,
    );
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

  /**
   * RBE-06. §5's closing sentence (AC-9): all three journeys update the same source. This service
   * wrote `work.team_members` with NO project grant, and the SPA compensated by following its
   * `POST /v1/teams` with a `POST /projects/{id}/members` per member — so the rule held for exactly
   * one caller, and any other caller of `POST /v1/teams` produced a team member of a project they
   * could not open.
   */
  describe('a team roster row grants project access (RBE-06)', () => {
    it('grants every selected member on every linked project when a team is created', async () => {
      await service.createTeam(
        'ws-1',
        { name: 'Platform', key: 'PLT', projectIds: ['proj-1'], memberUserIds: ['user-2'] },
        'actor-1',
      );

      expect(access.grantProjectAccess).toHaveBeenCalledWith(
        {
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          userId: 'user-2',
          accessLevel: 'editor',
          actorId: 'actor-1',
          onWorkspaceAdmin: 'skip',
        },
        uow.tx,
      );
    });

    it('grants in the SAME transaction as the roster row it follows from', async () => {
      // A grant that committed separately could survive a rolled-back team, or be lost while the
      // roster row stood — either way the two sources disagree, which is what AC-9 forbids.
      await service.createTeam(
        'ws-1',
        { name: 'Platform', key: 'PLT', projectIds: ['proj-1'], memberUserIds: ['user-2'] },
        'actor-1',
      );
      expect(access.grantProjectAccess).toHaveBeenCalledWith(expect.anything(), uow.tx);
    });

    it('invalidates the granted users AFTER the transaction commits', async () => {
      await service.createTeam(
        'ws-1',
        { name: 'Platform', key: 'PLT', projectIds: ['proj-1'], memberUserIds: ['user-2'] },
        'actor-1',
      );
      expect(access.invalidateUsers).toHaveBeenCalledWith('ws-1', ['user-2']);
    });

    it('never DEMOTES an existing Admin to the team-scoped level', async () => {
      // Being added to a team says nothing about the project authority someone was separately
      // given, and narrowing it as a side effect of a roster edit would revoke access silently.
      access.getProjectAccessLevel.mockResolvedValue('admin');

      await service.createTeam(
        'ws-1',
        { name: 'Platform', key: 'PLT', projectIds: ['proj-1'], memberUserIds: ['user-2'] },
        'actor-1',
      );

      expect(access.grantProjectAccess).toHaveBeenCalledWith(
        expect.objectContaining({ accessLevel: 'admin' }),
        uow.tx,
      );
    });

    it('never IMPLIES Admin for a member who holds no level', async () => {
      // `assertTeamScoped` scopes only `editor`, and Admin is All Teams by definition — so implying
      // Admin from one team's roster would grant authority over every team in the project.
      await service.createTeam(
        'ws-1',
        { name: 'Platform', key: 'PLT', projectIds: ['proj-1'], memberUserIds: ['user-2'] },
        'actor-1',
      );
      expect(access.grantProjectAccess).not.toHaveBeenCalledWith(
        expect.objectContaining({ accessLevel: 'admin' }),
        expect.anything(),
      );
    });

    it('grants on addTeamMember too, scoped to the team’s linked projects', async () => {
      teamRepo.listActiveProjectIds.mockResolvedValue(['proj-1', 'proj-2']);

      await service.addTeamMember('team-1', 'user-2', 'ws-1', 'actor-1');

      expect(access.grantProjectAccess).toHaveBeenCalledTimes(2);
      expect(access.grantProjectAccess).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-2', userId: 'user-2' }),
        uow.tx,
      );
    });

    it('grants the team’s CURRENT roster when a project link is added by an edit', async () => {
      // A rule stated as a condition over membership cannot be a hook on one write — the same
      // lesson `derived-invariants.e2e.spec.ts` records for iteration auto-accept.
      teamMemberRepo.listByTeam.mockResolvedValue([{ userId: 'user-9' }]);

      await service.updateTeam('team-1', { projectIds: ['proj-7'] }, 'ws-1', 'actor-1');

      expect(access.grantProjectAccess).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj-7', userId: 'user-9' }),
        uow.tx,
      );
    });

    it('writes nothing for a member who is a Workspace Admin, and does not refuse the team', async () => {
      // §2.1 keeps a WA off project rosters; refusing here would make a team uncreatable because
      // one selected member happens to be an admin of this workspace.
      access.grantProjectAccess.mockResolvedValue(null);

      await expect(
        service.createTeam(
          'ws-1',
          { name: 'Platform', key: 'PLT', projectIds: ['proj-1'], memberUserIds: ['wa-1'] },
          'actor-1',
        ),
      ).resolves.toBeTruthy();

      expect(access.invalidateUsers).toHaveBeenCalledWith('ws-1', []);
    });
  });
});
