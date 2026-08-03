import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessService } from '@modules/access';
import { ProjectsService } from './projects.service';
import { PROJECT_REPOSITORY } from '../domain/ports/project.repository';
import { WORKFLOW_STATUS_REPOSITORY } from '../domain/ports/workflow-status.repository';
import { LABEL_REPOSITORY } from '../domain/ports/label.repository';
import { PROJECT_TEAM_REPOSITORY } from '../domain/ports/project-team.repository';
import { PROJECT_MEMBER_REPOSITORY } from '../domain/ports/project-member.repository';
import { WORKSPACE_MEMBER_REPOSITORY, TeamService } from '@modules/workspace';
import { ActivityLogger } from '@modules/activity';
import type { Project, WorkflowStatus } from '../domain/project.types';

const activityMock = () => ({
  build: vi.fn(() => ({})),
  buildDiff: vi.fn(() => []),
  log: vi.fn(async () => undefined),
  logSafe: vi.fn(async () => undefined),
  listFor: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 50 })),
});
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  UnitOfWork,
  AuditProducer,
  DRIZZLE,
} from '@platform';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockProject = (o: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  workspaceId: 'ws-1',
  key: 'PROJ',
  name: 'Test Project',
  description: null,
  leadId: null,
  startDate: null,
  endDate: null,
  status: 'active',
  settings: {},
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...o,
});

const mockStatus = (o: Partial<WorkflowStatus> = {}): WorkflowStatus => ({
  id: 'status-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  name: 'To Do',
  category: 'to_do',
  color: '#6B7280',
  position: 0,
  isDefault: true,
  createdAt: now,
  ...o,
});

const mockActor = {
  sub: 'user-1',
  workspaceId: 'ws-1',
  contextId: 'ws-1',
  sessionId: 's1',
  jti: 'j1',
  iat: 0,
  exp: 0,
  iss: 'rally',
  aud: 'rally-app',
  permissions: [] as string[],
  claims: { permissions: [] as string[] },
  authMethod: 'password' as const,
};

// ── Mock factories ────────────────────────────────────────────────────────────

const makeProjectRepo = () => ({
  findById: vi.fn(),
  findByKey: vi.fn().mockResolvedValue(null),
  listByWorkspace: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn().mockResolvedValue(undefined),
  initCounter: vi.fn().mockResolvedValue(undefined),
  incrementCounter: vi.fn().mockResolvedValue(1),
  getMaxItemNumber: vi.fn().mockResolvedValue(0),
});

const makeStatusRepo = () => ({
  findById: vi.fn(),
  listByProject: vi.fn().mockResolvedValue([]),
  listTransitions: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
  updatePositions: vi.fn().mockResolvedValue(undefined),
  canTransition: vi.fn().mockResolvedValue(true),
  createTransition: vi.fn(),
  deleteTransition: vi.fn().mockResolvedValue(undefined),
});

const makeLabelRepo = () => ({
  findById: vi.fn(),
  listByProject: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
});

const makeProjectTeamRepo = () => ({
  findLink: vi.fn().mockResolvedValue(null),
  listByProject: vi.fn().mockResolvedValue([]),
  linkTeam: vi.fn().mockResolvedValue(undefined),
  unlinkTeam: vi.fn().mockResolvedValue(undefined),
});

const makeProjectMemberRepo = () => ({
  listByProject: vi.fn().mockResolvedValue([]),
  findMember: vi.fn().mockResolvedValue(null),
  addMember: vi.fn().mockResolvedValue(undefined),
  updateMember: vi.fn().mockResolvedValue(undefined),
  removeMember: vi.fn().mockResolvedValue(undefined),
});

const makeWorkspaceMemberRepo = () => ({
  findMember: vi.fn().mockResolvedValue({ userId: 'user-1', status: 'active' }),
  listMembers: vi.fn().mockResolvedValue([]),
  addMember: vi.fn().mockResolvedValue(undefined),
  updateMember: vi.fn().mockResolvedValue(undefined),
  removeMember: vi.fn().mockResolvedValue(undefined),
});

