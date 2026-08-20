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
  listByWorkspaceWithStats: vi.fn().mockResolvedValue([]),
  // The team's currently-linked projects — the scope a roster row's project grant covers, and the
  // set a READER must intersect with to reach the team at all (RBE-08).
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
  // The team READS' scope (RBE-08 / PRJ-07). `null` = UNRESTRICTED (a Workspace Admin) is the
  // default so the write tests above are unaffected; `[]` means NOTHING, and that these are two
  // different answers is what the read tests assert.
  listReadableProjectIds: vi.fn().mockResolvedValue(null),
  // Who holds the workspace grant, for the roster badge (BA feature 2026-08-20). Nobody by default,
  // so the tests about a Workspace Admin on a Team have to say so.
  listWorkspaceAdminIds: vi.fn().mockResolvedValue([]),
  isWorkspaceAdmin: vi.fn().mockResolvedValue(false),
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

/**
 * TEAM READS ARE SCOPED, NOT MERELY DENIED (RBE-08 / PRJ-07).
 *
 * `GET /workspaces/:id/teams`, `GET /teams/:id` and `GET /teams/:id/members` carried no
 * `@RequirePermission` at all, and `PolicyGuard` ALLOWS a handler with no policy metadata — so every
 * team's name, key, lead and member count, the name and key of every project it links to, and the
 * roster's display names AND EMAILS were readable by any authenticated caller: unscoped for an
 * Editor, unhidden for a No Access principal. §3.1 makes "View Project Details and Teams" a
 * per-Project row.
 *
 * The check lives in the service because no decorator can express it: a team is reached through its
 * project LINKS and may have several, so there is no single project id to resolve, and the list's
 * `null` (unrestricted) versus `[]` (nothing) sentinels are two different answers a scope descriptor
 * cannot carry. Both directions are asserted here — a fix that only proved the denial would pass
 * while having 403'd every Editor's team picker.
 */
