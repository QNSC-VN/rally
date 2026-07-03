import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DRIZZLE,
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
} from '@platform';
import { ProjectsService } from '@modules/projects';
import { IterationsService } from './iterations.service';
import { ITERATION_REPOSITORY } from '../domain/ports/iteration.repository';
import type { Iteration } from '../domain/iteration.types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockIteration = (o: Partial<Iteration> = {}): Iteration => ({
  id: 'it-1',
  tenantId: 'tenant-1',
  projectId: 'proj-1',
  teamId: null,
  iterationKey: 'IT-1',
  name: 'Sprint 24.3',
  goal: null,
  theme: null,
  notes: null,
  state: 'planning',
  plannedVelocity: null,
  startDate: '2024-06-01',
  endDate: '2024-06-14',
  completedAt: null,
  createdAt: now,
  updatedAt: now,
  ...o,
});

const actor = { sub: 'user-1', tenantId: 'tenant-1' } as never;

describe('IterationsService', () => {
  let service: IterationsService;
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    findCommitted: ReturnType<typeof vi.fn>;
    listByProject: ReturnType<typeof vi.fn>;
    nextKeyNumber: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let projects: { getProject: ReturnType<typeof vi.fn>; listProjectTeams: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repo = {
      findById: vi.fn(),
      findCommitted: vi.fn().mockResolvedValue(null),
      listByProject: vi.fn(),
      nextKeyNumber: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockImplementation((i) => Promise.resolve(mockIteration(i))),
      update: vi.fn().mockImplementation((id, patch) => Promise.resolve(mockIteration({ id, ...patch }))),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    projects = {
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
      listProjectTeams: vi.fn().mockResolvedValue([{ teamId: 'team-1', status: 'active' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IterationsService,
        { provide: ITERATION_REPOSITORY, useValue: repo },
        { provide: ProjectsService, useValue: projects },
        { provide: DRIZZLE, useValue: {} },
      ],
    }).compile();

    service = module.get(IterationsService);
  });

  describe('createIteration', () => {
    it('mints an IT-<n> key from the per-project counter', async () => {
      repo.nextKeyNumber.mockResolvedValue(3);
      const it = await service.createIteration(actor, 'proj-1', 'Sprint 24.3', {
        startDate: '2024-06-01',
        endDate: '2024-06-14',
      });
      expect(it.iterationKey).toBe('IT-3');
    });

    it('rejects a team not linked to the project', async () => {
      projects.listProjectTeams.mockResolvedValue([{ teamId: 'other', status: 'active' }]);
      await expect(
        service.createIteration(actor, 'proj-1', 'X', { teamId: 'team-1' }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it('rejects endDate before startDate', async () => {
      await expect(
        service.createIteration(actor, 'proj-1', 'X', {
          startDate: '2024-06-14',
          endDate: '2024-06-01',
        }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });
  });

  describe('getIteration', () => {
    it('throws when not found or cross-tenant', async () => {
      repo.findById.mockResolvedValue(mockIteration({ tenantId: 'other' }));
      await expect(service.getIteration('tenant-1', 'it-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('commitIteration', () => {
    it('rejects when another iteration is already committed', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      repo.findCommitted.mockResolvedValue(mockIteration({ id: 'it-2', state: 'committed' }));
      await expect(service.commitIteration('tenant-1', 'it-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('moves planning → committed when none committed', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      const updated = await service.commitIteration('tenant-1', 'it-1');
      expect(updated.state).toBe('committed');
    });
  });

  describe('acceptIteration', () => {
    it('rejects accepting an iteration that is not committed', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      await expect(service.acceptIteration('tenant-1', 'it-1')).rejects.toBeInstanceOf(
        PreconditionFailedException,
      );
    });
  });

  describe('deleteIteration', () => {
    it('only allows deleting planning-state iterations', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      await expect(service.deleteIteration('tenant-1', 'it-1')).rejects.toBeInstanceOf(
        PreconditionFailedException,
      );
    });
  });
});
