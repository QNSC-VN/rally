import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE, NotFoundException } from '@platform';
import type { JwtPayload } from '@platform';
import { AccessService } from '@modules/access';
import { CapacityPlansService } from './capacity-plans.service';
import {
  CAPACITY_PLAN_REPOSITORY,
  type ICapacityPlanRepository,
} from '../domain/ports/capacity-plan.repository';
import type { CapacityPlan, CapacityPlanView } from '../domain/capacity-plan.types';

const WORKSPACE = 'ws-1';
const actor = { sub: 'user-1', workspaceId: WORKSPACE } as JwtPayload;

const plan = (over: Partial<CapacityPlan> = {}): CapacityPlan => ({
  id: 'plan-1',
  workspaceId: WORKSPACE,
  projectId: 'proj-a',
  releaseId: 'rel-1',
  name: 'Q3 plan',
  status: 'draft',
  unit: 'points',
  plannedStartDate: null,
  plannedEndDate: null,
  targetLoadPct: 80,
  publishedAt: null,
  publishedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const view = (over: Partial<CapacityPlanView> = {}): CapacityPlanView => ({
  ...plan(),
  releaseName: 'R1',
  projectName: 'P',
  teams: [],
  totalCapacity: null,
  ...over,
});

describe('CapacityPlansService', () => {
  let service: CapacityPlansService;
  let repo: Mocked<ICapacityPlanRepository>;
  let access: Mocked<AccessService>;
  /** Rows the stubbed Drizzle returns — drives the release/team existence checks. */
  let lookupRows: unknown[];

  beforeEach(async () => {
    lookupRows = [{ id: 'ok' }];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapacityPlansService,
        {
          provide: CAPACITY_PLAN_REPOSITORY,
          useValue: {
            findById: vi.fn().mockResolvedValue(plan()),
            findViewById: vi.fn().mockResolvedValue(view()),
            listByProject: vi.fn().mockResolvedValue([]),
            findByProjectRelease: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(plan()),
            update: vi.fn().mockResolvedValue(plan()),
            findTeam: vi.fn().mockResolvedValue(null),
            addTeam: vi.fn(),
            setTeamCapacity: vi.fn(),
            removeTeam: vi.fn(),
            countTeamAllocations: vi.fn().mockResolvedValue(0),
          },
        },
        {
          provide: AccessService,
          useValue: { assertProjectPermission: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: DRIZZLE,
          useValue: {
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve(lookupRows) }) }),
            }),
          },
        },
      ],
    }).compile();

    service = module.get(CapacityPlansService);
    repo = module.get(CAPACITY_PLAN_REPOSITORY);
    access = module.get(AccessService);
  });

  describe('createPlan', () => {
    const input = {
      projectId: 'proj-a',
      releaseId: 'rel-1',
      name: 'Q3 plan',
      unit: 'points' as const,
    };

    it('checks project permission before writing', async () => {
      access.assertProjectPermission.mockRejectedValue(new Error('denied'));
      await expect(service.createPlan(actor, input)).rejects.toThrow('denied');
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('refuses a release that is not in the project', async () => {
      // No FK on `release_id`, so an unchecked id would make the plan describe a timebox
      // outside its own project while still rendering a resolved release name.
      lookupRows = [];
      await expect(service.createPlan(actor, input)).rejects.toMatchObject({
        code: 'CAPACITY_PLAN_RELEASE_MISMATCH',
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('refuses a second plan for the same release', async () => {
      // `uq_capacity_plan_project_release` is the real guarantee; this gives a named 409
      // instead of a raw unique-violation 500.
      repo.findByProjectRelease.mockResolvedValue(plan());
      await expect(service.createPlan(actor, input)).rejects.toMatchObject({
        code: 'CAPACITY_PLAN_EXISTS',
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('stamps the caller workspace rather than trusting the body', async () => {
      await service.createPlan(actor, input);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WORKSPACE }));
    });
  });

  describe('draft-only guard', () => {
    it('refuses to update a PUBLISHED plan', async () => {
      // A published plan has already written Release and dates onto Features, so editing
      // it in place would leave those writes describing a plan that no longer exists.
      repo.findById.mockResolvedValue(plan({ status: 'published', publishedAt: new Date() }));
      await expect(service.updatePlan(actor, 'plan-1', { name: 'x' })).rejects.toMatchObject({
        code: 'CAPACITY_PLAN_NOT_DRAFT',
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses to add a team to a published plan', async () => {
      repo.findById.mockResolvedValue(plan({ status: 'published' }));
      await expect(service.addTeam(actor, 'plan-1', 'team-1')).rejects.toMatchObject({
        code: 'CAPACITY_PLAN_NOT_DRAFT',
      });
      expect(repo.addTeam).not.toHaveBeenCalled();
    });

    it('refuses to change capacity on a published plan', async () => {
      repo.findById.mockResolvedValue(plan({ status: 'published' }));
      await expect(service.setTeamCapacity(actor, 'plan-1', 'team-1', '10')).rejects.toMatchObject({
        code: 'CAPACITY_PLAN_NOT_DRAFT',
      });
      expect(repo.setTeamCapacity).not.toHaveBeenCalled();
    });

    it('404s an unknown plan before the draft check can matter', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.updatePlan(actor, 'missing', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('teams', () => {
    it('refuses a team that is not in the workspace', async () => {
      lookupRows = [];
      await expect(service.addTeam(actor, 'plan-1', 'team-x')).rejects.toMatchObject({
        code: 'CAPACITY_TEAM_NOT_FOUND',
      });
      expect(repo.addTeam).not.toHaveBeenCalled();
    });

    it('refuses to add the same team twice', async () => {
      repo.findTeam.mockResolvedValue({
        id: 'pt-1',
        planId: 'plan-1',
        teamId: 'team-1',
        capacity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(service.addTeam(actor, 'plan-1', 'team-1')).rejects.toMatchObject({
        code: 'CAPACITY_TEAM_ALREADY_ADDED',
      });
    });

    it('adds a team with NO capacity — joining is not a capacity of zero', async () => {
      await service.addTeam(actor, 'plan-1', 'team-1');
      expect(repo.addTeam).toHaveBeenCalledWith('plan-1', 'team-1');
    });

    it('requires the team to be ON the plan before setting capacity', async () => {
      repo.findTeam.mockResolvedValue(null);
      await expect(service.setTeamCapacity(actor, 'plan-1', 'team-1', '10')).rejects.toMatchObject({
        code: 'CAPACITY_TEAM_NOT_FOUND',
      });
    });

    it('passes null through to CLEAR a capacity rather than storing zero', async () => {
      repo.findTeam.mockResolvedValue({
        id: 'pt-1',
        planId: 'plan-1',
        teamId: 'team-1',
        capacity: '10',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await service.setTeamCapacity(actor, 'plan-1', 'team-1', null);
      expect(repo.setTeamCapacity).toHaveBeenCalledWith('plan-1', 'team-1', null);
    });

    it('refuses to remove a team that still holds allocations', async () => {
      // Cascading would silently delete demand a planner committed, with no undo.
      repo.findTeam.mockResolvedValue({
        id: 'pt-1',
        planId: 'plan-1',
        teamId: 'team-1',
        capacity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.countTeamAllocations.mockResolvedValue(3);

      await expect(service.removeTeam(actor, 'plan-1', 'team-1')).rejects.toMatchObject({
        code: 'CAPACITY_TEAM_HAS_ALLOCATIONS',
      });
      expect(repo.removeTeam).not.toHaveBeenCalled();
    });

    it('removes a team once nothing is allocated to it', async () => {
      repo.findTeam.mockResolvedValue({
        id: 'pt-1',
        planId: 'plan-1',
        teamId: 'team-1',
        capacity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.countTeamAllocations.mockResolvedValue(0);
      await service.removeTeam(actor, 'plan-1', 'team-1');
      expect(repo.removeTeam).toHaveBeenCalledWith('plan-1', 'team-1');
    });
  });

  describe('reads', () => {
    it('404s an unknown plan', async () => {
      repo.findViewById.mockResolvedValue(null);
      await expect(service.getPlan(actor, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('scopes the list to the requested project', async () => {
      await service.listPlans(actor, 'proj-a');
      expect(repo.listByProject).toHaveBeenCalledWith('proj-a', WORKSPACE);
    });
  });
});
