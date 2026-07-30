import { beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE } from '@platform';
import { PreliminaryEstimateMapService } from './preliminary-estimate-map.service';
import { DEFAULT_PRELIMINARY_ESTIMATE_MAP } from '../../../../../db/schema/enums';

describe('PreliminaryEstimateMapService', () => {
  let service: PreliminaryEstimateMapService;
  /** Rows the stubbed Drizzle returns for the settings lookup. */
  let rows: Array<{ map: unknown }>;

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

  it('returns the seeded default when no settings row exists', async () => {
    // A workspace created before migration 0071. An empty map would make every Estimated
    // figure null and read as a product bug rather than as missing configuration.
    rows = [];
    await expect(service.forWorkspace('ws-1')).resolves.toEqual(DEFAULT_PRELIMINARY_ESTIMATE_MAP);
  });

  it('returns the seeded default when the row holds an empty object', async () => {
    rows = [{ map: {} }];
    await expect(service.forWorkspace('ws-1')).resolves.toEqual(DEFAULT_PRELIMINARY_ESTIMATE_MAP);
  });

  it('MERGES a partial override onto the default rather than replacing it', async () => {
    // An operator who retunes only 'm' must not silently lose xs/s/l/xl — a replace would
    // leave those sizes at zero and every Feature using them unmeasurable.
    rows = [{ map: { m: { points: 100, count: 50 } } }];

    const map = await service.forWorkspace('ws-1');

    expect(map.m).toEqual({ points: 100, count: 50 });
    expect(map.l).toEqual(DEFAULT_PRELIMINARY_ESTIMATE_MAP.l);
    expect(map.xs).toEqual(DEFAULT_PRELIMINARY_ESTIMATE_MAP.xs);
  });

  it('keeps no_entry at zero so an unsized Feature stays unmeasurable', async () => {
    rows = [];
    const map = await service.forWorkspace('ws-1');
    expect(map.no_entry).toEqual({ points: 0, count: 0 });
  });
});
