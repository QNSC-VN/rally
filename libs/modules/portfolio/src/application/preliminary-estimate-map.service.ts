import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { workspaceSettings } from '../../../../../db/schema/workspace';
import {
  DEFAULT_PRELIMINARY_ESTIMATE_MAP,
  type PreliminaryEstimateMap,
} from '../../../../../db/schema/enums';

/**
 * The workspace's T-shirt-size → points/count mapping.
 *
 * Extracted so the portfolio and capacity services share ONE reader. Both need it — the
 * portfolio for Estimated Progress, capacity for the Preliminary tier of
 * `resolveEstimate` — and two copies would let the two surfaces disagree about what "M"
 * means, which is precisely the drift the settings-backed map exists to prevent.
 *
 * Never a code constant: the BA spec calls the seeded values temporary and defers the real
 * scale to Settings > Workspace, and Rally makes the equivalent mapping a workspace-admin
 * setting. An operator retuning XS…XL must change what every Estimated figure means without
 * a deploy.
 */
@Injectable()
export class PreliminaryEstimateMapService {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async forWorkspace(workspaceId: string): Promise<PreliminaryEstimateMap> {
    const rows = await this.db
      .select({ map: workspaceSettings.preliminaryEstimateMap })
      .from(workspaceSettings)
      .where(and(eq(workspaceSettings.workspaceId, workspaceId)))
      .limit(1);

    const raw = rows[0]?.map as PreliminaryEstimateMap | undefined;
    // Falls back to the seeded default when the row is missing or holds `{}` — a workspace
    // created before migration 0071. Returning an empty map instead would make every
    // Estimated figure null and read as a product bug.
    if (!raw || Object.keys(raw).length === 0) return DEFAULT_PRELIMINARY_ESTIMATE_MAP;
    return { ...DEFAULT_PRELIMINARY_ESTIMATE_MAP, ...raw };
  }
}
