import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DRIZZLE,
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
} from '@platform';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { IterationsService } from './iterations.service';
import { ITERATION_REPOSITORY } from '../domain/ports/iteration.repository';
import type { Iteration } from '../domain/iteration.types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockIteration = (o: Partial<Iteration> = {}): Iteration => ({
  id: 'it-1',
  workspaceId: 'ws-1',
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

const actor = { sub: 'user-1', workspaceId: 'ws-1' } as never;

describe('IterationsService', () => {
  let service: IterationsService;
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    findCommitted: ReturnType<typeof vi.fn>;
    listByProject: ReturnType<typeof vi.fn>;
    listAssignmentOptions: ReturnType<typeof vi.fn>;
    nextKeyNumber: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let projects: {
    getProject: ReturnType<typeof vi.fn>;
    listProjectTeams: ReturnType<typeof vi.fn>;
  };
  let access: { assertProjectPermission: ReturnType<typeof vi.fn> };
  // Chainable Drizzle mock. Tests set the resolved rows before invoking.
  let dbSelectResult: unknown[];
  let dbUpdateReturning: unknown[];
  let db: {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    dbSelectResult = [];
    dbUpdateReturning = [];
    db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(dbSelectResult)) })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(dbUpdateReturning)) })),
        })),
      })),
    };
    repo = {
      findById: vi.fn(),
      findCommitted: vi.fn().mockResolvedValue(null),
      listByProject: vi.fn(),
      listAssignmentOptions: vi.fn().mockResolvedValue([]),
      nextKeyNumber: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockImplementation((i) => Promise.resolve(mockIteration(i))),
      update: vi
        .fn()
        .mockImplementation((id, patch) => Promise.resolve(mockIteration({ id, ...patch }))),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    projects = {
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
      listProjectTeams: vi.fn().mockResolvedValue([{ teamId: 'team-1', status: 'active' }]),
    };
    access = { assertProjectPermission: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IterationsService,
        { provide: ITERATION_REPOSITORY, useValue: repo },
        { provide: ProjectsService, useValue: projects },
        { provide: AccessService, useValue: access },
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    service = module.get(IterationsService);
  });

  describe('getAssignmentOptions', () => {
    it('validates project exists then delegates to repo', async () => {
      const opts = [mockIteration({ id: 'it-2', state: 'committed' })];
      repo.listAssignmentOptions.mockResolvedValue(opts);

      const result = await service.getAssignmentOptions(actor, 'proj-1', 'team-1');

      expect(projects.getProject).toHaveBeenCalledWith('ws-1', 'proj-1');
      expect(repo.listAssignmentOptions).toHaveBeenCalledWith('proj-1', 'ws-1', 'team-1');
      expect(result).toEqual(opts);
    });

    it('propagates project-not-found when project does not exist', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(service.getAssignmentOptions(actor, 'bad-proj')).rejects.toThrow(
        'PROJECT_NOT_FOUND',
      );
      expect(repo.listAssignmentOptions).not.toHaveBeenCalled();
    });

    it('omits teamId from repo call when not provided', async () => {
      await service.getAssignmentOptions(actor, 'proj-1');
      expect(repo.listAssignmentOptions).toHaveBeenCalledWith('proj-1', 'ws-1', undefined);
    });
  });

  describe('listIterations', () => {
    it('validates project access before listing', async () => {
      repo.listByProject.mockResolvedValue({
        data: [],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: 25 },
      });
      await service.listIterations(actor, 'proj-1', {}, { limit: 25, cursor: null });
      expect(projects.getProject).toHaveBeenCalledWith('ws-1', 'proj-1');
    });

    it('propagates project-not-found to the caller', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(
        service.listIterations(actor, 'bad', {}, { limit: 25, cursor: null }),
      ).rejects.toThrow('PROJECT_NOT_FOUND');
    });
  });

  describe('updateIteration', () => {
    it('rejects changing teamId to a team not linked to the project', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      projects.listProjectTeams.mockResolvedValue([{ teamId: 'other', status: 'active' }]);
      await expect(
        service.updateIteration(actor, 'it-1', { teamId: 'team-1' }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it('rejects an updated date range where endDate is before startDate', async () => {
      repo.findById.mockResolvedValue(
        mockIteration({ state: 'planning', startDate: '2024-06-01', endDate: '2024-06-14' }),
      );
      await expect(
        service.updateIteration(actor, 'it-1', { endDate: '2024-05-01' }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it('updates successfully when team is linked', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      const updated = await service.updateIteration(actor, 'it-1', { name: 'Renamed' });
      expect(updated.name).toBe('Renamed');
    });
  });

  describe('rolloverUnfinished', () => {
    it('rejects a carry-over target from a different project', async () => {
      repo.findById
        .mockResolvedValueOnce(mockIteration({ state: 'committed', projectId: 'proj-1' }))
        .mockResolvedValueOnce(mockIteration({ id: 'it-2', projectId: 'proj-2' }));
      await expect(
        service.rolloverUnfinished(actor, 'it-1', { moveToIterationId: 'it-2' }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it('moves unfinished items and returns the moved count', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      dbSelectResult = [{ id: 'done-status' }]; // done-category statuses exist
      dbUpdateReturning = [{ id: 'wi-1' }, { id: 'wi-2' }];
      const res = await service.rolloverUnfinished(actor, 'it-1');
      expect(res).toEqual({ movedCount: 2 });
    });
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
    it('throws when not found or cross-workspace', async () => {
      repo.findById.mockResolvedValue(mockIteration({ workspaceId: 'other' }));
      await expect(service.getIteration('ws-1', 'it-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('commitIteration', () => {
    it('rejects when another iteration is already committed', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      repo.findCommitted.mockResolvedValue(mockIteration({ id: 'it-2', state: 'committed' }));
      await expect(service.commitIteration(actor, 'it-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('moves planning → committed when none committed', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      const updated = await service.commitIteration(actor, 'it-1');
      expect(updated.state).toBe('committed');
    });
  });

  describe('acceptIteration', () => {
    it('rejects accepting an iteration that is not committed', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      await expect(service.acceptIteration(actor, 'it-1')).rejects.toBeInstanceOf(
        PreconditionFailedException,
      );
    });

    it('rejects accepting an iteration with no assigned Story/Defect (ITERATION_EMPTY)', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      dbSelectResult = [{ total: 0, allAccepted: null }];
      await expect(service.acceptIteration(actor, 'it-1')).rejects.toMatchObject({
        code: 'ITERATION_EMPTY',
      });
    });

    it('rejects accepting when not all items are accepted (ITERATION_NOT_ALL_ACCEPTED)', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      dbSelectResult = [{ total: 3, allAccepted: false }];
      await expect(service.acceptIteration(actor, 'it-1')).rejects.toMatchObject({
        code: 'ITERATION_NOT_ALL_ACCEPTED',
      });
    });

    it('accepts when there is ≥1 item and all are accepted', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      dbSelectResult = [{ total: 3, allAccepted: true }];
      const updated = await service.acceptIteration(actor, 'it-1');
      expect(updated.state).toBe('accepted');
      expect(repo.update).toHaveBeenCalledWith(
        'it-1',
        expect.objectContaining({ state: 'accepted' }),
      );
    });
  });

  describe('deleteIteration', () => {
    it('only allows deleting planning-state iterations', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      await expect(service.deleteIteration(actor, 'it-1')).rejects.toBeInstanceOf(
        PreconditionFailedException,
      );
    });
  });
});
