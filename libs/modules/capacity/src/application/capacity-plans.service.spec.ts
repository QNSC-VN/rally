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
  planKey: 'CP-1',
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
            nextKeyNumber: vi.fn().mockResolvedValue(3),
            create: vi.fn().mockResolvedValue(plan()),
            delete: vi.fn(),
            update: vi.fn().mockResolvedValue(plan()),
            findTeam: vi.fn().mockResolvedValue(null),
            addTeam: vi.fn(),
            setTeamCapacity: vi.fn(),
            removeTeam: vi.fn(),
            countTeamAllocations: vi.fn().mockResolvedValue(0),
            listAllocationsForTeam: vi.fn().mockResolvedValue([]),
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
            // TRUE = a row was written. False now means "archived, matched nothing", which publish
            // reports as a skip rather than counting.
            applyPlanToFeature: vi.fn().mockResolvedValue(true),
            listAllocationsForItem: vi.fn().mockResolvedValue([]),
            setFeatureRelease: vi.fn(),
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
          useValue: {
            assertProjectPermission: vi.fn().mockResolvedValue(undefined),
            // TRUE by default: `actor` is an admin here, and draft visibility keys off being a
            // PLANNER. The specs that are about a reader flip this deliberately.
            hasProjectPermission: vi.fn().mockResolvedValue(true),
          },
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
            // Every field the eligibility rules read, stated: a fixture that omits them makes those
            // rules pass by accident, which is how three of them went unenforced.
            getItem: vi.fn().mockResolvedValue({
              id: 'fe-1',
              type: 'feature',
              projectId: 'proj-a',
              refinedEstimate: null,
              preliminaryEstimate: 'm',
              archivedAt: null,
              state: 'developing',
              releaseId: null,
            }),
          },
        },
        {
          provide: DRIZZLE,
          useValue: {
            // `innerJoin` is part of the chain because the team guard now joins `project_teams`: a
            // plan's team must be linked to the plan's PROJECT, not merely present in the workspace.
            // `where()` is BOTH awaitable and `.limit()`-able: the existence guards end in `.limit(1)`,
            // while the team-membership read awaits the where directly. A stub that supported only one
            // shape made the other look like a service bug.
            select: () => {
              const terminal = {
                limit: () => Promise.resolve(lookupRows),
                then: (resolve: (v: unknown) => void) => resolve(lookupRows),
              };
              const tail = { where: () => terminal };
              return { from: () => ({ ...tail, innerJoin: () => tail }) };
            },
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

    it('mints CP-<n> from the per-project counter', async () => {
      // The key the list's ID column shows. Minted here, never accepted from the caller.
      await service.createPlan(actor, input);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ planKey: 'CP-3' }));
    });

    it('RETRIES once with a fresh key on a unique violation', async () => {
      // MAX+1 is not atomic: two concurrent creates can read the same number, and the loser
      // gets 23505 from `uq_capacity_plans_key`. Rereading the counter is the fix.
      const duplicate = Object.assign(new Error('Failed query'), { code: '23505' });
      repo.create.mockRejectedValueOnce(duplicate).mockResolvedValueOnce(plan());
      repo.nextKeyNumber.mockResolvedValueOnce(3).mockResolvedValueOnce(4);

      await service.createPlan(actor, input);

      expect(repo.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ planKey: 'CP-3' }));
      expect(repo.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ planKey: 'CP-4' }));
    });

    it('does NOT retry an error that is not a duplicate key', async () => {
      // Retrying a constraint failure that a new key cannot fix would just double the damage.
      repo.create.mockRejectedValue(new Error('connection reset'));
      await expect(service.createPlan(actor, input)).rejects.toThrow('connection reset');
      expect(repo.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('deletePlan', () => {
    it('deletes a draft after checking the permission', async () => {
      await service.deletePlan(actor, 'plan-1');
      expect(access.assertProjectPermission).toHaveBeenCalledWith(
        actor,
        'proj-a',
        'capacity:manage',
      );
      expect(repo.delete).toHaveBeenCalledWith('plan-1', WORKSPACE);
    });

    it('deletes a PUBLISHED plan too — Rally allows it, unlike every other write here', async () => {
      // "you can delete an existing plan, even if the plan is published". The Release and dates the
      // plan stamped onto Features are those Features' data now; deleting drops the explanation,
      // not the values, and revert is what undoes them.
      repo.findById.mockResolvedValue(plan({ status: 'published', publishedAt: new Date() }));
      await service.deletePlan(actor, 'plan-1');
      expect(repo.delete).toHaveBeenCalledWith('plan-1', WORKSPACE);
    });

    it('404s on an unknown id instead of a silent no-op', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.deletePlan(actor, 'nope')).rejects.toMatchObject({
        code: 'CAPACITY_PLAN_NOT_FOUND',
      });
      expect(repo.delete).not.toHaveBeenCalled();
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
    it("refuses a team that is not linked to the plan's PROJECT", async () => {
      // The guard used to check the workspace only, and the consequence was live data: 11
      // `capacity_plan_teams` rows referenced teams with no link to their plan's project, including a
      // seeded team that contributed demand while being absent from the Add/Remove Teams picker — so
      // it could not be removed through the UI at all. The BA's source is "Project Breakdown".
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

    /** A plan_team row for `team-1`, which `requirePlanTeam` needs before any removal. */
    const onPlan = {
      id: 'pt-1',
      planId: 'plan-1',
      teamId: 'team-1',
      capacity: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const alloc = (over: Record<string, unknown> = {}) =>
      ({
        id: 'al-1',
        planId: 'plan-1',
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        isPrimary: false,
        value: '5',
        ...over,
      }) as never;

    it('RE-PARKS a removed team’s rows as unassigned instead of refusing', async () => {
      // AC-005: "removed Teams move their allocation rows back to Unallocated", and the flow catalog
      // adds "so the demand can be reassigned". This used to throw `CAPACITY_TEAM_HAS_ALLOCATIONS`,
      // which left a planner with no way forward — the demand could only be moved row by row, and a
      // team missing its project link had no row in the picker to move anything from.
      repo.findTeam.mockResolvedValue(onPlan);
      repo.listAllocationsForTeam.mockResolvedValue([alloc()]);
      repo.findAllocationFor.mockResolvedValue(null);

      await service.removeTeam(actor, 'plan-1', 'team-1');

      expect(repo.updateAllocation).toHaveBeenCalledWith(
        'al-1',
        { teamId: null, isPrimary: false },
        TX,
      );
      expect(repo.deleteAllocation).not.toHaveBeenCalled();
      // Same transaction as the re-parking: a plan that dropped the team but kept team-owned rows
      // would violate its own model.
      expect(repo.removeTeam).toHaveBeenCalledWith('plan-1', 'team-1', TX);
    });

    it('MERGES into a Feature that is already parked, because only one parked row may exist', async () => {
      // `uq_capacity_allocation_unassigned` allows one unassigned row per (plan, Feature), so a second
      // cannot simply be created. The values are summed: both were real demand.
      repo.findTeam.mockResolvedValue(onPlan);
      repo.listAllocationsForTeam.mockResolvedValue([alloc({ value: '5' })]);
      repo.findAllocationFor.mockResolvedValue(alloc({ id: 'parked-1', teamId: null, value: '3' }));

      await service.removeTeam(actor, 'plan-1', 'team-1');

      expect(repo.updateAllocation).toHaveBeenCalledWith('parked-1', { value: '8' }, TX);
      expect(repo.deleteAllocation).toHaveBeenCalledWith('al-1', TX);
    });

    it('hands the assignment to a surviving team when the OWNER is removed', async () => {
      // Otherwise the Feature keeps team rows with no primary — the state `removeAllocation` guards
      // against, reading "as unassigned while teams are demonstrably working on it".
      repo.findTeam.mockResolvedValue(onPlan);
      repo.listAllocationsForTeam.mockResolvedValue([alloc({ isPrimary: true })]);
      repo.findAllocationFor.mockResolvedValue(null);
      repo.oldestTeamAllocation.mockResolvedValue(alloc({ id: 'other-1', teamId: 'team-2' }));

      await service.removeTeam(actor, 'plan-1', 'team-1');
      expect(repo.updateAllocation).toHaveBeenCalledWith('other-1', { isPrimary: true }, TX);
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
      // Inside the re-parking transaction now, even with nothing to re-park: the team's removal and
      // whatever its rows became have to commit together.
      expect(repo.removeTeam).toHaveBeenCalledWith('plan-1', 'team-1', TX);
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
        itemProjectId: 'proj-a',
        itemProjectName: 'Project A',
        itemArchivedAt: null,
        itemReleaseId: null,
        state: 'developing',
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
      itemProjectId: 'proj-a',
      itemProjectName: 'Project A',
      itemArchivedAt: null,
      itemReleaseId: null,
      state: 'developing',
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
      itemProjectId: 'proj-a',
      itemProjectName: 'Project A',
      itemArchivedAt: null,
      itemReleaseId: null,
      state: 'developing',
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

    it('MOVES the unallocated row onto the team instead of adding beside it', async () => {
      // Rally: "choosing a Team assigns the existing unallocated row to that Team". Keeping both
      // would count the Feature twice — parked demand AND a team commitment — which is what
      // happened once adding and allocating became two steps.
      repo.findAllocationFor.mockImplementation(async (_plan, _item, teamId) =>
        teamId === null
          ? {
              id: 'parked-1',
              planId: 'plan-1',
              portfolioItemId: 'fe-1',
              teamId: null,
              isPrimary: false,
              value: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null,
      );
      repo.hasPrimaryAllocation.mockResolvedValue(false);

      await service.allocate(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: 7,
      });

      expect(repo.createAllocation).not.toHaveBeenCalled();
      expect(repo.updateAllocation).toHaveBeenCalledWith('parked-1', {
        teamId: 'team-1',
        value: '7',
        // The first team to receive the work owns it, exactly as a fresh allocation would.
        isPrimary: true,
      });
    });

    it('SETS an existing row for the same (Feature, team) pair rather than adding to it', async () => {
      // The BA: "Re-applying allocation replaces the Feature's Team allocation rows." Adding meant
      // applying the same dialog twice doubled committed demand, and a slice could never be corrected
      // downwards through this path. Rally asks for "the number to allocate for this team", not a
      // delta. Still one row per (Feature, team): a second would double-count in every total.
      // Per-argument, because `allocate` asks twice: first whether the Feature has an UNALLOCATED
      // row to move onto the team, then whether the team already holds one to add to.
      repo.findAllocationFor.mockImplementation(async (_plan, _item, teamId) =>
        teamId === null
          ? null
          : {
              id: 'al-1',
              planId: 'plan-1',
              portfolioItemId: 'fe-1',
              teamId: 'team-1',
              isPrimary: false,
              value: '10',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
      );

      await service.allocate(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        value: 5,
      });

      expect(repo.createAllocation).not.toHaveBeenCalled();
      // No tx here: setting an existing row is a single write with no primary-assignment bookkeeping
      // to keep atomic with it. `5`, not `15` — the number asked for, not the number plus what was
      // already there.
      expect(repo.updateAllocation).toHaveBeenCalledWith('al-1', { value: '5' });
    });

    it('leaves an existing slice ALONE when no value is supplied', async () => {
      // Clearing a slice is `updateAllocation` with an explicit null — a different request. A blank
      // here means "assign, do not re-state the number", so the committed slice survives.
      repo.findAllocationFor.mockImplementation(async (_plan, _item, teamId) =>
        teamId === null
          ? null
          : ({
              id: 'al-1',
              planId: 'plan-1',
              portfolioItemId: 'fe-1',
              teamId: 'team-1',
              isPrimary: false,
              value: '10',
            } as never),
      );

      await service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: 'team-1' });
      expect(repo.updateAllocation).not.toHaveBeenCalled();
    });

    it("KEEPS the parked row's value when a team is chosen without one", async () => {
      // The BA: "If an existing Unassigned allocation already has a value, keep that value." This used
      // to write null over it, so choosing a team from the assignment cell silently discarded a number
      // the planner had entered while the Feature was parked.
      repo.findAllocationFor.mockImplementation(async (_plan, _item, teamId) =>
        teamId === null
          ? ({
              id: 'parked-1',
              planId: 'plan-1',
              portfolioItemId: 'fe-1',
              teamId: null,
              isPrimary: false,
              value: '8',
            } as never)
          : null,
      );

      await service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: 'team-1' });
      expect(repo.updateAllocation).toHaveBeenCalledWith('parked-1', {
        teamId: 'team-1',
        isPrimary: true,
      });
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
      ).rejects.toMatchObject({ code: 'CAPACITY_ALLOCATION_WRONG_PROJECT' });
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

  describe("a blank Estimate ASSIGNS without allocating (Rally's primary assignment)", () => {
    /** One allocation row, with the tier inputs each test varies. */
    const row = (over: Partial<CapacityAllocationRow> = {}): CapacityAllocationRow => ({
      id: 'alloc-1',
      planId: 'plan-1',
      portfolioItemId: 'fe-1',
      teamId: 'team-1',
      isPrimary: true,
      value: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      itemKey: 'FE-1',
      name: 'A feature',
      refined: null,
      preliminarySize: 'm',
      totalAllocated: 0,
      rollup: 0,
      complete: 0,
      rank: 'm',
      itemRollup: 0,
      itemComplete: 0,
      itemProjectId: 'proj-a',
      itemProjectName: 'Project A',
      itemArchivedAt: null,
      itemReleaseId: null,
      state: 'developing',
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
      repo.findViewById.mockResolvedValue(
        view({
          teams: [
            {
              id: 'pt-1',
              planId: 'plan-1',
              teamId: 'team-1',
              teamName: 'Alpha',
              capacity: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }),
      );
    });

    it('stores NULL, not a copy of the Feature estimate', async () => {
      // Rally assigns an item to one team and allocates points to the additional ones. The
      // assignment carries no number: the plan charges the Feature's own estimate there. Writing
      // that estimate into the row — which this used to do — froze a copy, so a later change to
      // the Feature stopped moving the plan and the Allocation column could never render blank.
      portfolio.getItem.mockResolvedValue({
        id: 'fe-1',
        type: 'feature',
        projectId: 'proj-a',
        refinedEstimate: '30',
        preliminaryEstimate: 'm',
        archivedAt: null,
        state: 'developing',
        releaseId: null,
      } as never);

      await service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: 'team-1' });

      expect(repo.createAllocation).toHaveBeenCalledWith(expect.objectContaining({ value: null }));
    });

    it('charges the REFINED estimate on read for a null row', async () => {
      repo.listAllocations.mockResolvedValue([
        row({ value: null, refined: 30, preliminarySize: 'm' }),
      ]);

      const detail = await service.getPlanDetail(actor, 'plan-1');

      expect(detail.allocations[0].value).toBeNull();
      expect(detail.allocations[0].metrics.estimated).toBe(30);
      expect(detail.allocations[0].tier).toBe('refined');
    });

    it('falls back to the PRELIMINARY mapping when there is no refined estimate', async () => {
      repo.listAllocations.mockResolvedValue([
        row({ value: null, refined: null, preliminarySize: 'm' }),
      ]);

      const detail = await service.getPlanDetail(actor, 'plan-1');

      // 'm' maps to 5 points in the seeded default.
      expect(detail.allocations[0].metrics.estimated).toBe(5);
      expect(detail.allocations[0].tier).toBe('preliminary');
    });

    it('NEVER charges a null row with what OTHER teams were allocated', async () => {
      // `totalAllocated` is the SUM over this Feature's team rows. Folding it into a null row would
      // bill one team for the slices the others were given — the circularity that made the old
      // default skip the allocated tier, now expressed on the read side.
      repo.listAllocations.mockResolvedValue([
        row({ value: null, refined: null, preliminarySize: 'm', totalAllocated: 999 }),
      ]);

      const detail = await service.getPlanDetail(actor, 'plan-1');

      expect(detail.allocations[0].metrics.estimated).toBe(5);
    });

    it('an EXPLICIT value wins and reads as the allocated tier', async () => {
      repo.listAllocations.mockResolvedValue([
        row({ value: '12', refined: 30, preliminarySize: 'm' }),
      ]);

      const detail = await service.getPlanDetail(actor, 'plan-1');

      expect(detail.allocations[0].value).toBe('12');
      expect(detail.allocations[0].metrics.estimated).toBe(12);
      expect(detail.allocations[0].tier).toBe('allocated');
    });

    it("sums a team's RESOLVED charges, so a null row still costs the team", async () => {
      // Two Features on one team: one assigned (null → estimate 30), one sliced at 12. The team is
      // charged 42, and a grid that read the raw column would have shown 12.
      repo.listAllocations.mockResolvedValue([
        row({ portfolioItemId: 'fe-1', value: null, refined: 30, preliminarySize: 'm' }),
        row({ portfolioItemId: 'fe-2', value: '12', refined: null, preliminarySize: 'm' }),
      ]);

      const detail = await service.getPlanDetail(actor, 'plan-1');

      expect(detail.teams[0].metrics.estimated).toBe(42);
      expect(detail.items.map((i) => i.estimated)).toEqual([30, 12]);
    });

    it.each([
      ['ARCHIVED', { archivedAt: new Date() }, 'CAPACITY_ALLOCATION_ARCHIVED'],
      ['CANCELLED', { state: 'cancelled' }, 'CAPACITY_ALLOCATION_CANCELLED'],
      ['in another RELEASE', { releaseId: 'rel-other' }, 'CAPACITY_ALLOCATION_OTHER_RELEASE'],
    ])('refuses a Feature that is %s', async (_label, over, code) => {
      // The BA flow's eligibility rules (§4.4). The picker hides all three, but a picker is not a
      // rule — a stale tab or a scripted client reaches the API directly.
      portfolio.getItem.mockResolvedValue({
        id: 'fe-1',
        type: 'feature',
        projectId: 'proj-a',
        refinedEstimate: null,
        preliminaryEstimate: 'm',
        archivedAt: null,
        state: 'developing',
        releaseId: null,
        ...over,
      } as never);

      await expect(
        service.allocate(actor, 'plan-1', { portfolioItemId: 'fe-1', teamId: 'team-1' }),
      ).rejects.toMatchObject({ code });
      expect(repo.createAllocation).not.toHaveBeenCalled();
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

  describe('moveItemToPlan', () => {
    const alloc = (over: Partial<CapacityAllocation> = {}): CapacityAllocation => ({
      id: 'alloc-1',
      planId: 'plan-1',
      portfolioItemId: 'fe-1',
      teamId: 'team-a',
      value: '8',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });

    /** Source is plan-1 (draft); target is plan-2, same project, same release unless overridden. */
    function arrange(opts: {
      rows?: CapacityAllocation[];
      onTarget?: CapacityAllocation[];
      target?: Partial<CapacityPlan>;
      teamOnTarget?: boolean;
    }) {
      const target = plan({ id: 'plan-2', planKey: 'CP-2', ...opts.target });
      repo.findById.mockImplementation((id: string) =>
        Promise.resolve(id === 'plan-2' ? target : plan()),
      );
      repo.listAllocationsForItem.mockImplementation((planId: string) =>
        Promise.resolve(planId === 'plan-2' ? (opts.onTarget ?? []) : (opts.rows ?? [alloc()])),
      );
      repo.findTeam.mockResolvedValue(
        (opts.teamOnTarget ?? true) ? ({ planId: 'plan-2', teamId: 'team-a' } as never) : null,
      );
      return target;
    }

    it('recreates the row on the target against the SAME team, then deletes the source row', async () => {
      // A move is not a re-plan: the team, its allocated value and the primary flag are what the
      // planner already decided, so they travel with the Feature.
      arrange({});
      const result = await service.moveItemToPlan(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        targetPlanId: 'plan-2',
        updateRelease: false,
        republish: false,
      });

      expect(repo.createAllocation).toHaveBeenCalledWith(
        {
          planId: 'plan-2',
          portfolioItemId: 'fe-1',
          teamId: 'team-a',
          value: '8',
          isPrimary: true,
        },
        TX,
      );
      expect(repo.deleteAllocation).toHaveBeenCalledWith('alloc-1', TX);
      expect(result.carried).toBe(1);
      expect(result.parked).toBe(0);
      expect(result.targetPlanKey).toBe('CP-2');
    });

    it('parks demand whose team is not on the target, in ONE unassigned row', async () => {
      // The Feature is still planned for that release — it just has no team on this plan yet.
      // Deleting the rows would make a move look like a removal, and one row per lost team would
      // read as several commitments the target cannot tell apart.
      arrange({
        rows: [alloc(), alloc({ id: 'alloc-2', teamId: 'team-b', value: '5', isPrimary: false })],
        teamOnTarget: false,
      });
      const result = await service.moveItemToPlan(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        targetPlanId: 'plan-2',
        updateRelease: false,
        republish: false,
      });

      expect(result.carried).toBe(0);
      expect(result.parked).toBe(1);
      expect(repo.createAllocation).toHaveBeenCalledTimes(1);
      expect(repo.createAllocation).toHaveBeenCalledWith(
        { planId: 'plan-2', portfolioItemId: 'fe-1', teamId: null, value: null },
        TX,
      );
      expect(repo.deleteAllocation).toHaveBeenCalledTimes(2);
    });

    it('refuses a move between releases unless the Release is updated with it', async () => {
      // Rally's checkbox exists for exactly this: a Feature committed to another release cannot be
      // planned here (`CAPACITY_ALLOCATION_OTHER_RELEASE`), so the move either says so or moves the
      // Feature's Release deliberately.
      arrange({ target: { releaseId: 'rel-2' } });
      portfolio.getItem.mockResolvedValue({
        id: 'fe-1',
        type: 'feature',
        projectId: 'proj-a',
        archivedAt: null,
        state: 'developing',
        releaseId: 'rel-1',
      } as never);

      await expect(
        service.moveItemToPlan(actor, 'plan-1', {
          portfolioItemId: 'fe-1',
          targetPlanId: 'plan-2',
          updateRelease: false,
          republish: false,
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_MOVE_RELEASE_MISMATCH' });
      expect(repo.createAllocation).not.toHaveBeenCalled();
    });

    it("writes the Feature's Release when asked, in the move's own transaction", async () => {
      arrange({ target: { releaseId: 'rel-2' } });
      portfolio.getItem.mockResolvedValue({
        id: 'fe-1',
        type: 'feature',
        projectId: 'proj-a',
        archivedAt: null,
        state: 'developing',
        releaseId: 'rel-1',
      } as never);

      const result = await service.moveItemToPlan(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        targetPlanId: 'plan-2',
        updateRelease: true,
        republish: false,
      });

      expect(repo.setFeatureRelease).toHaveBeenCalledWith('fe-1', WORKSPACE, 'rel-2', TX);
      expect(result.releaseUpdated).toBe(true);
    });

    it('unpublishes a published target, because the move changes what it published', async () => {
      arrange({ target: { status: 'published', publishedAt: new Date() } });
      const result = await service.moveItemToPlan(actor, 'plan-1', {
        portfolioItemId: 'fe-1',
        targetPlanId: 'plan-2',
        updateRelease: false,
        republish: false,
      });

      expect(repo.setStatus).toHaveBeenCalledWith('plan-2', WORKSPACE, 'draft', null, TX);
      expect(result.targetUnpublished).toBe(true);
      expect(result.targetRepublished).toBe(false);
    });

    it('refuses a target that already holds the Feature — Rally offers Remove Only instead', async () => {
      arrange({ onTarget: [alloc({ id: 'alloc-x', planId: 'plan-2' })] });
      await expect(
        service.moveItemToPlan(actor, 'plan-1', {
          portfolioItemId: 'fe-1',
          targetPlanId: 'plan-2',
          updateRelease: false,
          republish: false,
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_MOVE_ALREADY_ON_TARGET' });
    });

    it('refuses a target in another project, and the plan it cannot find', async () => {
      // Cross-project would create a row the next write refuses: an allocation is only valid when
      // the Feature belongs to the plan's project.
      arrange({ target: { projectId: 'proj-b' } });
      await expect(
        service.moveItemToPlan(actor, 'plan-1', {
          portfolioItemId: 'fe-1',
          targetPlanId: 'plan-2',
          updateRelease: false,
          republish: false,
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_MOVE_OTHER_PROJECT' });

      repo.findById.mockImplementation((id: string) =>
        Promise.resolve(id === 'plan-2' ? null : plan()),
      );
      await expect(
        service.moveItemToPlan(actor, 'plan-1', {
          portfolioItemId: 'fe-1',
          targetPlanId: 'plan-2',
          updateRelease: false,
          republish: false,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses moving a Feature onto the plan it is already on', async () => {
      arrange({});
      await expect(
        service.moveItemToPlan(actor, 'plan-1', {
          portfolioItemId: 'fe-1',
          targetPlanId: 'plan-1',
          updateRelease: false,
          republish: false,
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_MOVE_SAME_PLAN' });
    });

    it('refuses a Feature that is not on this plan at all', async () => {
      arrange({ rows: [] });
      await expect(
        service.moveItemToPlan(actor, 'plan-1', {
          portfolioItemId: 'fe-1',
          targetPlanId: 'plan-2',
          updateRelease: false,
          republish: false,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('asks for capacity:publish BEFORE moving anything when republishing', async () => {
      // Otherwise a reader without publish rights relocates the rows and then fails, leaving the
      // move done and the target a draft they did not intend.
      arrange({ target: { status: 'published', publishedAt: new Date() } });
      access.assertProjectPermission.mockImplementation((_a, _p, code: string) =>
        code === 'capacity:publish' ? Promise.reject(new Error('denied')) : Promise.resolve(),
      );

      await expect(
        service.moveItemToPlan(actor, 'plan-1', {
          portfolioItemId: 'fe-1',
          targetPlanId: 'plan-2',
          updateRelease: false,
          republish: true,
        }),
      ).rejects.toThrow('denied');
      expect(repo.createAllocation).not.toHaveBeenCalled();
      expect(repo.deleteAllocation).not.toHaveBeenCalled();
    });
  });

  describe('draft visibility (AC-013)', () => {
    /** A reader: `capacity:view` only, so neither write grant marks them a planner. */
    const asReader = () => access.hasProjectPermission.mockResolvedValue(false);

    it('hides DRAFT plans from the list for a reader', async () => {
      repo.listByProject.mockResolvedValue([
        view({ id: 'p-draft', status: 'draft' }),
        view({ id: 'p-pub', status: 'published' }),
      ]);
      asReader();

      const plans = await service.listPlans(actor, 'proj-a');
      expect(plans.map((p) => p.id)).toEqual(['p-pub']);
    });

    it('shows a planner everything, drafts included', async () => {
      repo.listByProject.mockResolvedValue([
        view({ id: 'p-draft', status: 'draft' }),
        view({ id: 'p-pub', status: 'published' }),
      ]);
      const plans = await service.listPlans(actor, 'proj-a');
      expect(plans).toHaveLength(2);
    });

    it('answers NOT FOUND — not 403 — when a reader opens a draft', async () => {
      // 403 would confirm the plan exists, which is what hiding it is meant to avoid. The BA's wording
      // is about visibility ("cannot be opened"), not about a refused action.
      repo.findViewById.mockResolvedValue(view({ status: 'draft' }));
      asReader();

      await expect(service.getPlan(actor, 'plan-1')).rejects.toMatchObject({
        code: 'CAPACITY_PLAN_NOT_FOUND',
      });
    });

    it('lets a reader open a PUBLISHED plan', async () => {
      repo.findViewById.mockResolvedValue(view({ status: 'published' }));
      asReader();
      await expect(service.getPlan(actor, 'plan-1')).resolves.toMatchObject({ id: 'plan-1' });
    });

    it("narrows a reader's TEAM rows to the teams they belong to (AC-010)", async () => {
      // The stubbed Drizzle resolves `select().from().where()` to `lookupRows`, which is what the
      // membership query reads — so one team is "mine" and the other is not.
      lookupRows = [{ teamId: 'team-1' }];
      repo.findViewById.mockResolvedValue(
        view({
          status: 'published',
          teams: [
            { id: 'pt-1', teamId: 'team-1', teamName: 'Mine', capacity: null },
            { id: 'pt-2', teamId: 'team-2', teamName: 'Theirs', capacity: null },
          ] as never,
        }),
      );
      asReader();

      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.teams.map((t) => t.teamId)).toEqual(['team-1']);
    });

    it("does NOT hide the plan's own totals, items or cutline from a reader", async () => {
      // Their team's numbers would be unreadable without them — "18 of what?" — and the header, bar and
      // cutline describe a whole a plan member is entitled to understand. The BA's rule is about whose
      // ROWS a reader may open.
      lookupRows = [{ teamId: 'team-1' }];
      repo.findViewById.mockResolvedValue(view({ status: 'published' }));
      const slice = (id: string, teamId: string, value: string, isPrimary: boolean) =>
        ({
          id,
          planId: 'plan-1',
          portfolioItemId: 'fe-1',
          teamId,
          isPrimary,
          value,
          itemKey: 'FE-1',
          name: 'Guest checkout',
          refined: null,
          preliminarySize: 'no_entry',
          totalAllocated: 12,
          rollup: 0,
          complete: 0,
          rank: 'a',
          state: 'developing',
          itemRollup: 0,
          itemComplete: 0,
          itemProjectId: 'proj-a',
          itemProjectName: 'Project A',
          itemArchivedAt: null,
          itemReleaseId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as never;
      repo.listAllocations.mockResolvedValue([
        slice('mine', 'team-1', '5', true),
        slice('theirs', 'team-2', '7', false),
      ]);
      asReader();

      const detail = await service.getPlanDetail(actor, 'plan-1');
      // One Feature, both teams' slices summed: the item is a plan-level fact.
      expect(detail.items).toHaveLength(1);
      expect(detail.items[0].estimated).toBe(12);
      // …but only their own allocation row came back.
      expect(detail.allocations.map((a) => a.teamId)).toEqual(['team-1']);
    });

    it('shows a planner every team', async () => {
      lookupRows = [];
      repo.findViewById.mockResolvedValue(
        view({
          status: 'published',
          teams: [
            { id: 'pt-1', teamId: 'team-1', teamName: 'A', capacity: null },
            { id: 'pt-2', teamId: 'team-2', teamName: 'B', capacity: null },
          ] as never,
        }),
      );
      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.teams).toHaveLength(2);
    });

    it('counts `capacity:publish` alone as a planner', async () => {
      // Our three codes where the BA has one: publish-without-manage is a state its model cannot
      // express, and someone trusted to publish a plan is certainly meant to see it first.
      repo.findViewById.mockResolvedValue(view({ status: 'draft' }));
      access.hasProjectPermission.mockImplementation((_a, _p, code: string) =>
        Promise.resolve(code === 'capacity:publish'),
      );
      await expect(service.getPlan(actor, 'plan-1')).resolves.toMatchObject({ id: 'plan-1' });
    });
  });

  describe('removeItemFromPlan', () => {
    it('removes EVERY row for a Feature in ONE transaction', async () => {
      // The client used to loop a DELETE per allocation, so a split Feature meant one request per team
      // and a failure midway left it half-removed: still on the plan, still counted, minus the teams
      // the earlier calls had already dropped. There was no request that said "remove this Feature".
      repo.listAllocationsForItem.mockResolvedValue([
        { id: 'al-1', planId: 'plan-1', portfolioItemId: 'fe-1', teamId: 'team-1' },
        { id: 'al-2', planId: 'plan-1', portfolioItemId: 'fe-1', teamId: 'team-2' },
        { id: 'al-3', planId: 'plan-1', portfolioItemId: 'fe-1', teamId: null },
      ] as never);

      await service.removeItemFromPlan(actor, 'plan-1', 'fe-1');

      expect(repo.deleteAllocation).toHaveBeenCalledTimes(3);
      for (const id of ['al-1', 'al-2', 'al-3']) {
        expect(repo.deleteAllocation).toHaveBeenCalledWith(id, TX);
      }
      // No primary promotion: every row is going, so nothing is left to own the Feature.
      expect(repo.updateAllocation).not.toHaveBeenCalled();
    });

    it('reports a Feature that is not on the plan rather than succeeding silently', async () => {
      repo.listAllocationsForItem.mockResolvedValue([]);
      await expect(service.removeItemFromPlan(actor, 'plan-1', 'fe-9')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.deleteAllocation).not.toHaveBeenCalled();
    });

    it('refuses on a PUBLISHED plan, like every other write', async () => {
      repo.findById.mockResolvedValue(plan({ status: 'published' }));
      await expect(service.removeItemFromPlan(actor, 'plan-1', 'fe-1')).rejects.toMatchObject({
        code: 'CAPACITY_PLAN_NOT_DRAFT',
      });
      expect(repo.deleteAllocation).not.toHaveBeenCalled();
    });
  });

  describe('data-integrity rules', () => {
    const row = (over: Partial<CapacityAllocationRow> = {}): CapacityAllocationRow => ({
      id: 'alloc-1',
      planId: 'plan-1',
      portfolioItemId: 'fe-1',
      teamId: 'team-1',
      isPrimary: true,
      value: '3',
      itemKey: 'FE-1',
      name: 'Guest checkout',
      refined: 13,
      preliminarySize: 'm',
      totalAllocated: 3,
      rollup: 0,
      complete: 0,
      rank: 'a',
      state: 'developing',
      itemRollup: 0,
      itemComplete: 0,
      itemProjectId: 'proj-a',
      itemProjectName: 'Project A',
      itemArchivedAt: null,
      itemReleaseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });

    it('does NOT let an unallocated placeholder inflate a Feature’s Estimated', async () => {
      // AC-014 / §11: "Unallocated rows do not count toward Total Allocated." The live breach was
      // `CP-8`/`FE-640729683` — a 3-point team commitment beside a 5-point parked row reporting 8,
      // which then fed the cutline while the plan header (team rows only) reported 3.
      repo.listAllocations.mockResolvedValue([
        row({ id: 'a-team', teamId: 'team-1', value: '3', isPrimary: true }),
        row({ id: 'a-parked', teamId: null, value: '5', isPrimary: false }),
      ]);
      const detail = await service.getPlanDetail(actor, 'plan-1');
      const item = detail.items.find((i) => i.portfolioItemId === 'fe-1');
      expect(item?.estimated).toBe(3);
      expect(item?.unallocated).toBe(true);
    });

    it('still charges a Feature that has ONLY a parked row', async () => {
      // Skipping the placeholder must not make "planned but not yet assigned" read as zero: with no
      // team row there is nothing else to report, so the Feature's own estimate stands.
      repo.listAllocations.mockResolvedValue([
        row({ id: 'a-parked', teamId: null, value: null, isPrimary: false }),
      ]);
      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.items[0]?.estimated).toBe(13);
    });

    it('reports a taken (plan, item, team) slot as a CONFLICT, not a 500', async () => {
      // `uq_capacity_allocation_team` allows one row per team per Feature. This used to reach Postgres
      // and surface as INTERNAL_ERROR — an ordinary planner mistake reported as a server fault.
      repo.findAllocation.mockResolvedValue({
        id: 'alloc-1',
        planId: 'plan-1',
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        isPrimary: false,
        value: '3',
      } as never);
      repo.findTeam.mockResolvedValue({ planId: 'plan-1', teamId: 'team-2' } as never);
      repo.findAllocationFor.mockResolvedValue({ id: 'other' } as never);

      await expect(
        service.updateAllocation(actor, 'plan-1', 'alloc-1', { teamId: 'team-2' }),
      ).rejects.toMatchObject({ code: 'CAPACITY_ALLOCATION_TEAM_TAKEN' });
      expect(repo.updateAllocation).not.toHaveBeenCalled();
    });

    it('names the parked slot separately when one is already there', async () => {
      repo.findAllocation.mockResolvedValue({
        id: 'alloc-1',
        planId: 'plan-1',
        portfolioItemId: 'fe-1',
        teamId: 'team-1',
        isPrimary: false,
        value: '3',
      } as never);
      repo.findAllocationFor.mockResolvedValue({ id: 'parked' } as never);

      await expect(
        service.updateAllocation(actor, 'plan-1', 'alloc-1', { teamId: null }),
      ).rejects.toMatchObject({ code: 'CAPACITY_ALLOCATION_ALREADY_UNASSIGNED' });
    });

    it('charges an ARCHIVED Feature nothing, while still returning its row', async () => {
      // The BA: an archived item "is not actionable planning demand". Its children were still feeding
      // the team's Rollup and Complete, so a team's load, its warnings and the cutline all moved on
      // work nobody plans to do. The row stays visible — it is the only way to see and remove the
      // stale commitment.
      repo.listAllocations.mockResolvedValue([
        row({ teamId: 'team-1', value: '5', rollup: 21, complete: 8, itemArchivedAt: new Date() }),
      ]);
      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.allocations).toHaveLength(1);
      expect(detail.allocations[0].archived).toBe(true);
      expect(detail.allocations[0].metrics).toMatchObject({ estimated: 0, rollup: 0, complete: 0 });
      expect(detail.items[0]?.estimated).toBe(0);
    });

    it('reports the BA’s two Feature-level warnings on the item row', async () => {
      // The Features tab could not show these at all before: `plan.items[]` carried no warnings, no
      // metrics and no breakdown, so the triangles the BA specifies had nothing to render from. The
      // rules come from the SAME function the team grid uses — a second implementation in the client
      // would be free to disagree with the number printed beside it.
      repo.listAllocations.mockResolvedValue([
        row({ teamId: 'team-1', value: '2', rollup: 11, itemRollup: 11 }),
      ]);
      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.items[0]?.warnings).toContain('rollup_exceeds_estimated');
    });

    it('warns that a Feature has NO estimate at all, and says so ahead of the comparison', async () => {
      // `tier: 'none'` is the CAUSE — a zero estimate is why the rollup exceeds it — so the rule
      // function reports it first and the row can point the planner at the right column.
      repo.listAllocations.mockResolvedValue([
        // `no_entry` is the unsized state and maps to 0, which falls through the tier chain to nothing
        // — the only 0 in the map, and the reason an unsized Feature reads as "no estimate" not "zero".
        row({ teamId: 'team-1', value: null, refined: null, preliminarySize: 'no_entry', rollup: 4 }),
      ]);
      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.items[0]?.warnings[0]).toBe('feature_missing_estimate');
    });

    it('sums the ALLOCATED breakdown across a split Feature, ignoring a parked row', async () => {
      // The breakdown drives the estimate-source tooltip. `allocated` is the item-level equivalent of
      // one row's explicit value, so it sums the team rows — and a placeholder contributes nothing
      // here for the same reason it contributes nothing to Estimated (AC-014).
      repo.listAllocations.mockResolvedValue([
        row({ id: 'a', teamId: 'team-1', value: '3' }),
        row({ id: 'b', teamId: 'team-2', value: '5', isPrimary: false }),
        row({ id: 'c', teamId: null, value: '9', isPrimary: false }),
      ]);
      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.items[0]?.estimateBreakdown).toMatchObject({ allocated: 8, refined: 13 });
    });

    it('leaves an archived Feature with no warnings, because it is not demand', async () => {
      repo.listAllocations.mockResolvedValue([
        row({ teamId: 'team-1', value: '2', rollup: 11, itemArchivedAt: new Date() }),
      ]);
      const detail = await service.getPlanDetail(actor, 'plan-1');
      expect(detail.items[0]?.warnings).toEqual([]);
    });

    it('reports an archived Feature as SKIPPED on publish rather than counting it', async () => {
      // The write filters `archivedAt`, so it matches nothing; publish used to increment anyway and a
      // planner reading "2 Features updated" had no way to find the one that was not.
      repo.listAllocations.mockResolvedValue([row({ teamId: 'team-1' })]);
      repo.applyPlanToFeature.mockResolvedValue(false);

      const result = await service.publishPlan(actor, 'plan-1', { updateFields: true });
      expect(result.featuresUpdated).toBe(0);
      expect(result.skipped).toEqual([
        { portfolioItemId: 'fe-1', itemKey: 'FE-1', reason: 'archived' },
      ]);
    });
  });
});
