import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { IterationStatusService } from './iteration-status.service';
import { IterationsService } from './iterations.service';
import { WorkItemsService } from '@modules/work-items';
import { ITERATION_STATUS_REPOSITORY } from '../domain/ports/iteration-status.repository';
import type { Iteration } from '../domain/iteration.types';

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
  state: 'committed',
  plannedVelocity: 40,
  startDate: '2024-05-01',
  endDate: '2024-06-11',
  completedAt: null,
  createdAt: now,
  updatedAt: now,
  ...o,
});

const actor = {
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

const pageArgs = { limit: 25, cursor: null };
const emptyPage = { data: [], pageInfo: { nextCursor: null, hasNextPage: false, limit: 25 } };

describe('IterationStatusService', () => {
  let service: IterationStatusService;
  let statusRepo: { getMetrics: ReturnType<typeof vi.fn>; listItems: ReturnType<typeof vi.fn> };
  let iterationsService: {
    getIteration: ReturnType<typeof vi.fn>;
    getIterationForView: ReturnType<typeof vi.fn>;
  };
  let workItemsService: {
    createWorkItem: ReturnType<typeof vi.fn>;
    bulkAssignIteration: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    statusRepo = {
      getMetrics: vi.fn().mockResolvedValue({
        totalPlanEstimate: 0,
        acceptedPoints: 0,
        defectCount: 0,
        taskCount: 0,
      }),
      listItems: vi.fn().mockResolvedValue(emptyPage),
    };
    // getStatus reads via getIterationForView (project-scoped view check);
    // createItemInIteration reads via getIteration. Alias both to one mock so a
    // single per-test mockResolvedValue/mockRejectedValue drives either path.
    const getIterationMock = vi.fn().mockResolvedValue(mockIteration());
    iterationsService = { getIteration: getIterationMock, getIterationForView: getIterationMock };
    workItemsService = {
      createWorkItem: vi.fn().mockResolvedValue({ id: 'wi-new' }),
      bulkAssignIteration: vi.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IterationStatusService,
        { provide: ITERATION_STATUS_REPOSITORY, useValue: statusRepo },
        { provide: IterationsService, useValue: iterationsService },
        { provide: WorkItemsService, useValue: workItemsService },
      ],
    }).compile();

    service = module.get(IterationStatusService);
  });

  describe('getStatus metrics', () => {
    it('computes accepted and planned-velocity percentages', async () => {
      statusRepo.getMetrics.mockResolvedValue({
        totalPlanEstimate: 40,
        acceptedPoints: 30,
        defectCount: 2,
        taskCount: 5,
      });
      iterationsService.getIteration.mockResolvedValue(mockIteration({ plannedVelocity: 40 }));

      const res = await service.getStatus(actor, 'it-1', {}, pageArgs);
      expect(res.metrics.acceptedPoints).toBe(30);
      expect(res.metrics.totalPlanEstimate).toBe(40);
      expect(res.metrics.acceptedPercent).toBe(75); // 30/40
      expect(res.metrics.plannedVelocityPercent).toBe(75); // 30/40
      expect(res.metrics.defectCount).toBe(2);
      expect(res.metrics.taskCount).toBe(5);
    });

    it('guards divide-by-zero when there are no points', async () => {
      iterationsService.getIteration.mockResolvedValue(mockIteration({ plannedVelocity: 0 }));
      const res = await service.getStatus(actor, 'it-1', {}, pageArgs);
      expect(res.metrics.acceptedPercent).toBe(0);
      expect(res.metrics.plannedVelocityPercent).toBe(0);
    });

    it('treats null planned velocity as 0', async () => {
      iterationsService.getIteration.mockResolvedValue(mockIteration({ plannedVelocity: null }));
      const res = await service.getStatus(actor, 'it-1', {}, pageArgs);
      expect(res.metrics.plannedVelocity).toBe(0);
      expect(res.metrics.plannedVelocityPercent).toBe(0);
    });

    it('computes days left relative to today (future end)', async () => {
      const future = new Date();
      future.setUTCDate(future.getUTCDate() + 5);
      const iso = future.toISOString().slice(0, 10);
      iterationsService.getIteration.mockResolvedValue(mockIteration({ endDate: iso }));
      const res = await service.getStatus(actor, 'it-1', {}, pageArgs);
      expect(res.metrics.daysLeft).toBe(5);
    });

    it('returns negative days left when the iteration has ended', async () => {
      const past = new Date();
      past.setUTCDate(past.getUTCDate() - 3);
      const iso = past.toISOString().slice(0, 10);
      iterationsService.getIteration.mockResolvedValue(mockIteration({ endDate: iso }));
      const res = await service.getStatus(actor, 'it-1', {}, pageArgs);
      expect(res.metrics.daysLeft).toBe(-3);
    });

    it('returns null days left when there is no end date', async () => {
      iterationsService.getIteration.mockResolvedValue(mockIteration({ endDate: null }));
      const res = await service.getStatus(actor, 'it-1', {}, pageArgs);
      expect(res.metrics.daysLeft).toBeNull();
    });

    it('propagates the iteration-not-found error from getIteration', async () => {
      iterationsService.getIteration.mockRejectedValue(new Error('ITERATION_NOT_FOUND'));
      await expect(service.getStatus(actor, 'bad', {}, pageArgs)).rejects.toThrow(
        'ITERATION_NOT_FOUND',
      );
    });
  });

  describe('createItemInIteration', () => {
    it('creates the item already assigned to the iteration in one step', async () => {
      iterationsService.getIteration.mockResolvedValue(
        mockIteration({ projectId: 'proj-1', teamId: 'team-a' }),
      );
      const res = await service.createItemInIteration(actor, 'it-1', {
        type: 'story',
        title: 'New story',
        planEstimate: '3.00',
      });
      expect(res).toEqual({ workItemId: 'wi-new' });
      expect(workItemsService.createWorkItem).toHaveBeenCalledWith(
        actor,
        'proj-1',
        'story',
        'New story',
        expect.objectContaining({ teamId: 'team-a', storyPoints: '3.00', iterationId: 'it-1' }),
      );
      // Single-permission create-and-assign: no separate bulk-assignment step.
      expect(workItemsService.bulkAssignIteration).not.toHaveBeenCalled();
    });

    it('creates project-scoped (no teamId) when iteration has no team', async () => {
      iterationsService.getIteration.mockResolvedValue(
        mockIteration({ projectId: 'proj-1', teamId: null }),
      );
      await service.createItemInIteration(actor, 'it-1', { type: 'defect', title: 'Bug' });
      expect(workItemsService.createWorkItem).toHaveBeenCalledWith(
        actor,
        'proj-1',
        'defect',
        'Bug',
        expect.objectContaining({ teamId: undefined, iterationId: 'it-1' }),
      );
    });

    it('rejects non-backlog types (only story/defect) before creating', async () => {
      const { PreconditionFailedException: PFE } = await import('@platform');
      iterationsService.getIteration.mockResolvedValue(mockIteration());
      await expect(
        service.createItemInIteration(actor, 'it-1', {
          type: 'task',
          title: 'T',
        }),
      ).rejects.toBeInstanceOf(PFE);
      expect(workItemsService.createWorkItem).not.toHaveBeenCalled();
    });
  });

  describe('getStatus — work items list', () => {
    it('passes filters and page args to statusRepo.listItems', async () => {
      iterationsService.getIteration.mockResolvedValue(mockIteration());
      const filters = { assigneeId: 'user-2' };
      const args = { limit: 10, cursor: null };

      await service.getStatus(actor, 'it-1', filters, args);

      expect(statusRepo.listItems).toHaveBeenCalledWith('it-1', 'ws-1', filters, args);
    });

    it('forwards the paged items list in the response', async () => {
      iterationsService.getIteration.mockResolvedValue(mockIteration());
      const page = {
        data: [{ id: 'wi-1' }],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: 25 },
      };
      statusRepo.listItems.mockResolvedValue(page);

      const res = await service.getStatus(actor, 'it-1', {}, { limit: 25, cursor: null });

      expect(res.items).toEqual(page);
    });
  });
});
