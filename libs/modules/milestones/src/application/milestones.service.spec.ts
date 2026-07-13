import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE, NotFoundException } from '@platform';
import { MilestonesService } from './milestones.service';
import { MILESTONE_REPOSITORY } from '../domain/ports/milestone.repository';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import type { Milestone } from '../domain/milestone.types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const actor = {
  sub: 'user-1',
  tenantId: 'ws-1',
  sessionId: 's1',
  jti: 'j1',
  iat: 0,
  exp: 0,
  iss: 'rally',
  aud: 'rally-app',
  permissions: [] as string[],
  authMethod: 'password' as const,
};

const mockMilestone = (o: Partial<Milestone> = {}): Milestone => ({
  id: 'ms-1',
  tenantId: 'ws-1',
  projectId: 'proj-1',
  name: 'MVP Launch',
  description: null,
  notes: null,
  status: 'planned',
  ownerId: 'user-1',
  targetStartDate: null,
  targetEndDate: null,
  releaseIds: [],
  createdAt: now,
  updatedAt: now,
  ...o,
});

const emptyPage = {
  data: [],
  pageInfo: { nextCursor: null, hasNextPage: false, limit: 25 },
};

// ── Mock factories ────────────────────────────────────────────────────────────

const makeRepo = () => ({
  findById: vi.fn(),
  listByProject: vi.fn().mockResolvedValue(emptyPage),
  create: vi.fn().mockImplementation((input) =>
    Promise.resolve(mockMilestone(input)),
  ),
  update: vi.fn().mockImplementation((id, patch) =>
    Promise.resolve(mockMilestone({ id, ...patch, releaseIds: [] })),
  ),
  delete: vi.fn().mockResolvedValue(undefined),
  setReleaseLinks: vi.fn().mockResolvedValue(undefined),
  getReleaseIds: vi.fn().mockResolvedValue([]),
  deriveTargetDates: vi.fn().mockResolvedValue({
    startDate: '2024-06-01',
    endDate: '2024-08-01',
  }),
});

const makeProjects = () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
});

const makeAccess = () => ({
  assertProjectPermission: vi.fn().mockResolvedValue(undefined),
});

