import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { workspaceSettings } from '../../../../../db/schema/workspace';
import { projectSettings } from '../../../../../db/schema/work';
import {
  DEFAULT_PRELIMINARY_ESTIMATE_MAP,
  type PreliminaryEstimateMap,
} from '../../../../../db/schema/enums';

/**
 * The T-shirt-size → points/count mapping, now per-PROJECT (SRS §6.2).
 *
 * Extracted so the portfolio and capacity services share ONE reader. `forProject` reads
 * `work.project_settings`; `forWorkspace` remains as a legacy fallback for callers
 * that haven't been migrated yet (reporting services), reading the workspace-level
 * `workspace_settings.preliminary_estimate_map`.
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

  /**
   * Legacy workspace-level map. Used by reporting services until they migrate to forProject.
   * Will be removed once all callers resolve a projectId.
   */
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