// Execute the wrapped work immediately with a stub transaction so repository
// mocks receive a tx argument exactly as they would in production.
const makeUow = () => ({
  run: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ProjectsService', () => {
  let service: ProjectsService;
  let projectRepo: ReturnType<typeof makeProjectRepo>;
  let statusRepo: ReturnType<typeof makeStatusRepo>;
  let labelRepo: ReturnType<typeof makeLabelRepo>;
  let projectTeamRepo: ReturnType<typeof makeProjectTeamRepo>;
  let projectMemberRepo: ReturnType<typeof makeProjectMemberRepo>;
  let workspaceMemberRepo: ReturnType<typeof makeWorkspaceMemberRepo>;
  let teamService: { listTeams: ReturnType<typeof vi.fn> };
  let uow: ReturnType<typeof makeUow>;
  /** Capacity plans that BLOCK an unlink. Empty unless a test is about that refusal. */
  let capacityPlanRows: Array<{ planKey: string; name: string }>;

  beforeEach(async () => {
    capacityPlanRows = [];
    projectRepo = makeProjectRepo();
    statusRepo = makeStatusRepo();
    labelRepo = makeLabelRepo();
    projectTeamRepo = makeProjectTeamRepo();
    projectMemberRepo = makeProjectMemberRepo();
    workspaceMemberRepo = makeWorkspaceMemberRepo();
    teamService = { listTeams: vi.fn().mockResolvedValue([]) };
    uow = makeUow();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PROJECT_REPOSITORY, useValue: projectRepo },
        { provide: WORKFLOW_STATUS_REPOSITORY, useValue: statusRepo },
        { provide: LABEL_REPOSITORY, useValue: labelRepo },
        { provide: PROJECT_TEAM_REPOSITORY, useValue: projectTeamRepo },
        { provide: PROJECT_MEMBER_REPOSITORY, useValue: projectMemberRepo },
        { provide: WORKSPACE_MEMBER_REPOSITORY, useValue: workspaceMemberRepo },
        { provide: TeamService, useValue: teamService },
        { provide: UnitOfWork, useValue: uow },
        { provide: AuditProducer, useValue: { emit: vi.fn().mockResolvedValue(undefined) } },
        { provide: ActivityLogger, useValue: activityMock() },
        // `listProjects` now asks which projects the caller may read. `null` = UNRESTRICTED, which
        // keeps these specs' expectations about the unfiltered page intact; the restriction itself is
        // covered end-to-end in `test/e2e/read-scoping.e2e.spec.ts`.
        {
          provide: AccessService,
          useValue: { listReadableProjectIds: vi.fn().mockResolvedValue(null) },
        },
        {
          provide: DRIZZLE,
          /**
           * One chain: `unlinkTeam`'s capacity-plan guard
           * (`select→from→innerJoin→where→orderBy→limit`). Empty by default — a team on no plan is
           * the ordinary case — and a test that wants the unlink refused sets `capacityPlanRows`.
           */
          useValue: {
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => ({
                    orderBy: () => ({ limit: () => Promise.resolve(capacityPlanRows) }),
                  }),
                }),
              }),
            }),
          },
        },
      ],
    }).compile();

    service = module.get(ProjectsService);
  });

  // ── createProject ─────────────────────────────────────────────────────────

  describe('createProject', () => {
    it('creates project and seeds default workflow statuses', async () => {
      projectRepo.create.mockResolvedValue(mockProject());
      statusRepo.create.mockResolvedValue(mockStatus());

      const result = await service.createProject(mockActor, { key: 'proj', name: 'Test Project' });

      expect(result.key).toBe('PROJ');
      expect(projectRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'PROJ', name: 'Test Project' }),
        expect.anything(),
      );
      // 4 default statuses + 1 counter init
      expect(statusRepo.create).toHaveBeenCalledTimes(4);
    });

    it('normalises project key to uppercase', async () => {
      projectRepo.create.mockResolvedValue(mockProject({ key: 'MYKEY' }));
      statusRepo.create.mockResolvedValue(mockStatus());

      await service.createProject(mockActor, { key: 'mykey', name: 'My Project' });

      expect(projectRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'MYKEY' }),
        expect.anything(),
      );
    });

    it('throws ConflictException when key is already taken', async () => {
      projectRepo.findByKey.mockResolvedValue(mockProject());

      await expect(
        service.createProject(mockActor, { key: 'PROJ', name: 'Duplicate' }),
      ).rejects.toThrow(ConflictException);
    });

    it('persists startDate and links the requested teams inside the transaction', async () => {
      projectRepo.create.mockResolvedValue(mockProject());
      statusRepo.create.mockResolvedValue(mockStatus());
      teamService.listTeams.mockResolvedValue([{ id: 'team-1' }, { id: 'team-2' }]);

      await service.createProject(mockActor, {
        key: 'proj',
        name: 'Test Project',
        startDate: '2026-01-01',
        teamIds: ['team-1', 'team-2', 'team-1'], // duplicate must be deduped
      });

      expect(projectRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2026-01-01' }),
        expect.anything(),
      );
      // Deduped to two links, each carrying the tx argument
      expect(projectTeamRepo.linkTeam).toHaveBeenCalledTimes(2);
      expect(projectTeamRepo.linkTeam).toHaveBeenCalledWith(
        expect.any(String),
        mockActor.workspaceId,
        expect.any(String),
        'team-1',
        expect.anything(),
      );
    });

    it('rejects teams that do not belong to the workspace', async () => {
      projectRepo.create.mockResolvedValue(mockProject());
      teamService.listTeams.mockResolvedValue([{ id: 'team-1' }]);

      await expect(
        service.createProject(mockActor, {
          key: 'proj',
          name: 'Test Project',
          teamIds: ['team-1', 'team-unknown'],
        }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(projectTeamRepo.linkTeam).not.toHaveBeenCalled();
    });

    it('rejects an end date before the start date', async () => {
      await expect(
        service.createProject(mockActor, {
          key: 'proj',
          name: 'Test Project',
          startDate: '2026-09-30',
          endDate: '2026-07-01',
        }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(projectRepo.create).not.toHaveBeenCalled();
    });

    it('persists endDate when the range is valid', async () => {
      projectRepo.create.mockResolvedValue(mockProject({ endDate: '2026-09-30' }));
      statusRepo.create.mockResolvedValue(mockStatus());

      await service.createProject(mockActor, {
        key: 'proj',
        name: 'Test Project',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      });

      expect(projectRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2026-07-01', endDate: '2026-09-30' }),
        expect.anything(),
      );
    });
  });

  // ── linkTeam ──────────────────────────────────────────────────────────────

  describe('linkTeam', () => {
    it('rejects a team that does not belong to the workspace', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      teamService.listTeams.mockResolvedValue([{ id: 'team-1' }]);
      await expect(service.linkTeam('ws-1', 'proj-1', 'team-foreign')).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(projectTeamRepo.linkTeam).not.toHaveBeenCalled();
    });

    it('links a team that belongs to the workspace', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      teamService.listTeams.mockResolvedValue([{ id: 'team-1' }]);
      projectTeamRepo.findLink.mockResolvedValue(null);
      projectTeamRepo.linkTeam.mockResolvedValue({ id: 'link-1', teamId: 'team-1' });
      await service.linkTeam('ws-1', 'proj-1', 'team-1');
      expect(projectTeamRepo.linkTeam).toHaveBeenCalled();
    });
  });

  describe('unlinkTeam', () => {
    it("REFUSES while the team is on one of this project's capacity plans", async () => {
      /**
       * `project_teams` is a soft status flip, so `fk_capacity_plan_teams_team ON DELETE RESTRICT`
       * never fires: nothing stopped an unlink from leaving the team's plan row and its allocations
       * behind, which is exactly the state migration 0085 had to clean up. Releases already refuse
       * deletion for a dependent plan; this is the same rule for the other reference.
       */
      projectRepo.findById.mockResolvedValue(mockProject());
      projectTeamRepo.findLink.mockResolvedValue({ id: 'link-1', teamId: 'team-1' });
      capacityPlanRows = [{ planKey: 'CP-2', name: 'Q3 capacity' }];

      await expect(service.unlinkTeam('ws-1', 'proj-1', 'team-1')).rejects.toMatchObject({
        code: 'PROJECT_TEAM_HAS_CAPACITY_PLAN',
      });
      expect(projectTeamRepo.unlinkTeam).not.toHaveBeenCalled();
    });

    it('names the plan, because "remove it from the plan" needs a plan', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      projectTeamRepo.findLink.mockResolvedValue({ id: 'link-1', teamId: 'team-1' });
      capacityPlanRows = [{ planKey: 'CP-2', name: 'Q3 capacity' }];

      await expect(service.unlinkTeam('ws-1', 'proj-1', 'team-1')).rejects.toThrow(
        /CP-2 \(Q3 capacity\)/,
      );
    });

    it('unlinks a team that is on no plan', async () => {
      // The ordinary case, asserted so the guard cannot quietly become a blanket refusal.
      projectRepo.findById.mockResolvedValue(mockProject());
      projectTeamRepo.findLink.mockResolvedValue({ id: 'link-1', teamId: 'team-1' });

      await service.unlinkTeam('ws-1', 'proj-1', 'team-1');
      expect(projectTeamRepo.unlinkTeam).toHaveBeenCalledWith('proj-1', 'team-1');
    });
  });

  // ── assertTeamLinkedToProject (shared rule) ────────────────────────────────

  describe('assertTeamLinkedToProject', () => {
    it('resolves when the team is actively linked to the project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      projectTeamRepo.listByProject.mockResolvedValue([{ teamId: 'team-1', status: 'active' }]);
      await expect(
        service.assertTeamLinkedToProject('ws-1', 'proj-1', 'team-1'),
      ).resolves.toBeUndefined();
    });

    it('throws when the team is not linked to the project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      projectTeamRepo.listByProject.mockResolvedValue([]);
      await expect(service.assertTeamLinkedToProject('ws-1', 'proj-1', 'team-1')).rejects.toThrow(
        PreconditionFailedException,
      );
    });

    it('throws when the link exists but is not active', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      projectTeamRepo.listByProject.mockResolvedValue([{ teamId: 'team-1', status: 'unlinked' }]);
      await expect(service.assertTeamLinkedToProject('ws-1', 'proj-1', 'team-1')).rejects.toThrow(
        PreconditionFailedException,
      );
    });
  });

  // ── addProjectMember ────────────────────────────────────────────────────────

  describe('addProjectMember', () => {
    it('adds a member who is an active workspace member', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      workspaceMemberRepo.findMember.mockResolvedValue({ userId: 'user-2', status: 'active' });
      projectMemberRepo.findMember.mockResolvedValue(null);
      projectMemberRepo.addMember.mockResolvedValue({ id: 'pm-1', userId: 'user-2' });
      await service.addProjectMember('ws-1', 'proj-1', 'user-2');
      expect(projectMemberRepo.addMember).toHaveBeenCalled();
    });

    it('rejects a user who is not an active workspace member', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      workspaceMemberRepo.findMember.mockResolvedValue(null);
      await expect(service.addProjectMember('ws-1', 'proj-1', 'foreign-user')).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(projectMemberRepo.addMember).not.toHaveBeenCalled();
    });
  });

  describe('createTransition', () => {
    const transitionInput = { fromStatusId: 'status-1', toStatusId: 'status-2', name: 'Start' };

    it('creates a transition when both statuses belong to the project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.findById
        .mockResolvedValueOnce(mockStatus({ id: 'status-1' }))
        .mockResolvedValueOnce(mockStatus({ id: 'status-2' }));
      statusRepo.createTransition.mockResolvedValue({ id: 'tr-1' });
      await service.createTransition('ws-1', 'proj-1', transitionInput);
      expect(statusRepo.createTransition).toHaveBeenCalled();
    });

    it('rejects when the from-status belongs to another project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.findById
        .mockResolvedValueOnce(mockStatus({ id: 'status-1', projectId: 'other-proj' }))
        .mockResolvedValueOnce(mockStatus({ id: 'status-2' }));
      await expect(service.createTransition('ws-1', 'proj-1', transitionInput)).rejects.toThrow(
        NotFoundException,
      );
      expect(statusRepo.createTransition).not.toHaveBeenCalled();
    });

    it('rejects when the to-status belongs to another project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.findById
        .mockResolvedValueOnce(mockStatus({ id: 'status-1' }))
        .mockResolvedValueOnce(mockStatus({ id: 'status-2', projectId: 'other-proj' }));
      await expect(service.createTransition('ws-1', 'proj-1', transitionInput)).rejects.toThrow(
        NotFoundException,
      );
      expect(statusRepo.createTransition).not.toHaveBeenCalled();
    });

    it('rejects when a referenced status does not exist', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.findById
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockStatus({ id: 'status-2' }));
      await expect(service.createTransition('ws-1', 'proj-1', transitionInput)).rejects.toThrow(
        NotFoundException,
      );
      expect(statusRepo.createTransition).not.toHaveBeenCalled();
    });
  });

  // ── getProject ────────────────────────────────────────────────────────────

  describe('getProject', () => {
    it('returns project when found', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      const result = await service.getProject('ws-1', 'proj-1');
      expect(result.key).toBe('PROJ');
    });

    it('throws NotFoundException when not found', async () => {
      projectRepo.findById.mockResolvedValue(null);
      await expect(service.getProject('ws-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when workspace mismatch', async () => {
      projectRepo.findById.mockResolvedValue(mockProject({ workspaceId: 'other-ws' }));
      await expect(service.getProject('ws-1', 'proj-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when project is soft-deleted', async () => {
      projectRepo.findById.mockResolvedValue(mockProject({ deletedAt: now }));
      await expect(service.getProject('ws-1', 'proj-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateProject ─────────────────────────────────────────────────────────

  describe('updateProject', () => {
    it('updates project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      projectRepo.update.mockResolvedValue(mockProject({ name: 'Renamed' }));

      const result = await service.updateProject(mockActor, 'proj-1', { name: 'Renamed' });
      expect(result.name).toBe('Renamed');
    });

    it('rejects an end date before the existing start date (merged validation)', async () => {
      projectRepo.findById.mockResolvedValue(mockProject({ startDate: '2026-07-01' }));

      await expect(
        service.updateProject(mockActor, 'proj-1', { endDate: '2026-01-01' }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(projectRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── deleteProject ─────────────────────────────────────────────────────────

  describe('deleteProject', () => {
    it('soft-deletes project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());

      await service.deleteProject('ws-1', 'proj-1');

      expect(projectRepo.softDelete).toHaveBeenCalledWith('proj-1', 'ws-1');
    });
  });

  // ── assertTransitionAllowed ───────────────────────────────────────────────

  describe('assertTransitionAllowed', () => {
    it('resolves when transition is permitted', async () => {
      statusRepo.canTransition.mockResolvedValue(true);
      await expect(
        service.assertTransitionAllowed('proj-1', 'status-a', 'status-b'),
      ).resolves.toBeUndefined();
    });

    it('throws PreconditionFailedException when transition is not allowed', async () => {
      statusRepo.canTransition.mockResolvedValue(false);
      await expect(
        service.assertTransitionAllowed('proj-1', 'status-a', 'status-b'),
      ).rejects.toThrow(PreconditionFailedException);
    });
  });

  // ── generateItemKey ───────────────────────────────────────────────────────

  describe('generateItemKey', () => {
    it('generates a type-prefixed hyphenated key like US-42 for story', async () => {
      projectRepo.findById.mockResolvedValue(mockProject({ key: 'PROJ' }));
      projectRepo.incrementCounter.mockResolvedValue(42);

      const key = await service.generateItemKey('ws-1', 'proj-1', 'story');
      expect(key).toBe('US-42');
      expect(projectRepo.incrementCounter).toHaveBeenCalledWith('ws-1', 'story');
    });

    it('generates DE-1 for defect', async () => {
      projectRepo.findById.mockResolvedValue(mockProject({ key: 'PROJ' }));
      projectRepo.incrementCounter.mockResolvedValue(1);

      const key = await service.generateItemKey('ws-1', 'proj-1', 'defect');
      expect(key).toBe('DE-1');
    });
  });

  // ── listStatuses ──────────────────────────────────────────────────────────

  describe('listStatuses', () => {
    it('returns statuses after validating project access', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.listByProject.mockResolvedValue([mockStatus()]);

      const result = await service.listStatuses('ws-1', 'proj-1');
      expect(result).toHaveLength(1);
    });
  });

  // ── deleteStatus ──────────────────────────────────────────────────────────

  describe('deleteStatus', () => {
    it('deletes status', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.findById.mockResolvedValue(mockStatus());

      await service.deleteStatus('ws-1', 'proj-1', 'status-1');
      expect(statusRepo.delete).toHaveBeenCalledWith('status-1');
    });

    it('throws NotFoundException when status does not belong to project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.findById.mockResolvedValue(mockStatus({ projectId: 'other-proj' }));

      await expect(service.deleteStatus('ws-1', 'proj-1', 'status-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
