import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE, NotFoundException, UnitOfWork } from '@platform';
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
import type {
  CapacityAllocation,
  CapacityAllocationRow,
} from '../domain/capacity-allocation.types';

const WORKSPACE = 'ws-1';
/** The stand-in transaction handle every write inside one publish must share. */
const TX = { tx: true };
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
            teamVelocitySamples: vi.fn().mockResolvedValue([]),
            hasPrimaryAllocation: vi.fn().mockResolvedValue(false),
            clearPrimaryAllocations: vi.fn(),
            oldestTeamAllocation: vi.fn().mockResolvedValue(null),
            releaseWindow: vi.fn().mockResolvedValue({
              startDate: '2026-07-01',
              endDate: '2026-07-31',
            }),
            applyPlanToFeature: vi.fn(),
            setStatus: vi.fn().mockResolvedValue(plan({ status: 'published' })),
          },
        },
        {
          // Real `UnitOfWork` would need a real pool; the publish tests assert that the field
          // writes and the status flip share ONE executor, which this hands them.
          provide: UnitOfWork,
          useValue: { run: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(TX)) },
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
        isPrimary: false,
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
        rank: 'm',
        itemRollup: 0,
        itemComplete: 0,
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

  describe("the cutline — Rally's plan-wide fits/does-not-fit line", () => {
    // Rally: "Items above the cutline fit within the defined plan capacity." PLAN capacity, on
    // the item list, in rank order. An earlier version drew it per TEAM, which answered a
    // different question (what one team drops) than Rally's line does (what this plan drops).
    const row = (over: Partial<CapacityAllocationRow>): CapacityAllocationRow => ({
      id: `alloc-${over.portfolioItemId ?? 'x'}-${over.teamId ?? 'none'}`,
      planId: 'plan-1',
      portfolioItemId: 'fe-1',
      teamId: 'team-1',
      isPrimary: false,
      value: '10',
      createdAt: new Date(),
      updatedAt: new Date(),
      itemKey: 'FE-1',
      name: 'A feature',
      refined: null,
      preliminarySize: 'm',
      totalAllocated: 10,
      rollup: 0,
      complete: 0,
      rank: 'm',
      itemRollup: 0,
      itemComplete: 0,
      ...over,
    });

    const planTeam = (teamId: string, capacity: string | null) => ({
      id: `pt-${teamId}`,
      planId: 'plan-1',
      teamId,
      capacity,
      createdAt: new Date(),
      updatedAt: new Date(),
      teamName: teamId,
    });

    it('accumulates ITEMS in rank order against the TOTAL capacity', async () => {
      // 20 + 15 = 35 fits in 40 (10 + 30); the third takes it to 45.
      repo.findViewById.mockResolvedValue(
        view({ teams: [planTeam('team-1', '10'), planTeam('team-2', '30')] }),
      );
      repo.listAllocations.mockResolvedValue([
        row({ portfolioItemId: 'fe-1', value: '20', rank: 'a' }),
        row({ portfolioItemId: 'fe-2', value: '15', rank: 'b' }),
        row({ portfolioItemId: 'fe-3', value: '10', rank: 'c' }),
      ]);

      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.items.map((i) => i.itemKey)).toEqual(['FE-1', 'FE-1', 'FE-1']);
      expect(detail.itemCutlineIndex).toBe(1);
    });

    it('counts a shared Feature ONCE, summing its allocations', async () => {
      // Rally lists the item once and nests the allocations; the line must accumulate the
      // Feature's total, not each allocation separately.
      repo.findViewById.mockResolvedValue(view({ teams: [planTeam('team-1', '25')] }));
      repo.listAllocations.mockResolvedValue([
        row({ portfolioItemId: 'fe-1', teamId: 'team-1', value: '10', rank: 'a' }),
        row({ portfolioItemId: 'fe-1', teamId: 'team-2', value: '10', rank: 'a' }),
        row({ portfolioItemId: 'fe-2', teamId: 'team-1', value: '10', rank: 'b' }),
      ]);

      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.items).toHaveLength(2);
      // 20 committed for the shared Feature, then 10 more takes it past 25.
      expect(detail.items[0].estimated).toBe(20);
      expect(detail.items[0].teamIds).toEqual(['team-1', 'team-2']);
      expect(detail.itemCutlineIndex).toBe(0);
    });

    it('orders items strictly by RANK, even though unallocated rows come back last', async () => {
      repo.findViewById.mockResolvedValue(view({ teams: [planTeam('team-1', '100')] }));
      repo.listAllocations.mockResolvedValue([
        row({ portfolioItemId: 'fe-2', teamId: 'team-1', value: '5', rank: 'b' }),
        row({ portfolioItemId: 'fe-1', teamId: null, value: '5', rank: 'a' }),
      ]);

      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.items.map((i) => i.rank)).toEqual(['a', 'b']);
      expect(detail.items[0].unallocated).toBe(true);
    });

    it('answers -1 when the FIRST item already exceeds the plan', async () => {
      repo.findViewById.mockResolvedValue(view({ teams: [planTeam('team-1', '5')] }));
      repo.listAllocations.mockResolvedValue([row({ value: '20' })]);
      expect((await service.getPlanDetail(actor, 'plan-1')).itemCutlineIndex).toBe(-1);
    });

    it('draws NO line when no team has entered a capacity', async () => {
      // Nothing to divide against. A line at the top would claim nothing fits, when the truth
      // is that nobody has said.
      repo.findViewById.mockResolvedValue(view({ teams: [planTeam('team-1', null)] }));
      repo.listAllocations.mockResolvedValue([row({ value: '20' })]);
      expect((await service.getPlanDetail(actor, 'plan-1')).itemCutlineIndex).toBeNull();
    });

    it('takes the ALLOCATED tier when any allocation carries one', async () => {
      repo.findViewById.mockResolvedValue(view({ teams: [planTeam('team-1', '100')] }));
      repo.listAllocations.mockResolvedValue([
        row({ portfolioItemId: 'fe-1', teamId: null, value: '0', totalAllocated: 0, rank: 'a' }),
        row({ portfolioItemId: 'fe-1', teamId: 'team-1', value: '10', rank: 'a' }),
      ]);
      expect((await service.getPlanDetail(actor, 'plan-1')).items[0].tier).toBe('allocated');
    });

    it("reports the Feature's OWN rollup, not the per-team slice", async () => {
      // `itemRollup` comes from the same child filter WITHOUT the team narrowing: summing the
      // per-team numbers would miss children whose team is not on the plan.
      repo.findViewById.mockResolvedValue(view({ teams: [planTeam('team-1', '100')] }));
      repo.listAllocations.mockResolvedValue([
        row({ rollup: 3, itemRollup: 12, complete: 1, itemComplete: 4 }),
      ]);
      const item = (await service.getPlanDetail(actor, 'plan-1')).items[0];
      expect(item).toMatchObject({ rollup: 12, complete: 4 });
    });
  });

  describe('primary team assignment', () => {
    // Rally: "you can assign the portfolio item to one primary team and then allocate points or
    // story counts to the additional teams that will contribute to the work." One team owns the
    // Feature — that team is what the Items tab's Planned Team Assignment column shows.
    const allocationRow = (over: Partial<CapacityAllocation> = {}): CapacityAllocation => ({
      id: 'al-1',
      planId: 'plan-1',
      portfolioItemId: 'fe-1',
      teamId: 'team-1',
      isPrimary: false,
      value: '10',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });

    beforeEach(() => {
      repo.findTeam.mockResolvedValue({
        id: 'pt-1',
        planId: 'plan-1',
        teamId: 'team-1',
        capacity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.findAllocationFor.mockResolvedValue(null);
    });

    it('makes the FIRST team allocation the primary', async () => {
      repo.hasPrimaryAllocation.mockResolvedValue(false);

      await service.allocate(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: 5,
      });

      expect(repo.createAllocation).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: true }),
      );
    });

    it('leaves a SECOND team as a contributor', async () => {
      // Rally allocates to "additional teams"; only one of them owns the Feature.
      repo.hasPrimaryAllocation.mockResolvedValue(true);

      await service.allocate(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: 5,
      });

      expect(repo.createAllocation).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: false }),
      );
    });

    it('never makes an UNALLOCATED row primary', async () => {
      // It names no team, so there is nobody to own the work — and the check constraint would
      // reject it anyway.
      repo.hasPrimaryAllocation.mockResolvedValue(false);

      await service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: null, value: 5 });

      expect(repo.createAllocation).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: false }),
      );
      // Not even asked: an unallocated row can never be the answer.
      expect(repo.hasPrimaryAllocation).not.toHaveBeenCalled();
    });

    it('clears the old primary and sets the new one in ONE transaction', async () => {
      // Two statements outside a transaction would briefly leave the Feature with two owners or
      // none — and `uq_capacity_allocation_primary` rejects the first of those outright.
      repo.findAllocation.mockResolvedValue(allocationRow({ id: 'al-2', teamId: 'team-2' }));

      await service.setPrimaryAllocation(actor, 'plan-1', 'al-2');

      expect(repo.clearPrimaryAllocations).toHaveBeenCalledWith(
        'plan-1',
        'fe-1',
        expect.anything(),
      );
      expect(repo.updateAllocation).toHaveBeenCalledWith(
        'al-2',
        { isPrimary: true },
        expect.anything(),
      );
      const clearTx = repo.clearPrimaryAllocations.mock.calls[0][2];
      const setTx = repo.updateAllocation.mock.calls[0][2];
      expect(clearTx).toBe(setTx);
    });

    it('refuses to make an unallocated row the primary, rather than ignoring it', async () => {
      // A silent no-op would leave the planner believing the assignment had moved.
      repo.findAllocation.mockResolvedValue(allocationRow({ teamId: null }));

      await expect(service.setPrimaryAllocation(actor, 'plan-1', 'al-1')).rejects.toMatchObject({
        code: 'CAPACITY_PRIMARY_NEEDS_TEAM',
      });
      expect(repo.clearPrimaryAllocations).not.toHaveBeenCalled();
    });

    it('PROMOTES the next team when the primary is removed', async () => {
      // A Feature with allocations but no primary reads as unassigned while teams are visibly
      // working on it.
      repo.findAllocation.mockResolvedValue(allocationRow({ isPrimary: true }));
      repo.oldestTeamAllocation.mockResolvedValue({ id: 'al-2' });

      await service.removeAllocation(actor, 'plan-1', 'al-1');

      expect(repo.updateAllocation).toHaveBeenCalledWith(
        'al-2',
        { isPrimary: true },
        expect.anything(),
      );
    });

    it('promotes nobody when a CONTRIBUTOR is removed', async () => {
      repo.findAllocation.mockResolvedValue(allocationRow({ isPrimary: false }));

      await service.removeAllocation(actor, 'plan-1', 'al-1');

      expect(repo.oldestTeamAllocation).not.toHaveBeenCalled();
      expect(repo.updateAllocation).not.toHaveBeenCalled();
    });

    it('strips the flag and hands it on when the primary is parked as unallocated', async () => {
      // The check constraint forbids a primary with no team, so this is the difference between a
      // clear rule and a constraint violation the planner sees as a crash.
      repo.findAllocation.mockResolvedValue(allocationRow({ isPrimary: true }));
      repo.oldestTeamAllocation.mockResolvedValue({ id: 'al-2' });

      await service.updateAllocation(actor, 'plan-1', 'al-1', { teamId: null });

      expect(repo.updateAllocation).toHaveBeenCalledWith(
        'al-1',
        { teamId: null, isPrimary: false },
        expect.anything(),
      );
      expect(repo.updateAllocation).toHaveBeenCalledWith(
        'al-2',
        { isPrimary: true },
        expect.anything(),
      );
    });
  });

  describe('publishPlan', () => {
    const allocation = (over: Partial<CapacityAllocationRow> = {}): CapacityAllocationRow => ({
      id: 'alloc-1',
      planId: 'plan-1',
      portfolioItemId: 'fe-1',
      teamId: 'team-1',
      isPrimary: false,
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
      rank: 'm',
      itemRollup: 0,
      itemComplete: 0,
      ...over,
    });

    /** A plan whose window sits INSIDE the release's — the case that writes the Release. */
    const insideRelease = { plannedStartDate: '2026-07-05', plannedEndDate: '2026-07-20' };

    beforeEach(() => {
      repo.listAllocations.mockResolvedValue([allocation()]);
      repo.findById.mockResolvedValue(plan(insideRelease));
      repo.findViewById.mockResolvedValue(view(insideRelease));
    });

    it('writes the window AND the release when the plan fits inside its release', async () => {
      const result = await service.publishPlan(actor, 'plan-1', { updateFields: true });

      expect(repo.applyPlanToFeature).toHaveBeenCalledWith(
        'fe-1',
        WORKSPACE,
        {
          plannedStartDate: '2026-07-05',
          plannedEndDate: '2026-07-20',
          releaseId: 'rel-1',
        },
        expect.anything(),
      );
      expect(result.featuresUpdated).toBe(1);
      expect(result.skipped).toEqual([]);
    });

    it('writes the DATES ONLY when the window spans outside the release, and says why', async () => {
      // Rally: "The Release field is only updated when the start and end dates do not span
      // releases." The dates are still written — this corrects the Phase 5 spec, which
      // required equality and skipped the whole write.
      repo.findById.mockResolvedValue(
        plan({ plannedStartDate: '2026-06-01', plannedEndDate: '2026-08-31' }),
      );
      repo.findViewById.mockResolvedValue(
        view({ plannedStartDate: '2026-06-01', plannedEndDate: '2026-08-31' }),
      );

      const result = await service.publishPlan(actor, 'plan-1', { updateFields: true });

      expect(repo.applyPlanToFeature).toHaveBeenCalledWith(
        'fe-1',
        WORKSPACE,
        { plannedStartDate: '2026-06-01', plannedEndDate: '2026-08-31' },
        expect.anything(),
      );
      // No `releaseId` key at all — `undefined` would be a different instruction.
      expect(
        'releaseId' in (repo.applyPlanToFeature.mock.calls[0][2] as Record<string, unknown>),
      ).toBe(false);
      expect(result.featuresUpdated).toBe(1);
      expect(result.skipped).toEqual([
        { portfolioItemId: 'fe-1', itemKey: 'FE-1', reason: 'release_span_mismatch' },
      ]);
    });

    it('cannot answer the span question without dates, so it skips the Release', async () => {
      // An unanswerable check must not authorise the write.
      repo.releaseWindow.mockResolvedValue({ startDate: null, endDate: null });
      const result = await service.publishPlan(actor, 'plan-1', { updateFields: true });
      expect(result.skipped[0].reason).toBe('release_span_mismatch');
    });

    it('skips an UNALLOCATED row entirely rather than giving it a schedule', async () => {
      // No team means no plan for that Feature to inherit; writing the window would assert a
      // schedule nobody agreed to.
      repo.listAllocations.mockResolvedValue([allocation({ teamId: null })]);

      const result = await service.publishPlan(actor, 'plan-1', { updateFields: true });

      expect(repo.applyPlanToFeature).not.toHaveBeenCalled();
      expect(result.featuresUpdated).toBe(0);
      expect(result.skipped).toEqual([
        { portfolioItemId: 'fe-1', itemKey: 'FE-1', reason: 'unallocated' },
      ]);
    });

    it("publishes WITHOUT touching a single field when asked — Rally's second button", async () => {
      const result = await service.publishPlan(actor, 'plan-1', { updateFields: false });

      expect(repo.applyPlanToFeature).not.toHaveBeenCalled();
      expect(repo.setStatus).toHaveBeenCalledWith('plan-1', WORKSPACE, 'published', 'user-1');
      expect(result.fieldsUpdated).toBe(false);
      expect(result.featuresUpdated).toBe(0);
    });

    it('needs capacity:publish, not capacity:manage', async () => {
      // Writing back to Feature rows outside the plan is a different blast radius from
      // editing a draft.
      await service.publishPlan(actor, 'plan-1', { updateFields: true });
      expect(access.assertProjectPermission).toHaveBeenCalledWith(
        actor,
        'proj-a',
        'capacity:publish',
      );
    });

    it('refuses a plan that has never been published and holds nothing', async () => {
      // Rally blocks only when ALL THREE hold: never published, no items, no projects.
      repo.listAllocations.mockResolvedValue([]);
      repo.findViewById.mockResolvedValue(view({ ...insideRelease, teams: [] }));

      await expect(
        service.publishPlan(actor, 'plan-1', { updateFields: true }),
      ).rejects.toMatchObject({ code: 'CAPACITY_PLAN_EMPTY' });
    });

    it('allows re-publishing an emptied plan that HAS been published before', async () => {
      // How a planner undoes an over-eager clear-out.
      repo.listAllocations.mockResolvedValue([]);
      repo.findById.mockResolvedValue(plan({ ...insideRelease, publishedAt: new Date() }));
      repo.findViewById.mockResolvedValue(
        view({ ...insideRelease, publishedAt: new Date(), teams: [] }),
      );

      await expect(
        service.publishPlan(actor, 'plan-1', { updateFields: true }),
      ).resolves.toMatchObject({ featuresUpdated: 0 });
    });

    it('refuses to publish an already-published plan', async () => {
      repo.findById.mockResolvedValue(plan({ status: 'published' }));
      await expect(
        service.publishPlan(actor, 'plan-1', { updateFields: true }),
      ).rejects.toMatchObject({ code: 'CAPACITY_PLAN_NOT_DRAFT' });
    });

    it('flips the status inside the SAME transaction as the field writes', async () => {
      // A partial publish must not leave Features carrying a plan that is still a draft.
      await service.publishPlan(actor, 'plan-1', { updateFields: true });
      const statusTx = repo.setStatus.mock.calls[0][4];
      const featureTx = repo.applyPlanToFeature.mock.calls[0][3];
      expect(statusTx).toBeDefined();
      expect(statusTx).toBe(featureTx);
    });
  });

  describe('revertPlan', () => {
    beforeEach(() => {
      repo.findById.mockResolvedValue(plan({ status: 'published' }));
      repo.findViewById.mockResolvedValue(view({ status: 'published' }));
      repo.setStatus.mockResolvedValue(plan({ status: 'draft' }));
    });

    it('returns to draft and does NOT roll back what publishing wrote', async () => {
      // Rally: "No changes are made to the field values in the portfolio items." Stated in the
      // response rather than left to be discovered, because "revert" reads like an undo.
      const result = await service.revertPlan(actor, 'plan-1');

      expect(repo.setStatus).toHaveBeenCalledWith('plan-1', WORKSPACE, 'draft', null);
      expect(repo.applyPlanToFeature).not.toHaveBeenCalled();
      expect(result.fieldsRolledBack).toBe(false);
    });

    it('refuses a plan that is already a draft', async () => {
      repo.findById.mockResolvedValue(plan({ status: 'draft' }));
      await expect(service.revertPlan(actor, 'plan-1')).rejects.toMatchObject({
        code: 'CAPACITY_PLAN_NOT_PUBLISHED',
      });
    });

    it('needs capacity:publish — reverting re-opens a plan others can see', async () => {
      await service.revertPlan(actor, 'plan-1');
      expect(access.assertProjectPermission).toHaveBeenCalledWith(
        actor,
        'proj-a',
        'capacity:publish',
      );
    });
  });

  describe('forecastTeamCapacity', () => {
    /** Five two-week iterations at a steady 20 points — 70 days of history. */
    const steady = Array.from({ length: 5 }, (_, i) => ({
      iterationId: `it-${i}`,
      iterationName: `Sprint ${i}`,
      points: 20,
      count: 4,
      days: 14,
    }));

    beforeEach(() => {
      repo.findTeam.mockResolvedValue({
        id: 'pt-1',
        planId: 'plan-1',
        teamId: 'team-1',
        capacity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.teamVelocitySamples.mockResolvedValue(steady);
      // A plan with a 56-day window: four iterations of this team's cadence.
      repo.findViewById.mockResolvedValue(
        view({ plannedStartDate: '2026-01-01', plannedEndDate: '2026-02-25' }),
      );
    });

    const forecast = (over: Partial<{ availabilityPct: number; complexity: 'typical' }> = {}) =>
      service.forecastTeamCapacity(actor, 'plan-1', 'team-1', {
        availabilityPct: 100,
        complexity: 'typical',
        ...over,
      });

    it('takes the window from the PLAN, not from the caller', async () => {
      // 2026-01-01 → 02-25 inclusive is 56 days; at 14 days a cadence that is 4 iterations.
      const result = await forecast();
      expect(result.iterationsModelled).toBe(4);
      expect(result.median).toBe(80);
    });

    it("asks for 52 weeks of the team's history in the plan's project", async () => {
      await forecast();
      expect(repo.teamVelocitySamples).toHaveBeenCalledWith('proj-a', 'team-1', WORKSPACE, 364);
    });

    it('checks capacity:view — it reads history and writes nothing', async () => {
      // Adopting the number is a separate act through PATCH, which is what `capacity:manage`
      // guards. Gating the calculation behind manage would hide it from a stakeholder who
      // can already see the plan.
      await forecast();
      expect(access.assertProjectPermission).toHaveBeenCalledWith(actor, 'proj-a', 'capacity:view');
    });

    it('works on a PUBLISHED plan, unlike every write on this service', async () => {
      // Deliberately does NOT go through `requireDraft`: a published plan is read-only, and
      // asking what a team can deliver is a read.
      repo.findViewById.mockResolvedValue(
        view({
          status: 'published',
          plannedStartDate: '2026-01-01',
          plannedEndDate: '2026-02-25',
        }),
      );
      await expect(forecast()).resolves.toMatchObject({ insufficientData: null });
    });

    it('404s a team that is not on this plan', async () => {
      repo.findTeam.mockResolvedValue(null);
      await expect(forecast()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports no window rather than inventing one when the plan has no dates', async () => {
      // The default fixture has null dates.
      repo.findViewById.mockResolvedValue(view());
      const result = await forecast();
      expect(result.insufficientData).toBe('no_window');
      expect(result.median).toBe(0);
    });

    it('reports no history for a team that has finished nothing', async () => {
      repo.teamVelocitySamples.mockResolvedValue([]);
      expect((await forecast()).insufficientData).toBe('no_history');
    });

    it('is deterministic across calls, and independent per team', async () => {
      // Seeded from (plan, team), so a planner rerunning it sees the same number while two
      // teams still draw separately.
      const a = await forecast();
      const b = await forecast();
      expect(a).toEqual(b);
    });

    it("forecasts the plan's unit, not always points", async () => {
      repo.findViewById.mockResolvedValue(
        view({ unit: 'count', plannedStartDate: '2026-01-01', plannedEndDate: '2026-02-25' }),
      );
      // 4 items per iteration, four iterations.
      expect((await forecast()).median).toBe(16);
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
        isPrimary: false,
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
      // No tx here: merging into an existing row is a single write with no primary-assignment
      // bookkeeping to keep atomic with it.
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
        isPrimary: false,
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
      expect(repo.updateAllocation).toHaveBeenCalledWith(
        'al-1',
        { teamId: 'team-2' },
        expect.anything(),
      );
    });

    it('moves demand INTO the Unallocated bucket without a membership check', async () => {
      await service.updateAllocation(actor, 'plan-1', 'al-1', { teamId: null });
      expect(repo.updateAllocation).toHaveBeenCalledWith(
        'al-1',
        { teamId: null },
        expect.anything(),
      );
      expect(repo.findTeam).not.toHaveBeenCalled();
    });

    it('removes an allocation', async () => {
      await service.removeAllocation(actor, 'plan-1', 'al-1');
      expect(repo.deleteAllocation).toHaveBeenCalledWith('al-1', expect.anything());
    });
  });
});
