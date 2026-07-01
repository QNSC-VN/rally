import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PROJECT_REPOSITORY } from '../domain/ports/project.repository';
import { WORKFLOW_STATUS_REPOSITORY } from '../domain/ports/workflow-status.repository';
import { LABEL_REPOSITORY } from '../domain/ports/label.repository';
import { PROJECT_TEAM_REPOSITORY } from '../domain/ports/project-team.repository';
import { PROJECT_MEMBER_REPOSITORY } from '../domain/ports/project-member.repository';
import { WORKSPACE_MEMBER_REPOSITORY } from '@modules/tenancy';
import type { Project, WorkflowStatus } from '../domain/project.types';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  UnitOfWork,
} from '@platform';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockProject = (o: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  key: 'PROJ',
  name: 'Test Project',
  description: null,
  leadId: null,
  status: 'active',
  settings: {},
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...o,
});

const mockStatus = (o: Partial<WorkflowStatus> = {}): WorkflowStatus => ({
  id: 'status-1',
  tenantId: 'tenant-1',
  projectId: 'proj-1',
  name: 'To Do',
  category: 'to_do',
  color: '#6B7280',
  position: 0,
  isDefault: true,
  createdAt: now,
  updatedAt: now,
  ...o,
});

const mockActor = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  sessionId: 's1',
  jti: 'j1',
  iat: 0,
  exp: 0,
  iss: 'rally',
  aud: 'rally-app',
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
  listByProject: vi.fn().mockResolvedValue([]),
  addTeam: vi.fn().mockResolvedValue(undefined),
  removeTeam: vi.fn().mockResolvedValue(undefined),
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
  let uow: ReturnType<typeof makeUow>;

  beforeEach(async () => {
    projectRepo = makeProjectRepo();
    statusRepo = makeStatusRepo();
    labelRepo = makeLabelRepo();
    projectTeamRepo = makeProjectTeamRepo();
    projectMemberRepo = makeProjectMemberRepo();
    workspaceMemberRepo = makeWorkspaceMemberRepo();
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
        { provide: UnitOfWork, useValue: uow },
      ],
    }).compile();

    service = module.get(ProjectsService);
  });

  // ── createProject ─────────────────────────────────────────────────────────

  describe('createProject', () => {
    it('creates project and seeds default workflow statuses', async () => {
      projectRepo.create.mockResolvedValue(mockProject());
      statusRepo.create.mockResolvedValue(mockStatus());

      const result = await service.createProject(mockActor, 'ws-1', 'proj', 'Test Project');

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

      await service.createProject(mockActor, 'ws-1', 'mykey', 'My Project');

      expect(projectRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'MYKEY' }),
        expect.anything(),
      );
    });

    it('throws ConflictException when key is already taken', async () => {
      projectRepo.findByKey.mockResolvedValue(mockProject());

      await expect(service.createProject(mockActor, 'ws-1', 'PROJ', 'Duplicate')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── getProject ────────────────────────────────────────────────────────────

  describe('getProject', () => {
    it('returns project when found', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      const result = await service.getProject('tenant-1', 'proj-1');
      expect(result.key).toBe('PROJ');
    });

    it('throws NotFoundException when not found', async () => {
      projectRepo.findById.mockResolvedValue(null);
      await expect(service.getProject('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when tenant mismatch', async () => {
      projectRepo.findById.mockResolvedValue(mockProject({ tenantId: 'other-tenant' }));
      await expect(service.getProject('tenant-1', 'proj-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when project is soft-deleted', async () => {
      projectRepo.findById.mockResolvedValue(mockProject({ deletedAt: now }));
      await expect(service.getProject('tenant-1', 'proj-1')).rejects.toThrow(NotFoundException);
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
  });

  // ── deleteProject ─────────────────────────────────────────────────────────

  describe('deleteProject', () => {
    it('soft-deletes project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());

      await service.deleteProject('tenant-1', 'proj-1');

      expect(projectRepo.softDelete).toHaveBeenCalledWith('proj-1');
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
    it('generates a sequential item key like PROJ-1', async () => {
      projectRepo.findById.mockResolvedValue(mockProject({ key: 'PROJ' }));
      projectRepo.incrementCounter.mockResolvedValue(42);

      const key = await service.generateItemKey('tenant-1', 'proj-1');
      expect(key).toBe('PROJ-42');
    });
  });

  // ── listStatuses ──────────────────────────────────────────────────────────

  describe('listStatuses', () => {
    it('returns statuses after validating project access', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.listByProject.mockResolvedValue([mockStatus()]);

      const result = await service.listStatuses('tenant-1', 'proj-1');
      expect(result).toHaveLength(1);
    });
  });

  // ── deleteStatus ──────────────────────────────────────────────────────────

  describe('deleteStatus', () => {
    it('deletes status', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.findById.mockResolvedValue(mockStatus());

      await service.deleteStatus('tenant-1', 'proj-1', 'status-1');
      expect(statusRepo.delete).toHaveBeenCalledWith('status-1');
    });

    it('throws NotFoundException when status does not belong to project', async () => {
      projectRepo.findById.mockResolvedValue(mockProject());
      statusRepo.findById.mockResolvedValue(mockStatus({ projectId: 'other-proj' }));

      await expect(service.deleteStatus('tenant-1', 'proj-1', 'status-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