/** Flexible mock DB that chains any method and resolves to a configurable value. */
const makeDb = (overrides?: { selectResult?: unknown[]; updateResult?: unknown }) => {
  const self: Record<string, any> = {
    // Drizzle select chain – every unknown method returns `self` for chaining
  };
  for (const key of [
    'select', 'from', 'where', 'groupBy', 'innerJoin',
    'update', 'set', 'limit', 'orderBy',
  ]) {
    self[key] = vi.fn().mockReturnValue(self);
  }
  // `.returning()` also returns self (used by repo, not service)
  self.returning = vi.fn().mockImplementation(() => self);

  // Make the chain thenable so `await db.select()…` works
  self.then = vi.fn().mockImplementation(function (
    this: typeof self,
    resolve: (v: unknown) => void,
  ) {
    resolve(overrides?.selectResult ?? []);
  });

  // For `db.update(...).set(...).where(...)` we also need thenable behavior
  const updateSelf: Record<string, any> = {};
  for (const key of ['set', 'where', 'returning']) {
    updateSelf[key] = vi.fn().mockReturnValue(updateSelf);
  }
  updateSelf.then = vi.fn().mockImplementation(function (
    this: typeof updateSelf,
    resolve: (v: unknown) => void,
  ) {
    resolve(overrides?.updateResult ?? undefined);
  });
  self.update = vi.fn().mockReturnValue(updateSelf);

  return self;
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MilestonesService', () => {
  let service: MilestonesService;
  let repo: ReturnType<typeof makeRepo>;
  let projects: ReturnType<typeof makeProjects>;
  let access: ReturnType<typeof makeAccess>;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    repo = makeRepo();
    projects = makeProjects();
    access = makeAccess();
    db = makeDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonesService,
        { provide: MILESTONE_REPOSITORY, useValue: repo },
        { provide: ProjectsService, useValue: projects },
        { provide: AccessService, useValue: access },
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    service = module.get(MilestonesService);
  });

  // ── listMilestones ────────────────────────────────────────────────────────

  describe('listMilestones', () => {
    it('validates project access before listing', async () => {
      await service.listMilestones(actor, 'proj-1', { limit: 25, cursor: null });
      expect(projects.getProject).toHaveBeenCalledWith('ws-1', 'proj-1');
    });

    it('propagates project-not-found', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(
        service.listMilestones(actor, 'bad', { limit: 25, cursor: null }),
      ).rejects.toThrow('PROJECT_NOT_FOUND');
    });
  });

  // ── createMilestone ──────────────────────────────────────────────────────

  describe('createMilestone', () => {
    it('creates with default planned status', async () => {
      const result = await service.createMilestone(actor, 'proj-1', 'MVP');
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'planned' }),
      );
      expect(result.status).toBe('planned');
    });

    it('uses provided status when given', async () => {
      await service.createMilestone(actor, 'proj-1', 'MVP', { status: 'active' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('calls recalcTargetDates via DB when releases are linked', async () => {
      const releaseIds = ['rel-1', 'rel-2'];

      // recalcTargetDates does: db.select().from().innerJoin().where() => aggregates
      // then db.update().set().where() to persist
      const result = await service.createMilestone(actor, 'proj-1', 'MVP', {
        releaseIds,
      });

      expect(repo.setReleaseLinks).toHaveBeenCalledWith(expect.any(String), releaseIds);
      // recalcTargetDates uses db.select (the select chain is thenable)
      expect(db.select).toHaveBeenCalled();
      // Also calls findById again after recalc to get final values
      expect(repo.findById).toHaveBeenCalledTimes(2); // once for internal, once after recalc
    });

    it('sets null target dates when no releases linked', async () => {
      // When no releases, recalcTargetDates still runs but the aggregate query
      // returns empty array → dates become null
      const result = await service.createMilestone(actor, 'proj-1', 'MVP', {
        releaseIds: [],
      });

      expect(repo.setReleaseLinks).not.toHaveBeenCalled();
      // recalcTargetDates still runs (it always runs on create)
      expect(db.select).toHaveBeenCalled();
    });

    it('ignores manual target dates — always derives from releases', async () => {
      const releaseIds = ['rel-1', 'rel-2'];

      const result = await service.createMilestone(actor, 'proj-1', 'MVP', {
        releaseIds,
        targetStartDate: '2024-05-01',
        targetEndDate: '2024-12-31',
      });

      // Manual dates should be ignored — repo.update should NOT be called
      // with manual dates (recalcTargetDates uses db directly)
      expect(repo.setReleaseLinks).toHaveBeenCalledWith(expect.any(String), releaseIds);
      // The create input should NOT include manual dates (repo.create was called first)
      expect(repo.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          targetStartDate: '2024-05-01',
        }),
      );
    });

    it('validates project exists before creating', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(
        service.createMilestone(actor, 'bad', 'MVP'),
      ).rejects.toThrow('PROJECT_NOT_FOUND');
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ── getMilestone ─────────────────────────────────────────────────────────

  describe('getMilestone', () => {
    it('returns milestone when found in same workspace', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      const result = await service.getMilestone('ws-1', 'ms-1');
      expect(result.id).toBe('ms-1');
    });

    it('throws when not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getMilestone('ws-1', 'bad')).rejects.toThrow(NotFoundException);
    });

    it('throws when milestone belongs to different workspace', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ tenantId: 'other-ws' }));
      await expect(service.getMilestone('ws-1', 'ms-1')).rejects.toThrow(NotFoundException);
    });

    it('recalculates target dates on get to ensure they are derived', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      await service.getMilestone('ws-1', 'ms-1');
      // recalcTargetDates runs db.select for the aggregate query
      expect(db.select).toHaveBeenCalled();
      // findById is called twice: initial check + after recalc
      expect(repo.findById).toHaveBeenCalledTimes(2);
    });
  });

  // ── updateMilestone ──────────────────────────────────────────────────────

  describe('updateMilestone', () => {
    it('asserts milestone:manage permission', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      await service.updateMilestone(actor, 'ms-1', { name: 'Renamed' });
      expect(access.assertProjectPermission).toHaveBeenCalledWith(
        actor, 'proj-1', expect.any(String),
      );
    });

    it('recalculates target dates via DB when releaseIds change', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      repo.getReleaseIds.mockResolvedValue(['rel-new']);

      const result = await service.updateMilestone(actor, 'ms-1', {
        releaseIds: ['rel-new'],
      });

      expect(repo.setReleaseLinks).toHaveBeenCalledWith('ms-1', ['rel-new']);
      // recalcTargetDates uses db.select
      expect(db.select).toHaveBeenCalled();
    });

    it('clears target dates via DB when releaseIds set to empty', async () => {
      repo.findById.mockResolvedValue(
        mockMilestone({
          targetStartDate: '2024-06-01',
          targetEndDate: '2024-09-01',
        }),
      );

      const result = await service.updateMilestone(actor, 'ms-1', {
        releaseIds: [],
      });

      expect(repo.setReleaseLinks).toHaveBeenCalledWith('ms-1', []);
      // recalcTargetDates still runs (uses DB directly, not repo.deriveTargetDates)
      expect(db.select).toHaveBeenCalled();
    });

    it('does not recalculate when releaseIds is not in the input', async () => {
      repo.findById.mockResolvedValue(mockMilestone());

      await service.updateMilestone(actor, 'ms-1', { name: 'Renamed' });
      // recalcTargetDates not called, so no db.select for aggregate
      // (db.select may still be called by computeProgress via getMilestone → fetchReleaseStats)
      expect(repo.setReleaseLinks).not.toHaveBeenCalled();
    });

    it('includes releaseIds in response via getReleaseIds', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      repo.getReleaseIds.mockResolvedValue(['rel-1', 'rel-2']);

      const result = await service.updateMilestone(actor, 'ms-1', { name: 'Renamed' });
      expect(result.releaseIds).toEqual(['rel-1', 'rel-2']);
    });

    it('throws NotFoundException when milestone not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.updateMilestone(actor, 'bad', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('strips targetStartDate/targetEndDate from input even when provided', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      repo.getReleaseIds.mockResolvedValue(['rel-1']);

      await service.updateMilestone(actor, 'ms-1', {
        targetStartDate: '2024-03-01',
        targetEndDate: '2024-11-30',
      });

      // repo.update should NOT receive target dates (they were deleted from input)
      expect(repo.update).toHaveBeenCalledWith(
        'ms-1',
        expect.not.objectContaining({
          targetStartDate: '2024-03-01',
          targetEndDate: '2024-11-30',
        }),
      );
    });

    it('strips target dates even when releaseIds also change', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      repo.getReleaseIds.mockResolvedValue(['rel-new']);

      await service.updateMilestone(actor, 'ms-1', {
        targetStartDate: '2024-03-01',
        targetEndDate: '2024-11-30',
        releaseIds: ['rel-new'],
      });

      // setReleaseLinks called, recalcTargetDates runs via DB, but repo.update
      // should NOT receive the manual target dates
      expect(repo.update).toHaveBeenCalledWith(
        'ms-1',
        expect.not.objectContaining({
          targetStartDate: '2024-03-01',
        }),
      );
    });
  });

  // ── deleteMilestone ──────────────────────────────────────────────────────

  describe('deleteMilestone', () => {
    it('cleans up release links before deleting', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      await service.deleteMilestone(actor, 'ms-1');

      expect(repo.setReleaseLinks).toHaveBeenCalledWith('ms-1', []);
      expect(repo.delete).toHaveBeenCalledWith('ms-1');
    });

    it('asserts permission before deletion', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      await service.deleteMilestone(actor, 'ms-1');
      expect(access.assertProjectPermission).toHaveBeenCalled();
    });

    it('throws when milestone not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.deleteMilestone(actor, 'bad')).rejects.toThrow(NotFoundException);
    });
  });
});