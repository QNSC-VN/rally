import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE, NotFoundException } from '@platform';
import type { JwtPayload } from '@platform';
import { AccessService } from '@modules/access';
import { PortfolioItemsService, PreliminaryEstimateMapService } from '@modules/portfolio';
import { DEFAULT_PRELIMINARY_ESTIMATE_MAP } from '@db/schema/enums';
import { CapacityPlansService } from './capacity-plans.service';
import {
  CAPACITY_PLAN_REPOSITORY,
  type ICapacityPlanRepository,
} from '../domain/ports/capacity-plan.repository';
import type { CapacityPlan, CapacityPlanView } from '../domain/capacity-plan.types';
import type { CapacityAllocationRow } from '../domain/capacity-allocation.types';

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
  let portfolio: Mocked<PortfolioItemsService>;
  let maps: Mocked<PreliminaryEstimateMapService>;
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
            listAllocations: vi.fn().mockResolvedValue([]),
            findAllocation: vi.fn().mockResolvedValue(null),
            findAllocationFor: vi.fn().mockResolvedValue(null),
            createAllocation: vi.fn(),
            updateAllocation: vi.fn(),
            deleteAllocation: vi.fn(),
            totalAllocatedFor: vi.fn().mockResolvedValue(0),
            teamMetrics: vi.fn().mockResolvedValue({ complete: 0, rollup: 0 }),
          },
        },
        {
          provide: AccessService,
          useValue: { assertProjectPermission: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: PreliminaryEstimateMapService,
          useValue: { forWorkspace: vi.fn().mockResolvedValue(DEFAULT_PRELIMINARY_ESTIMATE_MAP) },
        },
        {
          provide: PortfolioItemsService,
          // Allocation targets resolve through the portfolio service; default to a Feature
          // in the plan's project so tests that are not about that check stay short.
          useValue: {
            getItem: vi.fn().mockResolvedValue({
              id: 'fe-1',
              type: 'feature',
              projectId: 'proj-a',
              refinedEstimate: null,
              preliminaryEstimate: 'm',
            }),
          },
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
    portfolio = module.get(PortfolioItemsService);
    maps = module.get(PreliminaryEstimateMapService);
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

    describe("getPlanDetail — the row kind decides which of Rally's rules can fire", () => {
      /** One allocated Feature, with the tier inputs the caller controls. */
      const allocationRow = (over: Partial<CapacityAllocationRow> = {}): CapacityAllocationRow => ({
        id: 'alloc-1',
        planId: 'plan-1',
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: '30',
        createdAt: new Date(),
        updatedAt: new Date(),
        itemKey: 'FE-1',
        name: 'A feature',
        refined: null,
        preliminarySize: 'm',
        totalAllocated: 30,
        rollup: 0,
        complete: 0,
        ...over,
      });

      it("flags a team with no capacity entered — Rally's missing-capacity error", async () => {
        repo.findViewById.mockResolvedValue(
          view({
            teams: [
              {
                id: 'pt-1',
                planId: 'plan-1',
                teamId: 'team-1',
                capacity: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                teamName: 'Alpha',
              },
            ],
          }),
        );

        const detail = await service.getPlanDetail(actor, 'plan-1');
        expect(detail.teams[0].metrics.warnings).toContain('team_missing_capacity');
      });

      it('flags a Feature whose estimate came from no tier at all', async () => {
        // Every tier empty: no allocation, no refined forecast, and a preliminary size the
        // workspace maps to zero. `resolveEstimate` reports `none`, so Rally's Missing
        // Estimate Error applies — and the SERVICE is what supplies that tier, because the
        // repository cannot see the workspace estimate map.
        maps.forWorkspace.mockResolvedValue({
          ...DEFAULT_PRELIMINARY_ESTIMATE_MAP,
          m: { points: 0, count: 0 },
        });
        repo.listAllocations.mockResolvedValue([
          allocationRow({ value: '0', totalAllocated: 0, refined: null }),
        ]);

        const detail = await service.getPlanDetail(actor, 'plan-1');
        expect(detail.allocations[0].tier).toBe('none');
        expect(detail.allocations[0].metrics.warnings).toContain('feature_missing_estimate');
      });

      it('does not flag a Feature that has a preliminary mapping to fall back on', async () => {
        repo.listAllocations.mockResolvedValue([allocationRow()]);
        const detail = await service.getPlanDetail(actor, 'plan-1');
        expect(detail.allocations[0].metrics.warnings).not.toContain('feature_missing_estimate');
      });

      it('never crosses the two rules between row kinds', async () => {
        // A Feature row also has a null capacity, so before `kind` was explicit the two
        // cases were indistinguishable from the input alone.
        repo.listAllocations.mockResolvedValue([allocationRow()]);
        repo.findViewById.mockResolvedValue(
          view({
            teams: [
              {
                id: 'pt-1',
                planId: 'plan-1',
                teamId: 'team-1',
                capacity: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                teamName: 'Alpha',
              },
            ],
          }),
        );

        const detail = await service.getPlanDetail(actor, 'plan-1');
        expect(detail.allocations[0].metrics.warnings).not.toContain('team_missing_capacity');
        expect(detail.teams[0].metrics.warnings).not.toContain('feature_missing_estimate');
      });
    });
  });

  describe('allocate', () => {
    beforeEach(() => {
      repo.findTeam.mockResolvedValue({
        id: 'pt-1',
        planId: 'plan-1',
        teamId: 'team-1',
        capacity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('creates an allocation for a Feature on a team', async () => {
      await service.allocate(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: 20,
      });
      expect(repo.createAllocation).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'plan-1',
          portfolioItemId: 'fe-1',
          teamId: 'team-1',
          value: '20',
        }),
      );
    });

    it('parks demand in the Unallocated bucket when no team is given', async () => {
      await service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', value: 5 });
      expect(repo.createAllocation).toHaveBeenCalledWith(expect.objectContaining({ teamId: null }));
      // No membership check applies to the bucket — it has no team.
      expect(repo.findTeam).not.toHaveBeenCalled();
    });

    it('ADDS to an existing row for the same (Feature, team) pair rather than duplicating', async () => {
      // Rally models sharing as one row per team under a Feature. A second row for the same
      // pair would double-count that team's demand in every total.
      repo.findAllocationFor.mockResolvedValue({
        id: 'al-1',
        planId: 'plan-1',
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: '10',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.allocate(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: 5,
      });

      expect(repo.createAllocation).not.toHaveBeenCalled();
      expect(repo.updateAllocation).toHaveBeenCalledWith('al-1', { value: '15' });
    });

    it('refuses to allocate an EPIC', async () => {
      // Only the lowest portfolio level attaches to the story hierarchy, so an Epic row
      // would have a permanently zero Rollup.
      portfolio.getItem.mockResolvedValue({
        id: 'ep-1',
        type: 'epic',
        projectId: 'proj-a',
      } as never);
      await expect(
        service.allocate(actor, 'plan-1', { portfolioItemId: 'ep-1', teamId: 'team-1' }),
      ).rejects.toMatchObject({ code: 'CAPACITY_ALLOCATION_NOT_FEATURE' });
      expect(repo.createAllocation).not.toHaveBeenCalled();
    });

    it('refuses a Feature from another project', async () => {
      portfolio.getItem.mockResolvedValue({
        id: 'fe-x',
        type: 'feature',
        projectId: 'other-project',
      } as never);
      await expect(
        service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-x', teamId: 'team-1' }),
      ).rejects.toMatchObject({ code: 'CAPACITY_PLAN_RELEASE_MISMATCH' });
    });

    it('requires the team to be ON the plan', async () => {
      repo.findTeam.mockResolvedValue(null);
      await expect(
        service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: 'team-9' }),
      ).rejects.toMatchObject({ code: 'CAPACITY_TEAM_NOT_FOUND' });
    });

    it('refuses to allocate on a PUBLISHED plan', async () => {
      repo.findById.mockResolvedValue(plan({ status: 'published' }));
      await expect(
        service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: 'team-1' }),
      ).rejects.toMatchObject({ code: 'CAPACITY_PLAN_NOT_DRAFT' });
    });
  });

  describe('the blank-Estimate default (anti-circularity)', () => {
    beforeEach(() => {
      repo.findTeam.mockResolvedValue({
        id: 'pt-1',
        planId: 'plan-1',
        teamId: 'team-1',
        capacity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('uses the REFINED estimate when the caller omits a value', async () => {
      portfolio.getItem.mockResolvedValue({
        id: 'fe-1',
        type: 'feature',
        projectId: 'proj-a',
        refinedEstimate: '30',
        preliminaryEstimate: 'm',
      } as never);

      await service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: 'team-1' });

      expect(repo.createAllocation).toHaveBeenCalledWith(expect.objectContaining({ value: '30' }));
    });

    it('falls back to the PRELIMINARY mapping when there is no refined estimate', async () => {
      portfolio.getItem.mockResolvedValue({
        id: 'fe-1',
        type: 'feature',
        projectId: 'proj-a',
        refinedEstimate: null,
        preliminaryEstimate: 'm',
      } as never);

      await service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: 'team-1' });

      // 'm' maps to 5 points in the seeded default.
      expect(repo.createAllocation).toHaveBeenCalledWith(expect.objectContaining({ value: '5' }));
    });

    it('NEVER folds existing allocations into the default', async () => {
      // The subtlest rule in Phase 5: if the default consulted the allocated tier, a blank
      // field would commit the sum of the very allocations it is being used to create.
      repo.totalAllocatedFor.mockResolvedValue(999);
      portfolio.getItem.mockResolvedValue({
        id: 'fe-1',
        type: 'feature',
        projectId: 'proj-a',
        refinedEstimate: null,
        preliminaryEstimate: 'm',
      } as never);

      await service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: 'team-1' });

      // Preliminary 'm' = 5, NOT 999.
      expect(repo.createAllocation).toHaveBeenCalledWith(expect.objectContaining({ value: '5' }));
    });

    it('honours an explicit 0 rather than substituting a default', async () => {
      await service.allocate(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: 0,
      });
      expect(repo.createAllocation).toHaveBeenCalledWith(expect.objectContaining({ value: '0' }));
    });
  });

  describe('allocation edits', () => {
    beforeEach(() => {
      repo.findAllocation.mockResolvedValue({
        id: 'al-1',
        planId: 'plan-1',
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: '10',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.findTeam.mockResolvedValue({
        id: 'pt-1',
        planId: 'plan-1',
        teamId: 'team-2',
        capacity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('404s an allocation that is not on this plan', async () => {
      repo.findAllocation.mockResolvedValue(null);
      await expect(
        service.updateAllocation(actor, 'plan-1', 'nope', { value: 1 }),
      ).rejects.toMatchObject({ code: 'CAPACITY_ALLOCATION_NOT_FOUND' });
    });

    it('moves demand to another team on the plan', async () => {
      await service.updateAllocation(actor, 'plan-1', 'al-1', { teamId: 'team-2' });
      expect(repo.updateAllocation).toHaveBeenCalledWith('al-1', { teamId: 'team-2' });
    });

    it('moves demand INTO the Unallocated bucket without a membership check', async () => {
      await service.updateAllocation(actor, 'plan-1', 'al-1', { teamId: null });
      expect(repo.updateAllocation).toHaveBeenCalledWith('al-1', { teamId: null });
      expect(repo.findTeam).not.toHaveBeenCalled();
    });

    it('removes an allocation', async () => {
      await service.removeAllocation(actor, 'plan-1', 'al-1');
      expect(repo.deleteAllocation).toHaveBeenCalledWith('al-1');
    });
  });
});
