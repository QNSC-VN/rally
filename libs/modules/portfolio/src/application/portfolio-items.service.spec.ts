import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE, NotFoundException } from '@platform';
import type { JwtPayload } from '@platform';
import { AccessService } from '@modules/access';
import { PortfolioItemsService } from './portfolio-items.service';
import {
  PORTFOLIO_ITEM_REPOSITORY,
  type IPortfolioItemRepository,
} from '../domain/ports/portfolio-item.repository';
import type { PortfolioItemView } from '../domain/portfolio-item.types';

const WORKSPACE = 'ws-1';
const actor = { sub: 'user-1', workspaceId: WORKSPACE } as JwtPayload;

const view = (over: Partial<PortfolioItemView> = {}): PortfolioItemView => ({
  id: 'pi-1',
  workspaceId: WORKSPACE,
  projectId: 'proj-a',
  itemKey: 'FE-1',
  type: 'feature',
  name: 'A feature',
  description: null,
  state: 'developing',
  preliminaryEstimate: 'm',
  refinedEstimate: null,
  refinedItemCountEstimate: null,
  parentId: null,
  teamId: null,
  releaseId: null,
  ownerId: null,
  plannedStartDate: null,
  plannedEndDate: null,
  marketReleaseDate: null,
  rank: 'a',
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ownerName: null,
  teamName: null,
  releaseName: null,
  projectName: null,
  parentKey: null,
  childFeatureCount: 0,
  rollup: {
    portfolioItemId: 'pi-1',
    rollupPoints: 40,
    rollupCount: 2,
    acceptedPoints: 10,
    acceptedCount: 1,
    completedPoints: 10,
    completedCount: 1,
  },
  ...over,
});

const emptyPage = <T>(data: T[]) => ({
  data,
  pageInfo: { nextCursor: null, hasNextPage: false, limit: 50 },
});

