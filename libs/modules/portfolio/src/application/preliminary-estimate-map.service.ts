import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { projectSettings } from '../../../../../db/schema/work';
import {
  DEFAULT_PRELIMINARY_ESTIMATE_MAP,
  type PreliminaryEstimateMap,
} from '../../../../../db/schema/enums';

/**
 * The T-shirt-size → points/count mapping, per-PROJECT (SRS §6.2).
 *
 * Extracted so the portfolio and capacity services share ONE reader. Both need it — the
 * portfolio for Estimated Progress, capacity for the Preliminary tier of `resolveEstimate` —
 * and two readers would let the two surfaces disagree about what "M" means, which is
 * precisely the drift the settings-backed map exists to prevent.
 *
 * Never a code constant: the BA spec calls the seeded values temporary and defers the real
 * scale to per-project estimation settings (SRS §6.2). An operator retuning XS…XL must
 * change what every Estimated figure means without a deploy.
 */
@Injectable()
export class PreliminaryEstimateMapService {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  /**
   * The per-PROJECT estimate map (SRS §6.2). Falls back to DEFAULT when no row exists.
   */
  async forProject(projectId: string): Promise<PreliminaryEstimateMap> {
    const rows = await this.db
      .select()
      .from(projectSettings)
      .where(eq(projectSettings.projectId, projectId))
      .limit(1);
    const s = rows[0];
    if (!s) return DEFAULT_PRELIMINARY_ESTIMATE_MAP;
    return {
      no_entry: { points: 0, count: 0 },
      xs: { points: s.xsPoints, count: 1 },
      s: { points: s.sPoints, count: 2 },
      m: { points: s.mPoints, count: 3 },
      l: { points: s.lPoints, count: 5 },
      xl: { points: s.xlPoints, count: 8 },
    };
  }
}
