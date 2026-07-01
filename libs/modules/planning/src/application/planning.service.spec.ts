import { Test, TestingModule } from '@nestjs/testing';
import { PlanningService } from './planning.service';
import { SPRINT_REPOSITORY } from '../domain/ports/sprint.repository';
import { DRIZZLE } from '@platform';
import type { Sprint } from '../domain/sprint.types';
import { NotFoundException, ConflictException, PreconditionFailedException } from '@platform';
import { ProjectsService } from '@modules/projects';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockSprint = (o: Partial<Sprint> = {}): Sprint => ({
  id: 'sprint-1',
  tenantId: 'tenant-1',
  projectId: 'proj-1',
  name: 'Sprint 1',
  goal: null,
  status: 'planned',
  startDate: null,
  endDate: null,
  completedAt: null,
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

const makeSprintRepo = () => ({
  findById: vi.fn(),
  findActive: vi.fn().mockResolvedValue(null),
  listByProject: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
});

const makeProjectsService = () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', tenantId: 'tenant-1' }),
});

// Drizzle mock for completeSprint db queries
const makeDb = () => {
  const selectResult = { id: 'status-done' };
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([selectResult]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  return mockChain;
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PlanningService', () => {
  let service: PlanningService;
  let sprintRepo: ReturnType<typeof makeSprintRepo>;
  let projectsService: ReturnType<typeof makeProjectsService>;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    sprintRepo = makeSprintRepo();
    projectsService = makeProjectsService();
    db = makeDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanningService,
        { provide: SPRINT_REPOSITORY, useValue: sprintRepo },
        { provide: ProjectsService, useValue: projectsService },
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    service = module.get(PlanningService);
  });

  // ── listSprints ────────────────────────────────────────────────────────────

  describe('listSprints', () => {
    it('validates project access before listing', async () => {
      sprintRepo.listByProject.mockResolvedValue({ items: [], nextCursor: null, total: 0 });

      await service.listSprints(mockActor, 'proj-1', { limit: 20, cursor: null });

      expect(projectsService.getProject).toHaveBeenCalledWith('tenant-1', 'proj-1');
      expect(sprintRepo.listByProject).toHaveBeenCalledOnce();
    });
  });

  // ── createSprint ──────────────────────────────────────────────────────────

  describe('createSprint', () => {
    it('creates sprint with name and defaults', async () => {
      sprintRepo.create.mockResolvedValue(mockSprint());

      const result = await service.createSprint(mockActor, 'proj-1', 'Sprint 1');

      expect(result.name).toBe('Sprint 1');
      expect(sprintRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sprint 1', tenantId: 'tenant-1', projectId: 'proj-1' }),
      );
    });

    it('passes optional goal and dates', async () => {
      sprintRepo.create.mockResolvedValue(
        mockSprint({ goal: 'Ship MVP', startDate: '2024-07-01', endDate: '2024-07-14' }),
      );

      await service.createSprint(mockActor, 'proj-1', 'Sprint 2', {
        goal: 'Ship MVP',
        startDate: '2024-07-01',
        endDate: '2024-07-14',
      });

      expect(sprintRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ goal: 'Ship MVP', startDate: '2024-07-01' }),
      );
    });
  });

  // ── getSprint ─────────────────────────────────────────────────────────────

  describe('getSprint', () => {
    it('returns sprint when found', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint());
      const result = await service.getSprint('tenant-1', 'sprint-1');
      expect(result.name).toBe('Sprint 1');
    });

    it('throws NotFoundException when not found', async () => {
      sprintRepo.findById.mockResolvedValue(null);
      await expect(service.getSprint('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when tenant mismatch', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint({ tenantId: 'other-tenant' }));
      await expect(service.getSprint('tenant-1', 'sprint-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateSprint ──────────────────────────────────────────────────────────

  describe('updateSprint', () => {
    it('updates sprint', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint());
      sprintRepo.update.mockResolvedValue(mockSprint({ name: 'Sprint 1 Updated' }));

      const result = await service.updateSprint('tenant-1', 'sprint-1', {
        name: 'Sprint 1 Updated',
      });
      expect(result.name).toBe('Sprint 1 Updated');
    });
  });

  // ── deleteSprint ──────────────────────────────────────────────────────────

  describe('deleteSprint', () => {
    it('deletes planned sprint', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint({ status: 'planned' }));

      await service.deleteSprint('tenant-1', 'sprint-1');

      expect(sprintRepo.delete).toHaveBeenCalledWith('sprint-1');
    });

    it('throws PreconditionFailedException for active sprint', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint({ status: 'active' }));

      await expect(service.deleteSprint('tenant-1', 'sprint-1')).rejects.toThrow(
        PreconditionFailedException,
      );
    });

    it('throws PreconditionFailedException for completed sprint', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint({ status: 'completed' }));

      await expect(service.deleteSprint('tenant-1', 'sprint-1')).rejects.toThrow(
        PreconditionFailedException,
      );
    });
  });

  // ── startSprint ───────────────────────────────────────────────────────────

  describe('startSprint', () => {
    it('starts a planned sprint when no active sprint exists', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint({ status: 'planned' }));
      sprintRepo.findActive.mockResolvedValue(null);
      sprintRepo.update.mockResolvedValue(mockSprint({ status: 'active' }));

      const result = await service.startSprint('tenant-1', 'sprint-1');

      expect(result.status).toBe('active');
      expect(sprintRepo.update).toHaveBeenCalledWith('sprint-1', { status: 'active' });
    });

    it('throws PreconditionFailedException if sprint is not planned', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint({ status: 'active' }));

      await expect(service.startSprint('tenant-1', 'sprint-1')).rejects.toThrow(
        PreconditionFailedException,
      );
    });

    it('throws ConflictException when another sprint is active', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint({ status: 'planned' }));
      sprintRepo.findActive.mockResolvedValue(
        mockSprint({ id: 'sprint-active', status: 'active' }),
      );

      await expect(service.startSprint('tenant-1', 'sprint-1')).rejects.toThrow(ConflictException);
    });
  });

  // ── completeSprint ────────────────────────────────────────────────────────

  describe('completeSprint', () => {
    it('completes an active sprint', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint({ status: 'active' }));
      sprintRepo.update.mockResolvedValue(mockSprint({ status: 'completed' }));
      db.where.mockResolvedValue([]); // no done statuses

      const result = await service.completeSprint('tenant-1', 'sprint-1');

      expect(result.status).toBe('completed');
      expect(sprintRepo.update).toHaveBeenCalledWith(
        'sprint-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('throws PreconditionFailedException when sprint is not active', async () => {
      sprintRepo.findById.mockResolvedValue(mockSprint({ status: 'planned' }));

      await expect(service.completeSprint('tenant-1', 'sprint-1')).rejects.toThrow(
        PreconditionFailedException,
      );
    });
  });
});