describe('PortfolioItemsService', () => {
  let service: PortfolioItemsService;
  let repo: Mocked<IPortfolioItemRepository>;
  let access: Mocked<AccessService>;
  let settingsRows: Array<{ map: unknown }>;

  beforeEach(async () => {
    settingsRows = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioItemsService,
        {
          provide: PORTFOLIO_ITEM_REPOSITORY,
          useValue: {
            findById: vi.fn(),
            findViewById: vi.fn(),
            listByFilter: vi.fn().mockResolvedValue(emptyPage([])),
            rollupsFor: vi.fn().mockResolvedValue([]),
            listChildren: vi.fn().mockResolvedValue(emptyPage([])),
            listChildFeatures: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AccessService,
          // Default: unrestricted, so tests that are not about authorization stay short.
          useValue: { listReadableProjectIds: vi.fn().mockResolvedValue(null) },
        },
        {
          provide: DRIZZLE,
          useValue: {
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve(settingsRows) }) }),
            }),
          },
        },
      ],
    }).compile();

    service = module.get(PortfolioItemsService);
    repo = module.get(PORTFOLIO_ITEM_REPOSITORY);
    access = module.get(AccessService);
  });

  describe('listItems — the authorization filter', () => {
    it('passes null through as unrestricted for a workspace-wide grant', async () => {
      await service.listItems(actor, { type: 'feature' }, { limit: 50, cursor: null });
      expect(repo.listByFilter).toHaveBeenCalledWith(
        WORKSPACE,
        expect.objectContaining({ readableProjectIds: null }),
        expect.anything(),
      );
    });

    it('passes the readable project ids down to the repository', async () => {
      access.listReadableProjectIds.mockResolvedValue(['proj-a', 'proj-b']);
      await service.listItems(actor, { type: 'feature' }, { limit: 50, cursor: null });
      expect(repo.listByFilter).toHaveBeenCalledWith(
        WORKSPACE,
        expect.objectContaining({ readableProjectIds: ['proj-a', 'proj-b'] }),
        expect.anything(),
      );
    });

    it('FAILS CLOSED with an empty page when no project is readable', async () => {
      // The case that must never reach SQL as "no filter". Returning everything here
      // would leak every project to a user with no project access at all.
      access.listReadableProjectIds.mockResolvedValue([]);

      const page = await service.listItems(actor, { type: 'feature' }, { limit: 50, cursor: null });

      expect(page.data).toEqual([]);
      expect(repo.listByFilter).not.toHaveBeenCalled();
      // Reports a real zero rather than omitting the count: the grid footer always shows
      // "of N" on this endpoint, and a missing total renders differently from 0.
      expect(page.pageInfo.total).toBe(0);
    });

    it('rejects an explicit projectId the caller cannot read', async () => {
      access.listReadableProjectIds.mockResolvedValue(['proj-a']);
      await expect(
        service.listItems(
          actor,
          { type: 'feature', projectId: 'proj-secret' },
          { limit: 50, cursor: null },
        ),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });
      expect(repo.listByFilter).not.toHaveBeenCalled();
    });

    it('allows an explicit projectId the caller can read', async () => {
      access.listReadableProjectIds.mockResolvedValue(['proj-a']);
      await service.listItems(
        actor,
        { type: 'feature', projectId: 'proj-a' },
        { limit: 50, cursor: null },
      );
      expect(repo.listByFilter).toHaveBeenCalled();
    });

    it('does not gate an explicit projectId when the grant is workspace-wide', async () => {
      // readable === null means every project, so any projectId is permitted.
      await service.listItems(
        actor,
        { type: 'feature', projectId: 'proj-anything' },
        { limit: 50, cursor: null },
      );
      expect(repo.listByFilter).toHaveBeenCalled();
    });

    it('returns an explicit empty page for Epic + a specific Team, without querying', async () => {
      // An Epic has no Team, so the combination can never match. The spec shows a
      // "Filter not show item" message rather than an empty grid, so the API must return
      // empty instead of silently ignoring the team filter and listing every Epic.
      const page = await service.listItems(
        actor,
        { type: 'epic', teamId: 'team-1' },
        { limit: 50, cursor: null },
      );
      expect(page.data).toEqual([]);
      expect(repo.listByFilter).not.toHaveBeenCalled();
      expect(access.listReadableProjectIds).not.toHaveBeenCalled();
      expect(page.pageInfo.total).toBe(0);
    });
  });

  describe('progress', () => {
    it('computes the four indicators from the rollup', async () => {
      repo.listByFilter.mockResolvedValue(emptyPage([view()]));

      const page = await service.listItems(actor, { type: 'feature' }, { limit: 50, cursor: null });
      const p = page.data[0].progress;

      expect(p.percentDoneByPlanEstimate).toBe(0.25); // 10 / 40
      expect(p.percentDoneByCount).toBe(0.5); // 1 / 2
      // Preliminary 'm' → 5 points / 3 count from the seeded default map.
      expect(p.estimatedProgressByPoints).toBe(2); // 10 / 5
      expect(p.estimatedProgressByCount).toBeCloseTo(1 / 3);
    });

    it('prefers a refined estimate over the preliminary mapping', async () => {
      repo.listByFilter.mockResolvedValue(
        emptyPage([view({ refinedEstimate: '20', refinedItemCountEstimate: 4 })]),
      );
      const p = (await service.listItems(actor, { type: 'feature' }, { limit: 50, cursor: null }))
        .data[0].progress;
      expect(p.estimatedProgressByPoints).toBe(0.5); // 10 / 20
      expect(p.estimatedProgressByCount).toBe(0.25); // 1 / 4
    });

    it('uses a workspace-configured mapping when present', async () => {
      // The whole reason the map is settings-backed: an operator changing XS/S/M must
      // change what Estimated Progress means, without a deploy.
      settingsRows = [{ map: { m: { points: 100, count: 50 } } }];
      repo.listByFilter.mockResolvedValue(emptyPage([view()]));

      const p = (await service.listItems(actor, { type: 'feature' }, { limit: 50, cursor: null }))
        .data[0].progress;
      expect(p.estimatedProgressByPoints).toBe(0.1); // 10 / 100
    });

    it('falls back to the seeded default when settings hold an empty object', async () => {
      // A workspace created before migration 0071. Returning an empty map would make
      // every Estimated Progress indicator null and read as a product bug.
      settingsRows = [{ map: {} }];
      repo.listByFilter.mockResolvedValue(emptyPage([view()]));

      const p = (await service.listItems(actor, { type: 'feature' }, { limit: 50, cursor: null }))
        .data[0].progress;
      expect(p.estimatedProgressByPoints).toBe(2); // 10 / 5, the default for 'm'
    });
  });

  describe('single-item reads', () => {
    it('throws NotFound for an unknown id', async () => {
      repo.findViewById.mockResolvedValue(null);
      await expect(service.getItem(actor, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('checks existence before listing children, so a bad id is not an empty list', async () => {
      // An empty list would read as "this Feature has no children" rather than "no such
      // Feature", which is the difference between a data question and a bug report.
      repo.findById.mockResolvedValue(null);
      await expect(
        service.listChildren(actor, 'missing', { limit: 50, cursor: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.listChildren).not.toHaveBeenCalled();
    });

    it('checks existence before listing child features', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.listChildFeatures(actor, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.listChildFeatures).not.toHaveBeenCalled();
    });
  });
});
