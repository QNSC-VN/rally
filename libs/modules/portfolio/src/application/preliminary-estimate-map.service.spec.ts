import { beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE } from '@platform';
import { PreliminaryEstimateMapService } from './preliminary-estimate-map.service';
import { DEFAULT_PRELIMINARY_ESTIMATE_MAP } from '../../../../../db/schema/enums';

describe('PreliminaryEstimateMapService', () => {
  let service: PreliminaryEstimateMapService;
  /** project_settings rows the stubbed Drizzle returns. */
  let rows: unknown[];

  beforeEach(async () => {
    rows = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreliminaryEstimateMapService,
        {
          provide: DRIZZLE,
          useValue: {
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
            }),
          },
        },
      ],
    }).compile();
    service = module.get(PreliminaryEstimateMapService);
  });

  it('returns the default map when no project_settings row exists', async () => {
    rows = [];
    await expect(service.forProject('proj-1')).resolves.toEqual(DEFAULT_PRELIMINARY_ESTIMATE_MAP);
  });

  it('builds the map from a stored row, with the fixed Fibonacci counts', async () => {
    // Counts (1/2/3/5/8) are fixed companions to the point scale, not stored — a project
    // configures points only. Verify the row's points flow through and the counts hold.
    rows = [
      { xsPoints: 2, sPoints: 4, mPoints: 6, lPoints: 9, xlPoints: 14, hoursPerPoint: '8.00' },
    ];
    const map = await service.forProject('proj-1');
    expect(map.xs).toEqual({ points: 2, count: 1 });
    expect(map.m).toEqual({ points: 6, count: 3 });
    expect(map.xl).toEqual({ points: 14, count: 8 });
  });

  it('keeps no_entry at zero so an unsized item stays unmeasurable', async () => {
    rows = [
      { xsPoints: 1, sPoints: 3, mPoints: 5, lPoints: 8, xlPoints: 13, hoursPerPoint: '8.00' },
    ];
    const map = await service.forProject('proj-1');
    expect(map.no_entry).toEqual({ points: 0, count: 0 });
  });
});