describe('TeamService — team reads are scoped to readable projects', () => {
  let service: TeamService;
  let teamRepo: ReturnType<typeof makeTeamRepo>;
  let teamMemberRepo: ReturnType<typeof makeTeamMemberRepo>;
  let access: ReturnType<typeof makeAccessService>;

  const alpha = {
    ...mockTeam({ id: 'team-alpha', key: 'ALP' }),
    memberCount: 2,
    projects: [
      { projectId: 'proj-1', key: 'NXP', name: 'NextGen Platform' },
      { projectId: 'proj-2', key: 'PAY', name: 'Payments' },
    ],
  };
  const beta = {
    ...mockTeam({ id: 'team-beta', key: 'BET' }),
    memberCount: 1,
    projects: [{ projectId: 'proj-2', key: 'PAY', name: 'Payments' }],
  };
  /** The domain permits an unlinked team; only an unrestricted reader has a path to one. */
  const orphan = { ...mockTeam({ id: 'team-orphan', key: 'ORP' }), memberCount: 0, projects: [] };

  beforeEach(async () => {
    teamRepo = makeTeamRepo();
    teamMemberRepo = makeTeamMemberRepo();
    access = makeAccessService();
    teamRepo.listByWorkspaceWithStats.mockResolvedValue([alpha, beta, orphan]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: TEAM_REPOSITORY, useValue: teamRepo },
        { provide: TEAM_MEMBER_REPOSITORY, useValue: teamMemberRepo },
        { provide: WORKSPACE_REPOSITORY, useValue: makeWorkspaceRepo() },
        { provide: WORKSPACE_MEMBER_REPOSITORY, useValue: makeWorkspaceMemberRepo() },
        { provide: UnitOfWork, useValue: makeUow() },
        { provide: AuditProducer, useValue: { emit: vi.fn().mockResolvedValue(undefined) } },
        { provide: AccessService, useValue: access },
      ],
    }).compile();

    service = module.get(TeamService);
  });

  // ── the list ───────────────────────────────────────────────────────────────

  it('gives a Workspace Admin every team, the unlinked one included (null = UNRESTRICTED)', async () => {
    access.listReadableProjectIds.mockResolvedValue(null);

    const teams = await service.listTeamsForReader('ws-1', 'wa-1');

    expect(teams.map((t) => t.id)).toEqual(['team-alpha', 'team-beta', 'team-orphan']);
  });

  it('gives an Editor the teams linked to a project they can read', async () => {
    // The direction that would break if this were over-restricted: the Team picker on Portfolio,
    // the project detail page and every Team column read this list.
    access.listReadableProjectIds.mockResolvedValue(['proj-1']);

    const teams = await service.listTeamsForReader('ws-1', 'editor-1');

    expect(teams.map((t) => t.id)).toEqual(['team-alpha']);
  });

  it('narrows the per-team projects array too, so an unreadable project’s key does not leak', async () => {
    access.listReadableProjectIds.mockResolvedValue(['proj-1']);

    const [team] = await service.listTeamsForReader('ws-1', 'editor-1');

    expect(team.projects).toEqual([{ projectId: 'proj-1', key: 'NXP', name: 'NextGen Platform' }]);
  });

  it('gives a No Access principal NO team, without querying ([] = nothing)', async () => {
    access.listReadableProjectIds.mockResolvedValue([]);

    await expect(service.listTeamsForReader('ws-1', 'nobody')).resolves.toEqual([]);
    // Never build a predicate from an empty set: `inArray(col, [])` is not portable as "match
    // nothing", which is why the empty case short-circuits instead of reaching the repository.
    expect(teamRepo.listByWorkspaceWithStats).not.toHaveBeenCalled();
  });

  it('asks for project:view, the read code every level holds', async () => {
    access.listReadableProjectIds.mockResolvedValue(null);

    await service.listTeamsForReader('ws-1', 'wa-1');

    expect(access.listReadableProjectIds).toHaveBeenCalledWith('ws-1', 'wa-1', 'project:view');
  });

  // ── the detail and the roster ───────────────────────────────────────────────

  it('serves a team detail the reader can reach through a project link', async () => {
    access.listReadableProjectIds.mockResolvedValue(['proj-1']);
    teamRepo.listActiveProjectIds.mockResolvedValue(['proj-1', 'proj-2']);

    await expect(service.getTeamForReader('team-alpha', 'ws-1', 'editor-1')).resolves.toMatchObject(
      {
        id: 'team-1',
      },
    );
  });

  it('404s a team detail whose every link is unreadable — not 403, so the list cannot be probed', async () => {
    access.listReadableProjectIds.mockResolvedValue(['proj-1']);
    teamRepo.listActiveProjectIds.mockResolvedValue(['proj-2']);

    await expect(service.getTeamForReader('team-beta', 'ws-1', 'editor-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s an unlinked team for a scoped reader, and serves it to a Workspace Admin', async () => {
    teamRepo.listActiveProjectIds.mockResolvedValue([]);

    access.listReadableProjectIds.mockResolvedValue(['proj-1']);
    await expect(service.getTeamForReader('team-orphan', 'ws-1', 'editor-1')).rejects.toThrow(
      NotFoundException,
    );

    access.listReadableProjectIds.mockResolvedValue(null);
    await expect(service.getTeamForReader('team-orphan', 'ws-1', 'wa-1')).resolves.toBeTruthy();
  });

  it('serves the roster of a reachable team and refuses an unreachable one', async () => {
    teamMemberRepo.listByTeam.mockResolvedValue([
      { userId: 'user-1', email: 'ada@example.com', displayName: 'Ada' },
    ]);
    access.listReadableProjectIds.mockResolvedValue(['proj-1']);

    teamRepo.listActiveProjectIds.mockResolvedValue(['proj-1']);
    await expect(
      service.listTeamMembersForReader('team-alpha', 'ws-1', 'editor-1'),
    ).resolves.toHaveLength(1);

    teamRepo.listActiveProjectIds.mockResolvedValue(['proj-2']);
    await expect(service.listTeamMembersForReader('team-beta', 'ws-1', 'editor-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  /**
   * A WORKSPACE ADMIN MAY BE A TEAM MEMBER (BA feature, 2026-08-20).
   *
   * This reverses half of §2.1. Team membership is OPERATIONAL scope: it must not create or require a
   * project-access assignment, and it must not change what the admin may do. The other half stands —
   * a Workspace Admin still holds no `work.project_members` row — which is exactly why their roster
   * row has no access level and has to be badged instead.
   */
  describe('a Workspace Admin on a Team', () => {
    beforeEach(() => {
      access.listWorkspaceAdminIds.mockResolvedValue(['wa-1']);
      access.isWorkspaceAdmin.mockResolvedValue(true);
    });

    it('badges the roster row rather than leaving a blank level to guess at (AC1)', async () => {
      teamMemberRepo.listByTeam.mockResolvedValue([
        { id: 'tm-1', userId: 'wa-1', teamId: 'team-1', status: 'active' },
        { id: 'tm-2', userId: 'user-2', teamId: 'team-1', status: 'active' },
      ]);

      const roster = await service.listTeamMembersForReader('team-1', 'ws-1', 'actor-1');

      expect(roster.find((m) => m.userId === 'wa-1')?.isWorkspaceAdmin).toBe(true);
      // `false`, not absent: a client must not have to read "field missing" as "not an admin".
      expect(roster.find((m) => m.userId === 'user-2')?.isWorkspaceAdmin).toBe(false);
    });

    it('asks who the admins are ONCE, not once per row', async () => {
      teamMemberRepo.listByTeam.mockResolvedValue([
        { id: 'tm-1', userId: 'wa-1', teamId: 'team-1', status: 'active' },
        { id: 'tm-2', userId: 'user-2', teamId: 'team-1', status: 'active' },
        { id: 'tm-3', userId: 'user-3', teamId: 'team-1', status: 'active' },
      ]);

      await service.listTeamMembersForReader('team-1', 'ws-1', 'actor-1');

      expect(access.listWorkspaceAdminIds).toHaveBeenCalledTimes(1);
    });

    it('asks nothing at all for an empty roster', async () => {
      teamMemberRepo.listByTeam.mockResolvedValue([]);

      await service.listTeamMembersForReader('team-1', 'ws-1', 'actor-1');

      expect(access.listWorkspaceAdminIds).not.toHaveBeenCalled();
    });

    it('creates NO project-access assignment when adding them (AC1/AC4)', async () => {
      teamRepo.listActiveProjectIds.mockResolvedValue(['proj-1']);

      await service.addTeamMember('team-1', 'wa-1', 'ws-1', 'actor-1');

      expect(teamMemberRepo.addMember).toHaveBeenCalled();
      // The roster grant runs, and it is the grant writer that skips a Workspace Admin — asserted on
      // the CONTRACT it is called with, because deciding it here would be a second copy of §2.1.
      expect(access.grantProjectAccess).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'wa-1', onWorkspaceAdmin: 'skip' }),
        expect.anything(),
      );
    });

    it('returns the new row already badged, so the screen and the next read agree (AC6)', async () => {
      const member = await service.addTeamMember('team-1', 'wa-1', 'ws-1', 'actor-1');

      expect(member.isWorkspaceAdmin).toBe(true);
    });

    it('adds nobody implicitly — a new Team gets only the members it names (AC2)', async () => {
      await service.createTeam(
        'ws-1',
        { name: 'Team Gamma', key: 'TG', projectIds: ['proj-1'], memberUserIds: [] },
        'actor-1',
      );

      expect(teamMemberRepo.setMembers).toHaveBeenCalledWith(
        'ws-1',
        expect.any(String),
        [],
        expect.anything(),
      );
    });
  });

  it('leaves the unscoped listTeams alone — it is the internal validation helper', async () => {
    // `ProjectsService` calls it to validate team ids on a write it has already authorized. If a
    // future change routes an HTTP read through it, this test is the reminder that it is NOT scoped.
    await service.listTeams('ws-1');

    expect(access.listReadableProjectIds).not.toHaveBeenCalled();
  });
});
